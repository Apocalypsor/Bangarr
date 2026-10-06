import { afterEach, expect, test } from "bun:test";
import { openDatabase } from "@server/db/client";
import { candidates, records, watched } from "@server/db/schema";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { SyncService } from "@server/modules/sync/service";
import type { HttpTransport } from "@server/utils/http";
import { testContext } from "@server/utils/testing";

const disposables: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const fixture = async (ambiguous = false) => {
  const context = testContext();

  disposables.push(context.dispose);

  const settings = {
    database: context.database,
    vault: context.vault,
  };
  const config = structuredClone(defaultSettings);

  config.plex = {
    enabled: true,
    url: "http://plex",
    token: "plex-secret",
    userName: "alice",
    libraryIds: ["1"],
    cron: "*/15 * * * *",
  };
  SettingsService.save(settings, config);

  const writes: {
    path: string;
    account: string | null;
  }[] = [];
  let failSecond = false;
  let searchUnavailable = false;

  const transport: HttpTransport = async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (url.hostname === "plex") {
      if (path === "/identity")
        return Response.json({
          MediaContainer: { machineIdentifier: "server" },
        });

      if (path === "/library/sections")
        return Response.json({
          MediaContainer: {
            Directory: [{ key: "1", title: "动画", type: "show" }],
          },
        });

      return Response.json({
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "1",
              type: "episode",
              grandparentTitle: "番剧",
              parentIndex: 1,
              index: 1,
              viewCount: 1,
            },
          ],
        },
      });
    }

    const account = request.headers.get("authorization");

    if (path === "/v0/me")
      return Response.json({
        id: account === "Bearer first" ? 1 : 2,
        username: account === "Bearer first" ? "first" : "second",
        nickname: "",
      });

    if (path === "/v0/search/subjects") {
      if (searchUnavailable) return new Response(null, { status: 503 });

      return Response.json({
        data: [
          { id: 10, name: "番剧", name_cn: "番剧", type: 2 },
          ...(ambiguous
            ? [{ id: 11, name: "番剧", name_cn: "番剧", type: 2 }]
            : []),
        ],
        total: ambiguous ? 2 : 1,
      });
    }

    if (path === "/v0/episodes")
      return Response.json({
        data: [
          {
            id: 101,
            subject_id: 10,
            name: "第一集",
            name_cn: "",
            sort: 1,
            ep: 1,
            type: 0,
          },
        ],
        total: 1,
      });

    if (request.method === "GET") return new Response("", { status: 404 });

    if (failSecond && account === "Bearer second")
      return new Response("temporary", { status: 503 });

    writes.push({ path, account });

    return new Response(null, { status: 204 });
  };

  const accounts = {
    database: context.database,
    vault: context.vault,
    transport: transport,
  };

  await AccountService.save(accounts, {
    token: "first",
    plexUsers: ["alice"],
    enabled: true,
    private: false,
  });

  const second = await AccountService.save(accounts, {
    token: "second",
    plexUsers: ["alice"],
    enabled: true,
    private: false,
  });

  const runner = {
    database: context.database,
    vault: context.vault,
    transport: transport,
  };

  return {
    ...context,
    settings,
    runner,
    writes,
    second,
    transport,
    disableSearch: () => {
      searchUnavailable = true;
    },
    fail: (value: boolean) => {
      failSecond = value;
    },
  };
};

test("Plex scan produces per-account tasks and persists success across runner restarts", async () => {
  const { runner, database, vault, writes } = await fixture();

  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "plex-scan",
    payload: { full: false },
  });
  expect(await SyncService.runOne(runner)).toBe(true);
  expect(
    JobsService.list(runner).filter((job) => job.kind === "sync"),
  ).toHaveLength(2);
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  expect(database.orm.select().from(watched).all()).toHaveLength(2);
  expect(
    database.orm
      .select()
      .from(records)
      .all()
      .every((record) => record.status === "success"),
  ).toBe(true);
  expect(
    writes.filter((write) => write.path.endsWith("/episodes/101")),
  ).toHaveLength(2);

  const scan = JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "plex-scan",
    payload: { full: false },
  });

  await SyncService.runOne(runner);
  expect(JobsService.get(runner, scan.job.id)?.result).toEqual({
    queued: 0,
    skipped: 2,
  });

  const restarted = {
    database: database,
    vault: vault,
  };

  expect(await SyncService.runOne(restarted)).toBe(false);
});

