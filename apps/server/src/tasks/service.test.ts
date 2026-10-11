import { afterEach, expect, test } from "bun:test";
import { openDatabase } from "@server/db/client";
import { candidates, records, watched } from "@server/db/schema";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { TaskService } from "@server/tasks/service";
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

const scanFixture = async (
  respond: (url: URL) => Response | Promise<Response>,
  libraryIds = ["1", "2"],
) => {
  const base = await fixture();
  const config = SettingsService.read(base.runner);
  config.plex.libraryIds = libraryIds;
  SettingsService.save(base.runner, config);
  const runner = {
    ...base.runner,
    transport: (request: Request) => {
      const url = new URL(request.url);
      return url.hostname === "plex" &&
        url.pathname.startsWith("/library/sections")
        ? Promise.resolve(respond(url))
        : base.transport(request);
    },
  };
  return { ...base, runner };
};

const scanItem = (key: string) => ({
  ratingKey: key,
  type: "episode",
  grandparentTitle: "番剧",
  parentIndex: 1,
  index: 1,
  viewCount: 1,
});

const scanResponse = (
  metadata: unknown[],
  totalSize = metadata.length,
  offset = 0,
) =>
  Response.json({ MediaContainer: { Metadata: metadata, totalSize, offset } });

const scanLibraries = () =>
  Response.json({
    MediaContainer: {
      Directory: [
        { key: "1", title: "第一库", type: "show" },
        { key: "2", title: "第二库", type: "show" },
      ],
    },
  });

