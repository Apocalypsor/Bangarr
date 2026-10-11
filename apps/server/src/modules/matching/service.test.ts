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
import mushokuSeasonTwo from "@server/modules/matching/fixtures/mushoku-season-two.json";
import splitCourTitles from "@server/modules/matching/fixtures/split-cour-title-candidates.json";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { testContext, testSyncPayload } from "@server/utils/testing";

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

test("local matching uses the nearest date and preserves catalog order without dates", async () => {
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
      name_cn: subject.name,
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
  expect(
    (
      await MatchingService.selectSubject(
        service,
        { ...item, releaseDate: "" },
        api,
        config,
      )
    ).id,
  ).toBe(1);
});

test.each([
  ["无职转生～到了异世界就拿出真本事～", 1, 14, "2021-10-17", 325585],
  ["无职转生～到了异世界就拿出真本事～", 1, 23, "2021-12-19", 325585],
  ["无职转生～到了异世界就拿出真本事～", 2, 13, "2024-04-07", 444557],
  ["无职转生～到了异世界就拿出真本事～", 2, 24, "2024-06-30", 444557],
  ["炎炎消防队", 3, 13, "2026-01-09", 502876],
  ["炎炎消防队", 3, 25, "2026-03-27", 502876],
] as const)(
  "catalog selection resolves split parts from the original Plex title: %s S%sE%s",
  async (title, season, episode, releaseDate, subjectId) => {
    const context = testContext();
    disposables.push(context.dispose);
    const catalog = createCatalog(
      new CatalogStore(context.database.path).path(),
    );
    for (const subject of splitCourTitles)
      insertSubject(catalog, { ...subject, source: "data" });
    catalog.close();
    // Deliberately return no online results: the local index must also expand beyond exact aliases.
    const api = new BangumiClient(
      "https://offline.invalid",
      "",
      async (request) => {
        expect(new URL(request.url).pathname).toBe("/v0/search/subjects");
        return Response.json({ data: [], total: 0 });
      },
    );
    const trace: Record<string, unknown>[] = [];
    const selected = await MatchingService.selectSubject(
      context,
      {
        ratingKey: "case",
        title,
        originalTitle: "",
        season,
        episode,
        releaseDate,
        mediaType: "episode",
        viewCount: 1,
        lastViewedAt: null,
      },
      api,
      defaultSettings,
      trace,
    );
    expect(selected.id).toBe(subjectId);
    expect(trace.at(-1)).toMatchObject({ step: "date-disambiguation" });
  },
);

test("API results do not inherit the local catalog date or equal-score gates", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const api = new BangumiClient("https://offline.invalid", "", async () =>
    Response.json({
      data: [
        { id: 1, name: "My Anime", name_cn: "", type: 2, date: "2023-06-01" },
        {
          id: 2,
          name: "My Anime Part 2",
          name_cn: "",
          type: 2,
          date: "2024-01-01",
        },
        {
          id: 3,
          name: "My Anime Part 3",
          name_cn: "",
          type: 2,
          date: "2024-01-01",
        },
      ],
      total: 3,
    }),
  );

  expect(
    (
      await MatchingService.selectSubject(
        context,
        {
          ratingKey: "ambiguous",
          title: "My Anime",
          originalTitle: "",
          season: 2,
          episode: 1,
          releaseDate: "2024-01-08",
          mediaType: "episode",
          viewCount: 1,
          lastViewedAt: null,
        },
        api,
        defaultSettings,
      )
    ).id,
  ).toBe(1);
});

