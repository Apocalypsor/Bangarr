import { afterEach, expect, test } from "bun:test";
import { BangumiClient } from "@server/clients/bangumi";
import type {
  BangumiEpisode,
  BangumiSubject,
} from "@server/clients/bangumi/types";
import type { PlexItem } from "@server/clients/plex/types";
import { CatalogStore, createCatalog, insertSubject } from "@server/db/catalog";
import { accounts, candidates, jobs } from "@server/db/schema";
import { JobsService } from "@server/modules/jobs/service";
import { NeedsConfirmation } from "@server/modules/matching/errors";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { testContext } from "@server/utils/testing";

interface Segment {
  id: number;
  name: string;
  start?: number;
  count?: number;
  platform?: string;
  type?: number;
  omit?: number;
  airdate?: string;
}

const disposables: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

test("date disambiguation ignores weak title candidates and equal scores never break by ID", async () => {
  const context = testContext();

  disposables.push(context.dispose);

  const store = new CatalogStore(context.database.path);
  const catalog = createCatalog(store.path());

  for (const subject of [
    { id: 1, name: "My Anime", date: "2020-01-01" },
    { id: 2, name: "My Anime", date: "2022-01-01" },
    { id: 3, name: "My Anime OP", date: "2022-01-08" },
  ])
    insertSubject(catalog, {
      ...subject,
      type: 2,
      name_cn: "",
      platform: "TV",
      source: "data",
    });

  catalog.close();

  const service = {
    database: context.database,
  };

  const api = new BangumiClient("https://offline.invalid", "", async () =>
    Response.json({ data: [], total: 0 }),
  );

  const config = structuredClone(defaultSettings);

  config.bangumi.dataEnabled = true;
  config.sync.confidence = 0.6;
  config.sync.minMargin = 0;

  const item: PlexItem = {
    ratingKey: "fixture",
    title: "My Anine",
    originalTitle: "",
    season: 1,
    episode: 1,
    mediaType: "episode",
    releaseDate: "2022-01-01",
    viewCount: 1,
    lastViewedAt: null,
  };

  expect(
    (await MatchingService.selectSubject(service, item, api, config)).id,
  ).toBe(2);
  await expect(
    MatchingService.selectSubject(
      service,
      { ...item, releaseDate: "" },
      api,
      config,
    ),
  ).rejects.toBeInstanceOf(NeedsConfirmation);
});

const fixture = (
  segments: Segment[],
  edges = segments
    .slice(1)
    .map((segment, i) => [segments[i]?.id ?? 0, segment.id]),
) => {
  const context = testContext();

  disposables.push(context.dispose);

  const calls: string[] = [];

  const subjects = new Map<number, BangumiSubject>(
    segments.map((segment) => [
      segment.id,
      {
        id: segment.id,
        name: segment.name,
        name_cn: "",
        type: segment.type ?? 2,
        platform: segment.platform ?? "TV",
      },
    ]),
  );

  const episodes = new Map<number, BangumiEpisode[]>(
    segments.map((segment) => [
      segment.id,
      Array.from({ length: segment.count ?? 12 }, (_, i) => ({
        id: segment.id * 1000 + i + 1,
        subject_id: segment.id,
        type: 0,
        sort: (segment.start ?? 1) + i,
        ep: i + 1,
        airdate: segment.airdate,
        name: "",
        name_cn: "",
      })).filter((ep) => ep.ep !== segment.omit),
    ]),
  );

  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    expect(request.method).toBe("GET");

    const url = new URL(request.url);

    calls.push(url.pathname);

    if (url.pathname === "/v0/episodes") {
      const list =
        episodes.get(Number(url.searchParams.get("subject_id"))) ?? [];

      return Response.json({ data: list, total: list.length });
    }

    const id = Number(url.pathname.split("/")[3]);

    if (url.pathname.endsWith("/subjects"))
      return Response.json(
        edges.flatMap(([from, to]) =>
          from === id
            ? [{ id: to, relation: "续集" }]
            : to === id
              ? [{ id: from, relation: "前传" }]
              : [],
        ),
      );

    const subject = subjects.get(id);

    return subject
      ? Response.json(subject)
      : new Response(null, { status: 404 });
  });

  const service = {
    database: context.database,
  };

  const resolve = (
    season: number,
    episode: number,
    root = segments[0]?.id ?? 0,
    releaseDate = "",
  ) =>
    MatchingService.resolveEpisode(
      service,
      {
        ratingKey: "1",
        title: "番剧",
        originalTitle: "",
        season,
        episode,
        mediaType: "episode",
        releaseDate,
        viewCount: 1,
        lastViewedAt: null,
      } satisfies PlexItem,
      api,
      root,
      false,
      [],
    );

  return { resolve, calls, context, api };
};

