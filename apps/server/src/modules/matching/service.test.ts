import { afterEach, expect, test } from "bun:test";
import type { BangumiEpisode, BangumiSubject } from "@server/clients/bangumi";
import { BangumiClient } from "@server/clients/bangumi";
import type { PlexItem } from "@server/clients/plex";
import { CatalogStore, createCatalog, insertSubject } from "@server/db/catalog";
import {
  MatchingService,
  NeedsConfirmation,
} from "@server/modules/matching/service";
import { defaultSettings } from "@server/modules/settings/model";
import { testContext } from "@server/utils/testing";

interface Segment {
  id: number;
  name: string;
  start?: number;
  count?: number;
  platform?: string;
  type?: number;
  omit?: number;
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
        releaseDate: "",
        viewCount: 1,
        lastViewedAt: null,
      } satisfies PlexItem,
      api,
      root,
      false,
      [],
    );

  return { resolve, calls };
};

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