test.each([true, false])(
  "a single stale exact title cannot prevent discovering the second cour (catalog enabled: %s)",
  async (dataEnabled) => {
    const context = testContext();
    disposables.push(context.dispose);
    const catalog = createCatalog(
      new CatalogStore(context.database.path).path(),
    );
    const exact = splitCourTitles.find((row) => row.id === 277554);
    if (!exact) throw new Error("Missing fixture");
    insertSubject(catalog, { ...exact, source: "data" });
    catalog.close();
    const calls: string[] = [];
    const api = new BangumiClient(
      "https://offline.invalid",
      "",
      async (request) => {
        const url = new URL(request.url);
        calls.push(url.pathname);
        if (url.pathname === "/v0/search/subjects") {
          const { filter } = (await request.json()) as {
            filter: { air_date?: string[] };
          };
          const rows = splitCourTitles.filter(
            (row) =>
              !filter.air_date ||
              filter.air_date.every((condition: string) =>
                condition.startsWith(">=")
                  ? row.date >= condition.slice(2)
                  : row.date < condition.slice(1),
              ),
          );
          return Response.json({ data: rows, total: rows.length });
        }
        const id = Number(
          url.searchParams.get("subject_id") ?? url.pathname.split("/")[3],
        );
        const ids = [277554, 325585, 373247, 444557];
        if (url.pathname === "/v0/episodes") {
          const episodes =
            mushokuSeasonTwo.find((row) => row.subject.id === id)?.episodes ??
            [];
          return Response.json({ data: episodes, total: episodes.length });
        }
        if (url.pathname.endsWith("/subjects")) {
          const index = ids.indexOf(id);
          return Response.json([
            ...(index > 0 ? [{ id: ids[index - 1], relation: "前传" }] : []),
            ...(index < ids.length - 1
              ? [{ id: ids[index + 1], relation: "续集" }]
              : []),
          ]);
        }
        if (url.pathname.startsWith("/v0/subjects/"))
          return Response.json(splitCourTitles.find((row) => row.id === id));
        throw new Error(`Unexpected request ${url.pathname}`);
      },
    );
    const config = structuredClone(defaultSettings);
    config.bangumi.dataEnabled = dataEnabled;
    for (const episode of [13, 17, 18, 19, 20, 21, 24]) {
      const expected = mushokuSeasonTwo[1]?.episodes.find(
        (row) => row.sort === episode,
      );
      if (!expected) throw new Error("Missing fixture episode");
      const result = await MatchingService.match(
        context,
        {
          ratingKey: String(episode),
          title: exact.name_cn,
          originalTitle: "",
          season: 2,
          episode,
          releaseDate: expected.airdate,
          mediaType: "episode",
          viewCount: 1,
          lastViewedAt: null,
        },
        api,
        config,
      );
      expect(result).toMatchObject({
        subjectId: 444557,
        episodeId: expected.id,
        mapped: false,
      });
    }
    expect(calls).toContain("/v0/search/subjects");
  },
);

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

test("episode zero remains pending and cannot shift positive Plex numbering", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧", start: 0, count: 3 },
    { id: 2, name: "番剧 第二季", start: 0, count: 3 },
  ]);
  await expect(resolve(2, 0)).rejects.toBeInstanceOf(NeedsConfirmation);
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

test("single-episode mappings preserve offsets and reject negative effective episodes", async () => {
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
      episode: 0,
      subjectId: 2,
      episodeOffset: offset,
    });
    const result = MatchingService.match(context, item, api, defaultSettings);
    if (offset < 0)
      await expect(result).rejects.toMatchObject({ code: "EPISODE_RANGE" });
    else if (offset === 0)
      await expect(result).rejects.toBeInstanceOf(NeedsConfirmation);
    else
      expect(await result).toMatchObject({
        subjectId: 2,
        episodeId: 2001,
        mapped: true,
      });
  }
});