test("bad rows and an inaccessible library leave an inspectable partial result while valid tasks survive", async () => {
  const base = await scanFixture(
    (url) => {
      if (url.pathname === "/library/sections") return scanLibraries();
      if (url.pathname.endsWith("/1/all"))
        return scanResponse([
          scanItem("a"),
          null,
          { ...scanItem("bad"), index: null, token: "never-expose" },
          { ...scanItem(""), grandparentTitle: "缺少标识" },
          scanItem("b"),
        ]);
      return scanResponse([scanItem("c")]);
    },
    ["99", "1", "2"],
  );
  const scan = JobsService.enqueue(base.runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await TaskService.runOne(base.runner);
  expect(JobsService.get(base.runner, scan.job.id)).toMatchObject({
    state: "failed",
    result: {
      scan: { scanned: 6, queued: 6, failedItems: 3, failedLibraries: 1 },
    },
  });
  expect(
    JobsService.list(base.runner).filter((job) => job.kind === "sync"),
  ).toHaveLength(6);
  const page = JobsService.page(base.runner, {
    kind: "plex-scan",
    state: "failed",
  });
  expect(page.items[0]?.scan?.issues).toHaveLength(4);
  expect(JSON.stringify(page)).not.toContain("never-expose");
  expect(
    page.items[0]?.scan?.issues.some((issue) => issue.ratingKey === "bad"),
  ).toBe(true);
});

test("a broken page stops only that library and flushes valid rows from its earlier page", async () => {
  const base = await scanFixture((url) => {
    if (url.pathname === "/library/sections") return scanLibraries();
    if (url.pathname.endsWith("/1/all")) {
      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
      return offset === 0
        ? scanResponse([scanItem("a")], 2)
        : scanResponse([], 2, offset);
    }
    return scanResponse([scanItem("b")]);
  });
  const scan = JobsService.enqueue(base.runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await TaskService.runOne(base.runner);
  expect(JobsService.get(base.runner, scan.job.id)).toMatchObject({
    state: "failed",
    result: { scan: { queued: 4, failedItems: 0, failedLibraries: 1 } },
  });
  expect(
    JobsService.page(base.runner, { state: "failed" }).items[0]?.scan?.issues[0]
      ?.message,
  ).toContain("分页提前结束");
});

test("large malformed scans retain exact totals and bounded diagnostics without dropping valid tasks", async () => {
  const base = await scanFixture(
    (url) =>
      url.pathname === "/library/sections"
        ? scanLibraries()
        : scanResponse([
            ...Array.from({ length: 105 }, (_, i) => ({
              ...scanItem(`bad-${i}`),
              index: null,
            })),
            scanItem("valid"),
          ]),
    ["1"],
  );
  const scan = JobsService.enqueue(base.runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await TaskService.runOne(base.runner);
  const report = JobsService.page(base.runner, { state: "failed" }).items[0]
    ?.scan;
  expect(report).toMatchObject({
    failedItems: 105,
    issuesOmitted: 5,
    queued: 2,
  });
  expect(report?.issues).toHaveLength(100);
  expect(JobsService.get(base.runner, scan.job.id)?.state).toBe("failed");
});

test.each([401, 429, "network"])(
  "global Plex failure preserves the current batch and stops later libraries (%s)",
  async (failure) => {
    let secondLibrary = false;
    const base = await scanFixture((url) => {
      if (url.pathname === "/library/sections") return scanLibraries();
      if (url.pathname.endsWith("/2/all")) {
        secondLibrary = true;
        return scanResponse([scanItem("b")]);
      }
      if (Number(url.searchParams.get("X-Plex-Container-Start")) === 0)
        return scanResponse([scanItem("a")], 2);
      if (failure === "network") throw new Error("secret-address-and-token");
      return new Response(null, { status: Number(failure) });
    });
    const scan = JobsService.enqueue(base.runner, {
      kind: "plex-scan",
      dedupeKey: "scan",
      payload: {},
      maxAttempts: 2,
    });
    await TaskService.runOne(base.runner);
    expect(secondLibrary).toBe(false);
    expect(JobsService.get(base.runner, scan.job.id)).toMatchObject({
      state: failure === 401 ? "failed" : "pending",
      result: { scan: { queued: 2 } },
    });
    expect(
      JobsService.list(base.runner).filter((job) => job.kind === "sync"),
    ).toHaveLength(2);
    expect(JSON.stringify(JobsService.page(base.runner))).not.toContain(
      "secret-address-and-token",
    );
  },
);

test("transient library errors retry within the limit after reopening without repeating successful account writes", async () => {
  const base = await scanFixture((url) => {
    if (url.pathname === "/library/sections") return scanLibraries();
    return url.pathname.endsWith("/1/all")
      ? new Response(null, { status: 503 })
      : scanResponse([scanItem("b")]);
  });
  let now = Date.now();
  const runner = { ...base.runner, now: () => now };
  const scan = JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
    maxAttempts: 2,
  });
  await TaskService.runOne(runner);
  expect(JobsService.get(runner, scan.job.id)?.state).toBe("pending");
  while (await TaskService.runOne(runner)) {
    /* Drain ready single-episode tasks. */
  }
  expect(
    base.writes.filter((write) => write.path.endsWith("/episodes/101")),
  ).toHaveLength(2);
  const reopened = openDatabase(base.database.path);
  try {
    const resumed = { ...runner, database: reopened };
    expect(
      JobsService.page(resumed, { kind: "plex-scan" }).items[0]?.scan
        ?.failedLibraries,
    ).toBe(1);
    now += 3600001;
    await TaskService.runOne(resumed);
    expect(JobsService.get(resumed, scan.job.id)).toMatchObject({
      state: "failed",
      attempt: 2,
    });
    expect(await TaskService.runOne(resumed)).toBe(false);
    expect(
      base.writes.filter((write) => write.path.endsWith("/episodes/101")),
    ).toHaveLength(2);
  } finally {
    reopened.close();
  }
});

test("a database failure rolls back the batch and stops rather than being treated as a bad Plex row", async () => {
  let secondLibrary = false;
  const base = await scanFixture((url) => {
    if (url.pathname === "/library/sections") return scanLibraries();
    if (url.pathname.endsWith("/2/all")) secondLibrary = true;
    return scanResponse([scanItem("a"), { ...scanItem("bad"), index: null }]);
  });
  base.database.sqlite.exec(
    "CREATE TRIGGER reject_sync BEFORE INSERT ON jobs WHEN NEW.kind = 'sync' BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
  );
  const scan = JobsService.enqueue(base.runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await TaskService.runOne(base.runner);
  expect(secondLibrary).toBe(false);
  expect(JobsService.get(base.runner, scan.job.id)?.state).toBe("failed");
  expect(
    JobsService.list(base.runner).filter((job) => job.kind === "sync"),
  ).toHaveLength(0);
});

test("an expired scan worker cannot enqueue its buffered rows after another worker claims it", async () => {
  let now = Date.now();
  const base = await scanFixture(
    (url) => {
      if (url.pathname === "/library/sections") return scanLibraries();
      if (Number(url.searchParams.get("X-Plex-Container-Start")) === 0)
        return scanResponse([scanItem("a")], 2);
      now += 60001;
      JobsService.claim(runner, "replacement");
      return scanResponse([scanItem("b")], 2, 1);
    },
    ["1"],
  );
  const runner = { ...base.runner, now: () => now };
  const scan = JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  await TaskService.runOne(runner, "old");
  expect(JobsService.get(runner, scan.job.id)).toMatchObject({
    state: "running",
    leaseOwner: "replacement",
  });
  expect(
    JobsService.list(runner).filter((job) => job.kind === "sync"),
  ).toHaveLength(0);
});

test.each([true, false])(
  "S02E00 does not block scanning or later account tasks (Bangumi zero exists: %s)",
  async (hasZero) => {
    const base = await fixture();
    const runner = {
      ...base.runner,
      transport: async (request: Request) => {
        const url = new URL(request.url);
        if (url.hostname === "plex" && url.pathname.endsWith("/all"))
          return Response.json({
            MediaContainer: {
              totalSize: 2,
              Metadata: [0, 1].map((index) => ({
                ratingKey: String(index),
                type: "episode",
                grandparentTitle: "番剧",
                parentIndex: 2,
                index,
                viewCount: 1,
              })),
            },
          });
        if (url.pathname === "/v0/episodes") {
          expect(url.searchParams.get("type")).toBe("0");
          const data = (hasZero ? [0, 1] : [1]).map((sort) => ({
            id: 100 + sort,
            subject_id: 10,
            name: `第 ${sort} 集`,
            name_cn: "",
            sort,
            ep: 0,
            type: 0,
          }));
          return Response.json({ data, total: data.length });
        }
        return base.transport(request);
      },
    };
    MatchingService.save(runner, {
      title: "番剧",
      season: 2,
      subjectId: 10,
      episodeOffset: 0,
    });
    const scan = JobsService.enqueue(runner, {
      kind: "plex-scan",
      dedupeKey: "plex-scan",
      payload: { full: false },
    });
    await TaskService.runOne(runner);
    expect(JobsService.get(runner, scan.job.id)).toMatchObject({
      state: "succeeded",
      result: { queued: 4, skipped: 0 },
    });
    expect(
      JobsService.list(runner).filter((job) => job.kind === "sync"),
    ).toHaveLength(4);
    for (let i = 0; i < 4; i++) await TaskService.runOne(runner);

    const rows = base.database.orm.select().from(records).all();
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.episode === 0).map((row) => row.status),
    ).toEqual([hasZero ? "success" : "error", hasZero ? "success" : "error"]);
    expect(
      rows.filter((row) => row.episode === 1).map((row) => row.status),
    ).toEqual(["success", "success"]);
    expect(
      base.writes.filter((write) => write.path.endsWith("/episodes/101")),
    ).toHaveLength(2);
    expect(
      base.writes.filter((write) => write.path.endsWith("/episodes/100")),
    ).toHaveLength(hasZero ? 2 : 0);
  },
);

test("Plex scan produces per-account tasks and persists success across runner restarts", async () => {
  const { runner, database, vault, writes } = await fixture();

  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "plex-scan",
    payload: { full: false },
  });
  expect(await TaskService.runOne(runner)).toBe(true);
  expect(
    JobsService.list(runner).filter((job) => job.kind === "sync"),
  ).toHaveLength(2);
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
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

  await TaskService.runOne(runner);
  expect(JobsService.get(runner, scan.job.id)?.result).toMatchObject({
    queued: 0,
    skipped: 2,
  });

  const restarted = {
    database: database,
    vault: vault,
  };

  expect(await TaskService.runOne(restarted)).toBe(false);
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
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);

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

    await TaskService.runOne(restarted);
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
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
  expect(database.orm.select().from(watched).all()).toHaveLength(1);
  expect(
    JobsService.list(runner).filter(
      (job) => job.kind === "sync" && job.state === "pending",
    ),
  ).toHaveLength(1);
  fail(false);
  database.sqlite.exec("UPDATE jobs SET available_at=0 WHERE state='pending'");
  await TaskService.runOne(runner);
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
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
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
  await TaskService.runOne(runner);
  await TaskService.runOne(runner);
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