test("episode zero resolves within the requested season without shifting episode one", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧", start: 0, count: 3 },
    { id: 2, name: "番剧 第二季", start: 0, count: 3 },
  ]);
  expect(await resolve(2, 0)).toEqual({ subjectId: 2, episodeId: 2001 });
  expect(await resolve(2, 1)).toEqual({ subjectId: 2, episodeId: 2002 });
  await expect(resolve(3, 0)).rejects.toBeInstanceOf(NeedsConfirmation);
});

test("a matching airdate does not turn episode zero into a different numbered chapter", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧", count: 1 },
    { id: 2, name: "番剧 第二季", count: 1, airdate: "2026-01-01" },
  ]);
  await expect(resolve(2, 0, 1, "2026-01-01")).rejects.toBeInstanceOf(
    NeedsConfirmation,
  );
});

test("manual mappings accept zero, preserve offsets and reject negative effective episodes", async () => {
  const { context, api } = fixture([
    { id: 2, name: "番剧 第二季", start: 0, count: 3 },
  ]);
  const item: PlexItem = {
    ratingKey: "zero",
    title: "番剧",
    originalTitle: "",
    season: 2,
    episode: 0,
    mediaType: "episode",
    releaseDate: "",
    viewCount: 1,
    lastViewedAt: null,
  };
  for (const offset of [0, 1, -1]) {
    MatchingService.save(context, {
      title: item.title,
      season: 2,
      subjectId: 2,
      episodeOffset: offset,
    });
    const result = MatchingService.match(context, item, api, defaultSettings);
    if (offset < 0)
      await expect(result).rejects.toMatchObject({ code: "EPISODE_RANGE" });
    else
      expect(await result).toMatchObject({
        subjectId: 2,
        episodeId: 2001 + offset,
        mapped: true,
      });
  }
});

test("split cours in the same declared season use cumulative local episodes in relation order", async () => {
  const { resolve } = fixture([
    { id: 9, name: "番剧" },
    { id: 7, name: "番剧 第二季" },
    { id: 2, name: "番剧 第二季 Part 2" },
  ]);

  expect(await resolve(2, 1)).toEqual({ subjectId: 7, episodeId: 7001 });
  expect(await resolve(2, 13)).toEqual({ subjectId: 2, episodeId: 2001 });
  expect(await resolve(2, 24)).toEqual({ subjectId: 2, episodeId: 2012 });
});

test("season one with reset sort in Part 2 can resolve a continuous Plex episode", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧" },
    { id: 2, name: "番剧 第2部分" },
  ]);

  expect(await resolve(1, 13)).toEqual({ subjectId: 2, episodeId: 2001 });
});

test("unnumbered sequels count seasons while movie, compilation and other media do not", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧" },
    { id: 2, name: "番剧 劇場版", platform: "剧场版", count: 1 },
    { id: 3, name: "番剧 总集篇" },
    { id: 4, name: "番剧 漫画续作", type: 1 },
    { id: 5, name: "番剧 新篇" },
  ]);

  expect(await resolve(2, 4)).toEqual({ subjectId: 5, episodeId: 5004 });
});

test("prequels with different subtitles can supply continuous global numbering", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧 序篇", count: 12 },
    { id: 2, name: "番剧 中篇", start: 13, count: 12 },
    { id: 3, name: "番剧 终篇", start: 25, count: 12 },
  ]);

  expect(await resolve(1, 18, 3)).toEqual({ subjectId: 2, episodeId: 2006 });
});

test("missing target season never reinterprets its local episode as season one's global sort", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧", count: 24 },
    { id: 2, name: "番剧 第二季" },
  ]);

  await expect(resolve(4, 13)).rejects.toBeInstanceOf(NeedsConfirmation);
});

test("branching sequels do not choose a cour by date or ID", async () => {
  const { resolve } = fixture(
    [
      { id: 1, name: "番剧" },
      { id: 2, name: "番剧 第二季" },
      { id: 3, name: "番剧 第二季" },
    ],
    [
      [1, 2],
      [1, 3],
    ],
  );

  await expect(resolve(2, 3)).rejects.toBeInstanceOf(NeedsConfirmation);
});

