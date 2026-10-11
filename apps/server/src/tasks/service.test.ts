import { afterEach, expect, test } from "bun:test";
import { openDatabase } from "@server/db/client";
import { candidates, records, watched } from "@server/db/schema";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import mushokuSeasonTwo from "@server/modules/matching/fixtures/mushoku-season-two.json";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { TaskService } from "@server/tasks/service";
import type { HttpTransport } from "@server/utils/http";
import { seedPlexAccount, testContext } from "@server/utils/testing";

const disposables: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const fixture = async (needsConfirmation = false) => {
  const context = testContext();

  disposables.push(context.dispose);

  const settings = {
    database: context.database,
    vault: context.vault,
  };
  const config = structuredClone(defaultSettings);
  if (needsConfirmation) config.sync.confidence = 0.9;

  seedPlexAccount(context);
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
          {
            id: 10,
            name: needsConfirmation ? "番剧甲" : "番剧",
            name_cn: "",
            type: 2,
          },
          ...(needsConfirmation
            ? [{ id: 11, name: "番剧乙", name_cn: "", type: 2 }]
            : []),
        ],
        total: needsConfirmation ? 2 : 1,
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
    plexUsers: ["default"],
    enabled: true,
    private: false,
  });

  const second = await AccountService.save(accounts, {
    token: "second",
    plexUsers: ["default"],
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
  seedPlexAccount(base, { libraryIds });
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
                originallyAvailableAt:
                  index === 0 ? "2026-01-01" : "2026-01-08",
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
            airdate: sort === 0 ? "2026-01-01" : "2026-01-08",
          }));
          return Response.json({ data, total: data.length });
        }
        if (url.pathname === "/v0/subjects/10")
          return Response.json({
            id: 10,
            name: "番剧 第二季",
            name_cn: "",
            type: 2,
            platform: "TV",
          });
        if (url.pathname === "/v0/subjects/10/subjects")
          return Response.json([]);
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
    ).toEqual(["pending", "pending"]);
    expect(
      rows.filter((row) => row.episode === 1).map((row) => row.status),
    ).toEqual(["success", "success"]);
    expect(
      base.writes.filter((write) => write.path.endsWith("/episodes/101")),
    ).toHaveLength(2);
    expect(
      base.writes.filter((write) => write.path.endsWith("/episodes/100")),
    ).toHaveLength(0);
  },
);

