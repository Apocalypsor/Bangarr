import { afterEach, expect, test } from "bun:test";
import { BangumiClient } from "@server/clients/bangumi";
import type {
  BangumiEpisode,
  BangumiRelation,
  BangumiSubject,
} from "@server/clients/bangumi/types";
import { CatalogStore, createCatalog, insertSubject } from "@server/db/catalog";
import { NeedsConfirmation } from "@server/modules/matching/errors";
import graph from "@server/modules/matching/fixtures/series-episodes.json";
import searches from "@server/modules/matching/fixtures/series-search.json";
import { MatchingService } from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { testContext } from "@server/utils/testing";

interface SearchRequest {
  keyword: string;
  sort: string;
  filter: { air_date?: string[]; type: number[]; nsfw: boolean };
}

const disposables: (() => void)[] = [];
const snapshots = new Map<
  number,
  {
    subject: BangumiSubject;
    episodes: BangumiEpisode[];
    relations: BangumiRelation[];
  }
>(
  Object.values(graph).map((row) => [
    row.subject.id,
    {
      ...row,
      episodes: row.episodes.map((ep) => ({ ...ep, name: "", name_cn: "" })),
    },
  ]),
);
const cases = [
  ...Array.from({ length: 12 }, (_, i) => ({
    title: "药屋少女的呢喃",
    season: 1,
    episode: i + 37,
    subjectId: 486347,
    sort: i + 37,
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    title: "关于我转生变成史莱姆这档事",
    season: 4,
    episode: i + 12,
    subjectId: 515594,
    sort: i + 84,
  })),
  {
    title: "Re：从零开始的异世界生活",
    season: 1,
    episode: 76,
    subjectId: 547888,
    sort: 76,
  },
  {
    title: "【我推的孩子】",
    season: 1,
    episode: 24,
    subjectId: 443428,
    sort: 24,
  },
];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

test.each([true, false])(
  "all four reported series resolve to actual chapter IDs, catalog=%s",
  async (dataEnabled) => {
    const context = testContext();
    disposables.push(context.dispose);
    const catalog = createCatalog(
      new CatalogStore(context.database.path).path(),
    );
    for (const row of new Map(
      Object.values(searches)
        .flat()
        .map((row) => [row.id, row]),
    ).values())
      insertSubject(catalog, { ...row, source: "data" });
    catalog.close();
    const searchCalls: SearchRequest[] = [];
    const api = new BangumiClient(
      "https://bangumi.test",
      "",
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/v0/search/subjects") {
          expect(request.method).toBe("POST");
          const body = (await request.json()) as SearchRequest;
          searchCalls.push(body);
          const rows = (
            Object.entries(searches).find(
              ([title]) => title.normalize("NFKC") === body.keyword,
            )?.[1] ?? []
          )
            .filter(
              (row) =>
                !body.filter.air_date ||
                body.filter.air_date.every((condition: string) => {
                  if (!("date" in row) || !row.date) return false;
                  return condition.startsWith(">=")
                    ? row.date >= condition.slice(2)
                    : row.date < condition.slice(1);
                }),
            )
            .slice(0, Number(url.searchParams.get("limit")));
          return Response.json({ data: rows, total: rows.length });
        }
        expect(request.method).toBe("GET");
        const id = Number(
          url.searchParams.get("subject_id") ?? url.pathname.split("/")[3],
        );
        const row = snapshots.get(id);
        if (!row) throw new Error(`Unexpected subject ${id}`);
        if (url.pathname === "/v0/episodes")
          return Response.json({
            data: row.episodes,
            total: row.episodes.length,
          });
        if (url.pathname.endsWith("/subjects"))
          return Response.json(row.relations);
        return Response.json(row.subject);
      },
    );
    const config = structuredClone(defaultSettings);
    config.bangumi.dataEnabled = dataEnabled;
    // Existing user thresholds are preserved; these cases do not depend on lowering 0.85.
    config.sync.confidence = 0.85;
    for (const entry of cases) {
      const expected = snapshots
        .get(entry.subjectId)
        ?.episodes.find((ep) => ep.sort === entry.sort);
      if (!expected)
        throw new Error(
          `Missing expected chapter ${entry.subjectId}:${entry.sort}`,
        );
      const result = await MatchingService.match(
        context,
        {
          ...entry,
          originalTitle: "",
          releaseDate: expected.airdate ?? "",
          mediaType: "episode",
          ratingKey: "fixture",
          viewCount: 1,
          lastViewedAt: null,
        },
        api,
        config,
      );
      expect(result, JSON.stringify(entry)).toMatchObject({
        subjectId: entry.subjectId,
        episodeId: expected.id,
        mapped: false,
      });
    }
    expect(searchCalls.some((call) => call.filter.air_date?.length === 2)).toBe(
      true,
    );
    expect(searchCalls.some((call) => !call.filter.air_date)).toBe(true);
  },
);