test("matched targets survive a database reopen and replay without search", async () => {
  const { runner, database, vault, writes, fail, disableSearch, transport } =
    await fixture();

  fail(true);
  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);

  const pending = JobsService.list(runner).find(
    (job) => job.kind === "sync" && job.state === "pending",
  );

  expect(pending?.payload.resolved).toMatchObject({
    subjectId: 10,
    episodeId: 101,
  });
  expect(database.orm.select().from(watched).all()).toHaveLength(1);
  fail(false);
  disableSearch();
  const failedRecord = database.orm
    .select()
    .from(records)
    .all()
    .find((record) => record.status === "error");
  expect(failedRecord).toBeDefined();

  const reopened = openDatabase(database.path);

  try {
    reopened.sqlite.exec(
      "UPDATE jobs SET available_at=0 WHERE state='pending'",
    );

    const restarted = {
      database: reopened,
      vault: vault,
      transport: transport,
    };

    await SyncService.runOne(restarted);
    expect(JobsService.get(restarted, pending?.id ?? "")?.state).toBe(
      "succeeded",
    );
    expect(reopened.orm.select().from(watched).all()).toHaveLength(2);
    const results = reopened.orm.select().from(records).all();
    expect(results).toHaveLength(2);
    expect(
      results.find((record) => record.id === failedRecord?.id)?.status,
    ).toBe("success");
    expect(results.every((record) => record.status === "success")).toBe(true);
    expect(
      writes.filter((write) => write.path.endsWith("/episodes/101")),
    ).toHaveLength(2);
  } finally {
    reopened.close();
  }
});

test("one account failing never confirms its watched state or repeats the other account", async () => {
  const { runner, database, writes, fail } = await fixture();

  fail(true);
  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "plex-scan",
    payload: {},
  });
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  expect(database.orm.select().from(watched).all()).toHaveLength(1);
  expect(
    JobsService.list(runner).filter(
      (job) => job.kind === "sync" && job.state === "pending",
    ),
  ).toHaveLength(1);
  fail(false);
  database.sqlite.exec("UPDATE jobs SET available_at=0 WHERE state='pending'");
  await SyncService.runOne(runner);
  expect(database.orm.select().from(watched).all()).toHaveLength(2);
  expect(
    writes.filter(
      (write) =>
        write.path.endsWith("/episodes/101") &&
        write.account === "Bearer first",
    ),
  ).toHaveLength(1);
});

test("ambiguous match writes nothing until confirmed mapping retries the original task", async () => {
  const { runner, database, settings, writes } = await fixture(true);

  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "plex-scan",
    payload: {},
  });
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  expect(writes).toHaveLength(0);

  const candidate = database.orm.select().from(candidates).get();

  expect(candidate).toBeDefined();

  if (!candidate) throw new Error("missing candidate");

  const originalIds = database.orm
    .select()
    .from(records)
    .all()
    .map((record) => record.id)
    .sort();
  expect(originalIds).toHaveLength(2);
  MatchingService.resolve(settings, candidate.id, 10);
  await SyncService.runOne(runner);
  await SyncService.runOne(runner);
  expect(
    writes.filter((write) => write.path.endsWith("/episodes/101")),
  ).toHaveLength(2);
  expect(MatchingService.candidates(settings)).toHaveLength(0);
  const resolvedRecords = database.orm.select().from(records).all();
  expect(resolvedRecords.map((record) => record.id).sort()).toEqual(
    originalIds,
  );
  expect(resolvedRecords.every((record) => record.status === "success")).toBe(
    true,
  );
});