test("a single-episode rule pins its subject and takes precedence over season and title aliases", async () => {
  const { context, api } = fixture([
    { id: 1, name: "番剧", count: 3 },
    { id: 2, name: "番剧 第二季", count: 3 },
  ]);
  for (const season of [-1, 2])
    MatchingService.save(context, {
      title: "番剧",
      season,
      subjectId: 2,
      episodeOffset: 0,
    });
  const override = MatchingService.save(context, {
    title: "Original Title",
    season: 2,
    episode: 1,
    subjectId: 1,
    episodeOffset: 0,
  });
  const item = {
    ...testSyncPayload().item,
    originalTitle: "Original Title",
    season: 2,
  };
  expect(
    await MatchingService.match(context, item, api, defaultSettings),
  ).toMatchObject({
    subjectId: 1,
    episodeId: 1001,
  });
  expect(
    await MatchingService.match(
      context,
      { ...item, episode: 2 },
      api,
      defaultSettings,
    ),
  ).toMatchObject({
    subjectId: 2,
    episodeId: 2002,
  });
  MatchingService.delete(context, override.id);
  expect(
    await MatchingService.match(context, item, api, defaultSettings),
  ).toMatchObject({
    subjectId: 2,
    episodeId: 2001,
  });
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

test("cancelling one failed task leaves its matching group intact and prevents grouped confirmation from reviving it", () => {
  const context = testContext();
  disposables.push(context.dispose);
  for (const id of ["cancelled", "remaining"])
    seedCandidate(context, {
      id,
      title: "同一作品",
      season: 1,
      episode: 1,
      accountId: id,
    });

  JobsService.cancel(context, "cancelled");
  expect(MatchingService.candidates(context)).toMatchObject([
    { taskCount: 1, tasks: [{ jobId: "remaining" }] },
  ]);
  expect(SettingsService.read(context).sync.blockedKeywords).toEqual([]);
  expect(() => MatchingService.resolve(context, "cancelled", 10)).toThrow(
    "候选已处理",
  );

  MatchingService.resolve(context, "remaining", 10);
  expect(JobsService.page(context, { state: "pending" }).items).toHaveLength(1);
  expect(JobsService.get(context, "cancelled")?.state).toBe("cancelled");
  expect(
    context.database.orm
      .select()
      .from(jobs)
      .all()
      .filter((job) => job.dedupeKey === "cancelled"),
  ).toHaveLength(1);
});

test.each([true, false])(
  "E00 confirmation stays separate across accounts (confirm zero first: %s)",
  (zeroFirst) => {
    const context = testContext();
    disposables.push(context.dispose);
    const title = "同一作品";
    for (const [id, episode] of [
      ["zero-a", 0],
      ["zero-b", 0],
      ["normal-a", 1],
      ["normal-b", 24],
    ] as const)
      seedCandidate(context, { id, title, episode, season: 2, accountId: id });
    expect(
      MatchingService.candidates(context).map((group) => ({
        episode: group.episode,
        taskCount: group.taskCount,
      })),
    ).toEqual([
      { episode: -1, taskCount: 2 },
      { episode: 0, taskCount: 2 },
    ]);
    const confirmZero = () =>
      MatchingService.resolve(context, "zero-a", 101, 1);
    const confirmNormal = () =>
      MatchingService.resolve(context, "normal-a", 102, 0);
    (zeroFirst ? confirmZero : confirmNormal)();
    expect(MatchingService.candidates(context)).toMatchObject([
      { episode: zeroFirst ? -1 : 0, taskCount: 2 },
    ]);
    const pending = context.database.orm
      .select()
      .from(jobs)
      .all()
      .filter((job) => job.state === "pending");
    expect(pending).toHaveLength(2);
    expect(
      pending.every((job) =>
        job.dedupeKey.startsWith(zeroFirst ? "zero" : "normal"),
      ),
    ).toBe(true);
    (zeroFirst ? confirmNormal : confirmZero)();
    expect(MatchingService.candidates(context)).toHaveLength(0);
    const rules = MatchingService.mappings(context).sort(
      (a, b) => a.episode - b.episode,
    );
    expect(rules).toMatchObject([
      { episode: -1, subjectId: 102, episodeOffset: 0 },
      { episode: 0, subjectId: 101, episodeOffset: 1 },
    ]);
    expect(JobsService.page(context, { state: "pending" }).items).toHaveLength(
      4,
    );
  },
);

test("blocking a work clears its pending confirmations across seasons without retrying unrelated work", () => {
  const context = testContext();
  disposables.push(context.dispose);
  for (const [id, title, season] of [
    ["a", "屏蔽作品", 1],
    ["b", "屏蔽作品", 2],
    ["c", "保留作品", 1],
    ["zero", "屏蔽作品", 2],
  ] as const) {
    seedCandidate(context, {
      id,
      title,
      season,
      episode: id === "zero" ? 0 : 1,
      accountId: "a",
    });
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
      payload: testSyncPayload({
        item: {
          ...testSyncPayload().item,
          title: row.title,
          season: row.season,
          episode: row.episode,
          mediaType: "episode",
        },
        accountId: row.accountId,
        userName: "plex-user",
        plexAccountName: "Home",
        secret: "private-payload",
      }),
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

test.each([373247, 444557])(
  "Mushoku Tensei S2 resolves both cours from mapping entry %s",
  async (entryId) => {
    const context = testContext();
    disposables.push(context.dispose);
    // Public API snapshot: part 1 includes E00 in eps=13; part 2 uses sort 13–24.
    const api = new BangumiClient(
      "https://bangumi.test",
      "",
      async (request) => {
        expect(request.method).toBe("GET");
        const url = new URL(request.url);
        const id = Number(
          url.searchParams.get("subject_id") ?? url.pathname.split("/")[3],
        );
        const segment = mushokuSeasonTwo.find((row) => row.subject.id === id);
        if (!segment) throw new Error(`Unexpected subject ${id}`);
        if (url.pathname === "/v0/episodes") {
          expect(url.searchParams.get("type")).toBe("0");
          return Response.json({
            data: segment.episodes,
            total: segment.episodes.length,
          });
        }
        if (url.pathname.endsWith("/subjects"))
          return Response.json(
            id === 373247
              ? [{ id: 444557, relation: "续集" }]
              : [{ id: 373247, relation: "前传" }],
          );
        return Response.json(segment.subject);
      },
    );
    const item: PlexItem = {
      ratingKey: "mushoku",
      title: "无职转生～到了异世界就拿出真本事～",
      originalTitle: "",
      season: 2,
      episode: 1,
      mediaType: "episode",
      releaseDate: "",
      viewCount: 1,
      lastViewedAt: null,
    };
    const mapping = MatchingService.save(context, {
      title: item.title,
      season: 2,
      subjectId: entryId,
      episodeOffset: 0,
    });
    seedCandidate(context, {
      id: "prologue",
      title: item.title,
      season: 2,
      episode: 0,
      accountId: "a",
    });
    MatchingService.resolve(context, "prologue", 373247, 1);
    expect(MatchingService.mappings(context)).toHaveLength(2);
    expect(
      await MatchingService.match(
        context,
        { ...item, episode: 0 },
        api,
        defaultSettings,
      ),
    ).toMatchObject({ subjectId: 373247, episodeId: 1212094 });
    for (const expected of mushokuSeasonTwo
      .flatMap((row) => row.episodes)
      .filter((row) => row.sort > 0)) {
      const result = await MatchingService.match(
        context,
        { ...item, episode: expected.sort, releaseDate: expected.airdate },
        api,
        defaultSettings,
      );
      expect(result).toMatchObject({
        subjectId: expected.subject_id,
        episodeId: expected.id,
        mapped: true,
      });
      const automatic = await MatchingService.resolveEpisode(
        context,
        { ...item, episode: expected.sort, releaseDate: expected.airdate },
        api,
        entryId,
        false,
        [],
      );
      expect(automatic).toEqual({
        subjectId: expected.subject_id,
        episodeId: expected.id,
      });

      for (const dayShift of [-1, 0, 1]) {
        const releaseDate = new Date(
          Date.parse(expected.airdate) + dayShift * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        expect(
          await MatchingService.resolveEpisode(
            context,
            { ...item, episode: expected.sort, releaseDate },
            api,
            expected.subject_id,
            true,
            [],
          ),
        ).toEqual({ subjectId: expected.subject_id, episodeId: expected.id });
      }

      // Missing dates must not count E00 toward the next cour's offset.
      expect(
        await MatchingService.match(
          context,
          { ...item, episode: expected.sort },
          api,
          defaultSettings,
        ),
      ).toMatchObject({
        subjectId: expected.subject_id,
        episodeId: expected.id,
      });
    }
    await expect(
      MatchingService.match(
        context,
        { ...item, episode: 26 },
        api,
        defaultSettings,
      ),
    ).rejects.toBeInstanceOf(NeedsConfirmation);

    // Confirm through the same path as the UI, then reuse the saved mapping
    // on fresh matches. Plex and Bangumi can disagree by a day at a cour boundary.
    seedCandidate(context, {
      id: "cour-boundary",
      title: item.title,
      season: 2,
      episode: 13,
      accountId: "a",
    });
    MatchingService.resolve(context, "cour-boundary", entryId);
    expect(MatchingService.candidates(context)).toHaveLength(0);
    expect(MatchingService.mappings(context)).toHaveLength(2);
    expect(
      await MatchingService.match(
        context,
        { ...item, episode: 0 },
        api,
        defaultSettings,
      ),
    ).toMatchObject({ subjectId: 373247, episodeId: 1212094 });
    for (const sort of [13, 14, 17, 24]) {
      const expected = mushokuSeasonTwo
        .find((row) => row.subject.id === 444557)
        ?.episodes.find((row) => row.sort === sort);
      if (!expected) throw new Error(`Missing fixture episode ${sort}`);
      for (const shift of [-1, 1]) {
        const releaseDate = new Date(
          Date.parse(expected.airdate) + shift * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        const result = await MatchingService.match(
          { database: context.database },
          { ...item, episode: sort, releaseDate },
          api,
          defaultSettings,
        );
        expect(result).toMatchObject({
          subjectId: 444557,
          episodeId: expected.id,
          mapped: true,
        });
      }
    }

    // Exercise the catalog path that marks a cour as an already matched season.
    MatchingService.delete(context, mapping.id);
    const catalog = createCatalog(
      new CatalogStore(context.database.path).path(),
    );
    for (const subject of splitCourTitles.filter((row) =>
      mushokuSeasonTwo.some((segment) => segment.subject.id === row.id),
    ))
      insertSubject(catalog, { ...subject, source: "data" });
    catalog.close();

    for (const expected of mushokuSeasonTwo
      .flatMap((row) => row.episodes)
      .filter((ep) => ep.sort > 0)) {
      const result = await MatchingService.match(
        context,
        { ...item, episode: expected.sort, releaseDate: expected.airdate },
        api,
        defaultSettings,
      );
      expect(result).toMatchObject({
        subjectId: expected.subject_id,
        episodeId: expected.id,
        mapped: false,
      });
      expect(
        result.trace.some(
          (step) => step.step === "local-catalog" && step.outcome === "hit",
        ),
      ).toBe(true);
    }
  },
);

test.each([
  [7, 5],
  [13, 17],
  [24, 8],
])(
  "cour boundaries come from chapter data (%s chapters followed by %s)",
  async (firstCount, secondCount) => {
    const { context, api } = fixture([
      { id: 1, name: "番剧 第二季", count: firstCount },
      { id: 2, name: "番剧 第二季 第2部分", count: secondCount },
    ]);
    const item: PlexItem = {
      ratingKey: "cour",
      title: "番剧",
      originalTitle: "",
      season: 2,
      episode: firstCount + 1,
      mediaType: "episode",
      releaseDate: "",
      viewCount: 1,
      lastViewedAt: null,
    };
    MatchingService.save(context, {
      title: item.title,
      season: 2,
      subjectId: 1,
      episodeOffset: 0,
    });
    expect(
      await MatchingService.match(context, item, api, defaultSettings),
    ).toMatchObject({ subjectId: 2, episodeId: 2001 });
    expect(
      await MatchingService.match(
        context,
        { ...item, episode: firstCount },
        api,
        defaultSettings,
      ),
    ).toMatchObject({ subjectId: 1, episodeId: 1000 + firstCount });
    expect(
      await MatchingService.match(
        context,
        { ...item, episode: firstCount + secondCount },
        api,
        defaultSettings,
      ),
    ).toMatchObject({ subjectId: 2, episodeId: 2000 + secondCount });
  },
);

test("explicit special-episode offsets still resolve the selected chapter", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    const url = new URL(request.url);
    expect(url.pathname).toBe("/v0/episodes");
    expect(url.searchParams.get("type")).toBe("1");
    return Response.json({
      data: [
        {
          id: 1066854,
          subject_id: 325585,
          type: 1,
          sort: 24,
          ep: 0,
          name: "",
          name_cn: "",
        },
      ],
      total: 1,
    });
  });
  MatchingService.save(context, {
    title: "无职转生",
    season: 0,
    subjectId: 325585,
    episodeOffset: 23,
  });
  expect(
    await MatchingService.match(
      context,
      {
        ratingKey: "sp",
        title: "无职转生",
        originalTitle: "",
        season: 0,
        episode: 1,
        mediaType: "episode",
        releaseDate: "",
        viewCount: 1,
        lastViewedAt: null,
      },
      api,
      defaultSettings,
    ),
  ).toMatchObject({ subjectId: 325585, episodeId: 1066854 });
});

test("equally close chapter dates cannot fall back to a cumulative guess", async () => {
  const { resolve } = fixture([
    { id: 1, name: "番剧 第二季", count: 7, airdate: "2024-05-31" },
    { id: 2, name: "番剧 第二季 第2部分", count: 5, airdate: "2024-06-02" },
  ]);

  await expect(resolve(2, 1, 1, "2024-06-01")).rejects.toBeInstanceOf(
    NeedsConfirmation,
  );
});

test("nearby chapter dates do not bypass ambiguous sequel branches", async () => {
  const { resolve } = fixture(
    [
      { id: 1, name: "番剧 第二季", airdate: "2023-01-01" },
      { id: 2, name: "番剧 第二季 第2部分", airdate: "2024-05-31" },
      { id: 3, name: "番剧 第二季 第2部分", airdate: "2024-04-01" },
    ],
    [
      [1, 2],
      [1, 3],
    ],
  );

  await expect(resolve(2, 1, 1, "2024-06-01")).rejects.toBeInstanceOf(
    NeedsConfirmation,
  );
});

test("manual mappings fall back across reset-numbered cours and keep ambiguous branches pending", async () => {
  const segments = [
    { id: 1, name: "番剧 第二季" },
    { id: 2, name: "番剧 第二季 第2部分" },
  ];
  const { context, api } = fixture(segments);
  const item: PlexItem = {
    ratingKey: "cour",
    title: "番剧",
    originalTitle: "",
    season: 2,
    episode: 13,
    mediaType: "episode",
    releaseDate: "",
    viewCount: 1,
    lastViewedAt: null,
  };
  MatchingService.save(context, {
    title: item.title,
    season: 2,
    subjectId: 1,
    episodeOffset: 0,
  });
  expect(
    await MatchingService.match(context, item, api, defaultSettings),
  ).toMatchObject({ subjectId: 2, episodeId: 2001, mapped: true });
  const branching = fixture(
    [...segments, { id: 3, name: "番剧 第二季 第2部分" }],
    [
      [1, 2],
      [1, 3],
    ],
  );
  MatchingService.save(branching.context, {
    title: item.title,
    season: 2,
    subjectId: 1,
    episodeOffset: 0,
  });
  await expect(
    MatchingService.match(
      branching.context,
      item,
      branching.api,
      defaultSettings,
    ),
  ).rejects.toBeInstanceOf(NeedsConfirmation);
});

test("a manually confirmed subject overrides conflicting dates and falls back when its chapter is absent", async () => {
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
  ).rejects.toBeInstanceOf(NeedsConfirmation);
  expect(calls).toContain("/v0/subjects/443831/subjects");

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