test("failed date search continues to undated variants; exhausted transport failures remain retryable", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const item = {
    title: "番剧 第二季",
    originalTitle: "",
    season: 2,
    episode: 1,
    releaseDate: "2024-04-01",
    mediaType: "episode" as const,
    ratingKey: "test",
    viewCount: 1,
    lastViewedAt: null,
  };
  const keywords: string[] = [];
  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    const { keyword, filter } = (await request.json()) as SearchRequest;
    if (filter.air_date) throw new Error("connection unavailable");
    keywords.push(keyword);
    const data =
      keyword === "番剧"
        ? [{ id: 5, name: "番剧 第二季", name_cn: "", type: 2 }]
        : [];
    return Response.json({ data, total: data.length });
  });
  expect(
    (await MatchingService.selectSubject(context, item, api, defaultSettings))
      .id,
  ).toBe(5);
  expect(keywords).toEqual(["番剧 第二季", "番剧"]);
  const offline = new BangumiClient("https://bangumi.test", "", async () => {
    throw new Error("offline");
  });
  await expect(
    MatchingService.selectSubject(context, item, offline, defaultSettings),
  ).rejects.toMatchObject({ code: "REMOTE_UNREACHABLE" });
});

test("low confidence remains pending with candidates after all variants miss", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    const { filter } = (await request.json()) as SearchRequest;
    return Response.json({
      data: filter.air_date
        ? [{ id: 1, type: 2, name: "xyz", name_cn: "" }]
        : [],
      total: 1,
    });
  });
  const item = {
    title: "abcdef",
    originalTitle: "",
    season: 1,
    episode: 1,
    releaseDate: "2024-01-01",
    mediaType: "episode" as const,
    ratingKey: "test",
    viewCount: 1,
    lastViewedAt: null,
  };
  try {
    await MatchingService.selectSubject(context, item, api, defaultSettings);
    throw new Error("Expected confirmation");
  } catch (error) {
    expect(error).toBeInstanceOf(NeedsConfirmation);
    expect((error as NeedsConfirmation).candidates).toMatchObject([{ id: 1 }]);
  }
});

test("date-filtered searches prefer original titles and extend movie windows by 200 days", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const calls: SearchRequest[] = [];
  const api = new BangumiClient("https://bangumi.test", "", async (request) => {
    const body = (await request.json()) as SearchRequest;
    calls.push(body);
    expect(new URL(request.url).searchParams.get("limit")).toBe("5");
    const data =
      body.filter.air_date?.[1] === "<2024-07-19"
        ? [
            {
              id: 4,
              name: "My Movie",
              name_cn: "",
              type: 2,
              platform: "剧场版",
            },
          ]
        : [];
    return Response.json({ data, total: data.length });
  });
  const selected = await MatchingService.selectSubject(
    context,
    {
      title: "我的电影",
      originalTitle: "My Movie",
      season: 1,
      episode: 1,
      releaseDate: "2024-01-01",
      mediaType: "movie",
      ratingKey: "test",
      viewCount: 1,
      lastViewedAt: null,
    },
    api,
    defaultSettings,
  );
  expect(selected.id).toBe(4);
  expect(calls).toEqual([
    {
      keyword: "My Movie",
      sort: "match",
      filter: {
        type: [2],
        nsfw: true,
        air_date: [">=2023-12-30", "<2024-01-03"],
      },
    },
    {
      keyword: "我的电影",
      sort: "match",
      filter: {
        type: [2],
        nsfw: true,
        air_date: [">=2023-12-30", "<2024-01-03"],
      },
    },
    {
      keyword: "My Movie",
      sort: "match",
      filter: {
        type: [2],
        nsfw: true,
        air_date: [">=2023-12-30", "<2024-07-19"],
      },
    },
  ]);
});

test("post-search reselection checks the chosen subject's confidence", async () => {
  const context = testContext();
  disposables.push(context.dispose);
  const api = new BangumiClient("https://bangumi.test", "", async () =>
    Response.json({
      data: [
        { id: 1, name: "My Anime Season 2", name_cn: "", type: 2 },
        { id: 2, name: "My Anime", name_cn: "", type: 2 },
      ],
      total: 2,
    }),
  );
  const config = structuredClone(defaultSettings);
  config.sync.confidence = 0.95;
  await expect(
    MatchingService.selectSubject(
      context,
      {
        title: "My Anime Season 2",
        originalTitle: "",
        season: 1,
        episode: 1,
        releaseDate: "",
        mediaType: "episode",
        ratingKey: "test",
        viewCount: 1,
        lastViewedAt: null,
      },
      api,
      config,
    ),
  ).rejects.toBeInstanceOf(NeedsConfirmation);
});