test.each([false, true])(
  "mapped tasks sync per account and E00 can be confirmed separately (full season: %s)",
  async (fullSeason) => {
    const base = await fixture();
    const expected = fullSeason
      ? mushokuSeasonTwo.flatMap((row) => row.episodes)
      : (mushokuSeasonTwo[1]?.episodes.filter(
          (row) => row.sort >= 17 && row.sort <= 21,
        ) ?? []);
    expect(expected).toHaveLength(fullSeason ? 25 : 5);
    const runner = {
      ...base.runner,
      transport: async (request: Request) => {
        const url = new URL(request.url);
        if (url.hostname === "plex" && url.pathname.endsWith("/all"))
          return scanResponse(
            expected.map((ep) => ({
              ...scanItem(String(ep.sort)),
              parentIndex: 2,
              index: ep.sort,
              originallyAvailableAt: ep.airdate,
            })),
          );
        if (url.pathname === "/v0/episodes") {
          const segment = mushokuSeasonTwo.find(
            (row) =>
              row.subject.id === Number(url.searchParams.get("subject_id")),
          );
          if (!segment) throw new Error("Unexpected subject");
          return Response.json({
            data: segment.episodes,
            total: segment.episodes.length,
          });
        }
        if (url.pathname.startsWith("/v0/subjects/")) {
          const id = Number(url.pathname.split("/")[3]);
          const segment = mushokuSeasonTwo.find((row) => row.subject.id === id);
          if (!segment) throw new Error("Unexpected subject");
          if (url.pathname.endsWith("/subjects"))
            return Response.json(
              id === 373247
                ? [{ id: 444557, relation: "续集" }]
                : [{ id: 373247, relation: "前传" }],
            );
          return Response.json(segment.subject);
        }
        return base.transport(request);
      },
    };
    MatchingService.save(runner, {
      title: "番剧",
      season: 2,
      subjectId: 444557,
      episodeOffset: 0,
    });
    JobsService.enqueue(runner, {
      kind: "plex-scan",
      dedupeKey: "scan",
      payload: {},
    });
    await TaskService.runOne(runner);
    const tasks = JobsService.list(runner).filter((job) => job.kind === "sync");
    expect(tasks).toHaveLength(expected.length * 2);
    // Exercise the same retry path used for previously failed records.
    for (let i = 0; i < tasks.length; i++) {
      const leased = JobsService.claim(runner, "previous-version");
      expect(leased?.kind).toBe("sync");
      if (!leased) throw new Error("Missing task");
      JobsService.fail(
        runner,
        leased.id,
        "previous-version",
        "章节未找到",
        false,
      );
    }
    for (const task of tasks) JobsService.retry(runner, task.id);
    for (let i = 0; i < tasks.length; i++) await TaskService.runOne(runner);
    if (fullSeason) {
      const [zero] = MatchingService.candidates(runner);
      expect(zero).toMatchObject({ episode: 0, taskCount: 2 });
      expect(base.database.orm.select().from(watched).all()).toHaveLength(48);
      if (!zero) throw new Error("Missing E00 confirmation");
      MatchingService.resolve(runner, zero.id, 373247, 1);
      const reopened = openDatabase(base.database.path);
      try {
        const resumed = { ...runner, database: reopened };
        expect(MatchingService.mappings(resumed)).toHaveLength(2);
        for (let i = 0; i < 2; i++)
          expect(await TaskService.runOne(resumed)).toBe(true);
        expect(await TaskService.runOne(resumed)).toBe(false);
        expect(MatchingService.candidates(resumed)).toHaveLength(0);
      } finally {
        reopened.close();
      }
    }
    const rows = base.database.orm.select().from(watched).all();
    expect(rows).toHaveLength(expected.length * 2);
    for (const ep of expected)
      expect(
        rows.filter(
          (row) => row.episodeId === ep.id && row.subjectId === ep.subject_id,
        ),
      ).toHaveLength(2);
    expect(
      base.writes.filter((write) => write.path.includes("/episodes/")),
    ).toHaveLength(expected.length * 2);
    expect(
      base.database.orm
        .select()
        .from(records)
        .all()
        .filter((row) => row.status === "success").length,
    ).toBe(expected.length * 2);
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

test.each([false, true])(
  "full rechecks preserve completed subjects and honor completion setting %s per account",
  async (complete) => {
    const base = await fixture();
    const states = new Map([
      ["first", 2],
      ["second", 3],
    ]);
    const updates: { account: string; type: number }[] = [];
    const runner = {
      ...base.runner,
      transport: (async (request) => {
        const url = new URL(request.url);
        const account =
          request.headers.get("authorization") === "Bearer first"
            ? "first"
            : "second";
        if (url.hostname !== "plex") {
          if (request.method === "GET") {
            if (url.pathname === `/v0/users/${account}/collections/10`)
              return Response.json({
                type: states.get(account),
                ep_status: 12,
              });
            if (url.pathname === "/v0/users/-/collections/10")
              return new Response(null, { status: 404 });
            if (url.pathname === "/v0/users/-/collections/-/episodes/101")
              return Response.json({ type: account === "first" ? 0 : 2 });
            if (url.pathname === "/v0/subjects/10")
              return Response.json({ id: 10, type: 2, eps: 12 });
          }
          if (
            request.method === "POST" &&
            url.pathname === "/v0/users/-/collections/10"
          ) {
            const { type } = (await request.json()) as { type: number };
            states.set(account, type);
            updates.push({ account, type });
            return new Response(null, { status: 204 });
          }
        }
        return base.transport(request);
      }) satisfies HttpTransport,
    };

    // First record successful syncs with automatic completion disabled.
    JobsService.enqueue(runner, {
      kind: "plex-scan",
      dedupeKey: "scan",
      payload: {},
    });
    for (let i = 0; i < 3; i++) await TaskService.runOne(runner);
    expect(base.database.orm.select().from(watched).all()).toHaveLength(2);
    expect([...states.values()]).toEqual([2, 3]);
    expect(updates).toEqual([]);

    const settings = SettingsService.read(runner);
    settings.sync.animeCompleted = complete;
    SettingsService.save(runner, settings);
    for (let pass = 0; pass < 2; pass++) {
      const scan = JobsService.enqueue(runner, {
        kind: "plex-scan",
        dedupeKey: "scan",
        payload: { full: true },
      });
      for (let i = 0; i < 3; i++) await TaskService.runOne(runner);
      expect(JobsService.get(runner, scan.job.id)?.result).toMatchObject({
        queued: 2,
      });
      expect([...states.values()]).toEqual([2, complete ? 2 : 3]);
      expect(updates).toEqual(complete ? [{ account: "second", type: 2 }] : []);
      expect(
        JobsService.list(runner).every((job) => job.state === "succeeded"),
      ).toBe(true);
      const secondRecord = base.database.orm
        .select()
        .from(records)
        .all()
        .find((record) => record.accountId === base.second?.id);
      expect(secondRecord?.message).toBe(
        complete && pass === 0 ? "观看进度已同步" : "Bangumi 已有此进度",
      );
      // Both subjects already have watched progress; rechecking must not reset chapters.
      expect(base.writes).toEqual([]);
    }
  },
);

test("completion retry preserves successful chapters and other accounts", async () => {
  const base = await fixture();
  const episodeWrites: string[] = [];
  const completed = new Set<string>();
  let failCompletion = true;
  const runner = {
    ...base.runner,
    transport: (async (request) => {
      const url = new URL(request.url);
      if (url.hostname === "plex") return base.transport(request);
      const account =
        request.headers.get("authorization") === "Bearer first"
          ? "first"
          : "second";
      if (request.method === "GET") {
        if (url.pathname === `/v0/users/${account}/collections/10`)
          return Response.json({
            type: completed.has(account) ? 2 : 3,
            ep_status: episodeWrites.includes(account) ? 1 : 0,
          });
        if (url.pathname === "/v0/users/-/collections/-/episodes/101")
          return Response.json({
            type: episodeWrites.includes(account) ? 2 : 0,
          });
        if (url.pathname === "/v0/subjects/10")
          return Response.json({ id: 10, type: 2, eps: 1 });
      }
      if (request.method === "PUT") {
        expect(url.pathname).toBe("/v0/users/-/collections/-/episodes/101");
        expect(await request.json()).toEqual({ type: 2 });
        episodeWrites.push(account);
        return new Response(null, { status: 204 });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v0/users/-/collections/10"
      ) {
        expect(await request.json()).toEqual({ type: 2, private: false });
        if (account === "first" && failCompletion)
          return new Response(null, { status: 503 });
        completed.add(account);
        return new Response(null, { status: 204 });
      }
      return base.transport(request);
    }) satisfies HttpTransport,
  };
  const settings = SettingsService.read(runner);
  settings.sync.animeCompleted = true;
  SettingsService.save(runner, settings);
  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: { full: true },
  });
  for (let i = 0; i < 3; i++) await TaskService.runOne(runner);
  expect(episodeWrites.sort()).toEqual(["first", "second"]);
  expect([...completed]).toEqual(["second"]);
  expect(
    JobsService.list(runner).filter((job) => job.state === "pending"),
  ).toHaveLength(1);
  failCompletion = false;
  base.database.sqlite.exec(
    "UPDATE jobs SET available_at=0 WHERE state='pending'",
  );
  await TaskService.runOne(runner);
  expect(episodeWrites.sort()).toEqual(["first", "second"]);
  expect([...completed].sort()).toEqual(["first", "second"]);
  expect(
    JobsService.list(runner).every((job) => job.state === "succeeded"),
  ).toBe(true);
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

test("successful retries close only their own stale matching candidates", async () => {
  const { runner, database } = await fixture(true);
  JobsService.enqueue(runner, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: {},
  });
  for (let i = 0; i < 3; i++) await TaskService.runOne(runner);
  const pending = database.orm.select().from(candidates).all();
  expect(pending).toHaveLength(2);
  MatchingService.save(runner, {
    title: "番剧",
    season: 1,
    subjectId: 10,
    episodeOffset: 0,
  });
  const first = pending[0],
    second = pending[1];
  if (!first || !second) throw new Error("Missing candidates");
  JobsService.retry(runner, first.jobId);
  await TaskService.runOne(runner);
  expect(
    MatchingService.candidates(runner)[0]?.tasks.map((row) => row.jobId),
  ).toEqual([second.jobId]);
  expect(
    database.orm
      .select()
      .from(candidates)
      .all()
      .find((row) => row.id === first.id)?.state,
  ).toBe("confirmed");
  expect(JobsService.get(runner, first.jobId)?.state).toBe("failed");
  JobsService.retry(runner, second.jobId);
  await TaskService.runOne(runner);
  expect(MatchingService.candidates(runner)).toHaveLength(0);
  expect(database.orm.select().from(candidates).all()).toHaveLength(2);
});

test("low-confidence match writes nothing until confirmed mapping retries the original task", async () => {
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