test("missing episodes do not shrink the offset into the next cour", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧" },
    { id: 2, name: "番剧 第二季", omit: 5 },
    { id: 3, name: "番剧 第二季 Part 2" },
  ]);

  expect(await resolve(2, 12)).toEqual({ subjectId: 2, episodeId: 2012 });
  expect(await resolve(2, 13)).toEqual({ subjectId: 3, episodeId: 3001 });
  await expect(resolve(2, 5)).rejects.toBeInstanceOf(NeedsConfirmation);
});

test("cycles terminate and cannot be used for cumulative season inference", async () => {
  const { resolve, calls } = fixture(
    [
      { id: 1, name: "番剧" },
      { id: 2, name: "番剧 新篇" },
    ],
    [
      [1, 2],
      [2, 1],
    ],
  );

  await expect(resolve(2, 3)).rejects.toBeInstanceOf(NeedsConfirmation);
  expect(calls.length).toBeLessThan(10);
});

test("confirmation groups episodes and accounts by exact title and season and retries the whole group", () => {
  const context = testContext();
  disposables.push(context.dispose);
  context.database.orm
    .insert(accounts)
    .values([
      {
        id: "a",
        username: "first",
        accessToken: "private-first",
        plexUsers: [],
        createdAt: 0,
      },
      {
        id: "b",
        username: "second",
        accessToken: "private-second",
        plexUsers: [],
        createdAt: 0,
      },
    ])
    .run();
  const rows = [
    { id: "a1", title: "同一作品", season: 1, episode: 1, accountId: "a" },
    { id: "a2", title: "同一作品", season: 1, episode: 2, accountId: "a" },
    { id: "b1", title: "同一作品", season: 1, episode: 1, accountId: "b" },
    { id: "season2", title: "同一作品", season: 2, episode: 1, accountId: "a" },
    { id: "other", title: "其他作品", season: 1, episode: 1, accountId: "a" },
  ];

  for (const row of rows) seedCandidate(context, row);

  const groups = MatchingService.candidates(context);
  const group = groups.find(
    (row) => row.title === "同一作品" && row.season === 1,
  );
  expect(groups).toHaveLength(3);
  expect(group?.taskCount).toBe(3);
  expect(group?.tasks).toEqual([
    {
      jobId: "a1",
      episode: 1,
      mediaType: "episode",
      plexUser: "plex-user",
      plexAccountName: "Home",
      accountName: "first",
    },
    {
      jobId: "b1",
      episode: 1,
      mediaType: "episode",
      plexUser: "plex-user",
      plexAccountName: "Home",
      accountName: "second",
    },
    {
      jobId: "a2",
      episode: 2,
      mediaType: "episode",
      plexUser: "plex-user",
      plexAccountName: "Home",
      accountName: "first",
    },
  ]);
  expect(JSON.stringify(groups)).not.toContain("private-first");
  expect(JSON.stringify(groups)).not.toContain("private-second");
  expect(JSON.stringify(groups)).not.toContain("private-payload");
  expect(group?.choices.map((choice) => choice.id).sort()).toEqual([10, 11]);

  MatchingService.resolve(context, "a1", 10, -1);

  expect(MatchingService.candidates(context)).toHaveLength(2);
  expect(MatchingService.mappings(context)).toMatchObject([
    { title: "同一作品", season: 1, subjectId: 10, episodeOffset: -1 },
  ]);
  const queued = context.database.orm
    .select()
    .from(jobs)
    .all()
    .filter((job) => job.state === "pending");
  expect(queued).toHaveLength(3);
  for (const row of rows.slice(0, 3)) {
    expect(queued.find((job) => job.dedupeKey === row.id)?.payload).toEqual(
      JobsService.get(context, row.id)?.payload,
    );
  }
  expect(() => MatchingService.resolve(context, "a2", 10)).toThrow(
    "候选已处理",
  );
});

test("blocking a work clears its pending confirmations across seasons without retrying unrelated work", () => {
  const context = testContext();
  disposables.push(context.dispose);
  for (const [id, title, season] of [
    ["a", "屏蔽作品", 1],
    ["b", "屏蔽作品", 2],
    ["c", "保留作品", 1],
  ] as const) {
    seedCandidate(context, { id, title, season, episode: 1, accountId: "a" });
  }

  MatchingService.resolve(context, "a", null);

  expect(MatchingService.candidates(context).map((row) => row.title)).toEqual([
    "保留作品",
  ]);
  expect(SettingsService.read(context).sync.blockedKeywords).toContain(
    "屏蔽作品",
  );
  expect(
    context.database.orm
      .select()
      .from(jobs)
      .all()
      .every((job) => job.state === "failed"),
  ).toBe(true);
});

test("a missing related job rolls back the entire confirmation and mapping", () => {
  const context = testContext();
  disposables.push(context.dispose);
  seedCandidate(context, {
    id: "valid",
    title: "作品",
    season: 1,
    episode: 1,
    accountId: "a",
  });
  context.database.orm
    .insert(candidates)
    .values({
      id: "missing",
      jobId: "missing",
      title: "作品",
      season: 1,
      choices: [],
      state: "pending",
      createdAt: 0,
    })
    .run();

  expect(() => MatchingService.resolve(context, "valid", 10)).toThrow(
    "无法重试",
  );
  expect(MatchingService.mappings(context)).toHaveLength(0);
  expect(MatchingService.candidates(context)[0]?.taskCount).toBe(2);
  expect(
    MatchingService.candidates(context)[0]?.tasks.find(
      (task) => task.jobId === "missing",
    ),
  ).toMatchObject({ episode: null, accountName: null });
  expect(context.database.orm.select().from(jobs).all()).toHaveLength(1);
});

const seedCandidate = (
  context: ReturnType<typeof testContext>,
  row: {
    id: string;
    title: string;
    season: number;
    episode: number;
    accountId: string;
  },
) => {
  context.database.orm
    .insert(jobs)
    .values({
      id: row.id,
      kind: "sync",
      dedupeKey: row.id,
      payload: {
        item: {
          title: row.title,
          season: row.season,
          episode: row.episode,
          mediaType: "episode",
        },
        accountId: row.accountId,
        userName: "plex-user",
        plexAccountName: "Home",
        secret: "private-payload",
      },
      state: "failed",
      availableAt: 0,
      createdAt: 0,
      updatedAt: 0,
    })
    .run();
  context.database.orm
    .insert(candidates)
    .values({
      id: row.id,
      jobId: row.id,
      title: row.title,
      season: row.season,
      choices:
        row.episode === 2
          ? [{ id: 11, name: "候选二" }]
          : [{ id: 10, name: "候选一" }],
      state: "pending",
      createdAt: row.episode,
    })
    .run();
};

test("a manually confirmed subject overrides conflicting dates and stays pinned to its episode numbering", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const calls: string[] = [];
  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    expect(request.method).toBe("GET");
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname === "/v0/episodes") {
      expect(url.searchParams.get("subject_id")).toBe("443831");
      return Response.json({
        data: [
          {
            id: 1427231,
            subject_id: 443831,
            sort: 1,
            ep: 1,
            type: 0,
            airdate: "2026-01-03",
            name: "英灵事件",
            name_cn: "英灵事件",
          },
        ],
        total: 1,
      });
    }
    if (url.pathname === "/v0/subjects/443831")
      return Response.json({
        id: 443831,
        name: "Fate/strange Fake",
        name_cn: "",
        type: 2,
        platform: "TV",
      });
    if (url.pathname === "/v0/subjects/443831/subjects")
      return Response.json([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const item: PlexItem = {
    ratingKey: "fate-1",
    title: "命运／奇异赝品",
    originalTitle: "",
    season: 1,
    episode: 1,
    mediaType: "episode",
    releaseDate: "2024-12-31",
    viewCount: 1,
    lastViewedAt: null,
  };

  // Automatic matching must still reject contradictory episode metadata.
  await expect(
    MatchingService.resolveEpisode(context, item, api, 443831, true, []),
  ).rejects.toBeInstanceOf(NeedsConfirmation);
  MatchingService.save(context, {
    title: item.title,
    season: 1,
    subjectId: 443831,
    episodeOffset: 0,
  });
  calls.length = 0;
  const result = await MatchingService.match(
    context,
    item,
    api,
    structuredClone(defaultSettings),
  );
  expect(result).toMatchObject({
    subjectId: 443831,
    episodeId: 1427231,
    mapped: true,
  });
  expect(calls).toEqual(["/v0/episodes"]);

  await expect(
    MatchingService.match(
      context,
      { ...item, episode: 2 },
      api,
      structuredClone(defaultSettings),
    ),
  ).rejects.toMatchObject({ code: "MAPPED_EPISODE_MISSING" });
  expect(calls.every((path) => path === "/v0/episodes")).toBe(true);

  MatchingService.save(context, {
    title: item.title,
    season: 6,
    subjectId: 443831,
    episodeOffset: -12,
  });
  expect(
    await MatchingService.match(
      context,
      { ...item, season: 6, episode: 13 },
      api,
      structuredClone(defaultSettings),
    ),
  ).toMatchObject({ subjectId: 443831, episodeId: 1427231, mapped: true });
});
