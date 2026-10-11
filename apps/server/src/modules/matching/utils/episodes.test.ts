import { expect, test } from "bun:test";
import type { BangumiEpisode } from "@server/clients/bangumi/types";
import { findEpisode } from "@server/modules/matching/utils/candidates";
import {
  findCumulativeEpisode,
  findLocalEpisode,
  findMergedSeasonEpisode,
} from "@server/modules/matching/utils/episodes";

const episode = (
  id: number,
  sort: number,
  ep?: number,
  type = 0,
): BangumiEpisode => ({
  id,
  subject_id: 1,
  name: "",
  name_cn: "",
  sort,
  ep,
  type,
});

test("episode zero matches only an explicit unique sort zero and does not shift later episodes", () => {
  const episodes = [episode(10, 0, 0), episode(11, 1, 0), episode(12, 2, 0)];
  expect(findLocalEpisode(episodes, 0)?.id).toBe(10);
  expect(findLocalEpisode(episodes, 1)?.id).toBe(11);
  expect(findLocalEpisode(episodes, 2)?.id).toBe(12);
  expect(findLocalEpisode([episode(11, 1, 0)], 0)).toBeUndefined();
  expect(findLocalEpisode([episode(10, 0), episode(20, 0)], 0)).toBeUndefined();
  expect(findLocalEpisode([episode(10, 0), episode(11, 13)], 1)?.id).toBe(11);
  const longSeries = Array.from({ length: 100 }, (_, i) => ({
    ...episode(i + 1, i + 1, 0),
    airdate: i === 0 ? "2026-01-01" : "",
  }));
  expect(findEpisode(longSeries, 0, true, "2026-01-01")).toBeUndefined();
});

test("a cour prologue does not shift cumulative episode counts", () => {
  const segments = [
    {
      subject: { id: 1, name: "番剧", name_cn: "", type: 2, eps: 2 },
      episodes: [episode(10, 0), episode(11, 1), episode(12, 2)],
    },
    {
      subject: { id: 2, name: "番剧 Part 2", name_cn: "", type: 2, eps: 2 },
      episodes: [episode(20, 0), episode(21, 1), episode(22, 2)],
    },
  ];
  expect(findCumulativeEpisode(segments, 0)).toEqual({
    subjectId: 1,
    episodeId: 10,
  });
  expect(findCumulativeEpisode(segments, 1)).toEqual({
    subjectId: 1,
    episodeId: 11,
  });
  expect(findCumulativeEpisode(segments, 3)).toEqual({
    subjectId: 2,
    episodeId: 21,
  });
});

test("a merged season starting at zero stays in that season", () => {
  const episodes = [
    episode(1, 1),
    episode(2, 2),
    episode(3, 0),
    episode(4, 1),
    episode(5, 2),
  ];
  expect(findMergedSeasonEpisode(episodes, 2, 0)?.id).toBe(3);
  expect(findMergedSeasonEpisode(episodes, 2, 1)?.id).toBe(4);
  expect(findMergedSeasonEpisode(episodes, 3, 0)).toBeUndefined();
});

test("local episode number takes precedence for subjects starting at global sort 76", () => {
  const episodes = Array.from({ length: 24 }, (_, i) =>
    episode(100 + i, 76 + i),
  );

  expect(findLocalEpisode(episodes, 1)?.id).toBe(100);
  expect(findLocalEpisode(episodes, 24)?.id).toBe(123);
  expect(findLocalEpisode(episodes, 83)?.id).toBe(107);
});

test("OP/ED do not affect normal episode offsets", () => {
  expect(
    findLocalEpisode(
      [episode(1, 0, undefined, 2), episode(2, 13), episode(3, 14)],
      1,
    )?.id,
  ).toBe(2);
});

test("merged seasons can have globally increasing sort with reset ep", () => {
  const episodes = [
    episode(1, 1, 1),
    episode(2, 2, 2),
    episode(3, 3, 1),
    episode(4, 4, 2),
  ];

  expect(findMergedSeasonEpisode(episodes, 2, 1)?.id).toBe(3);
  expect(findMergedSeasonEpisode(episodes, 2, 2)?.id).toBe(4);
  expect(findMergedSeasonEpisode(episodes, 3, 1)).toBeUndefined();
});

test("episode metadata without ep uses sort resets and stays within target season", () => {
  const episodes = [episode(1, 1), episode(2, 2), episode(3, 1), episode(4, 2)];

  expect(findMergedSeasonEpisode(episodes, 2, 1)?.id).toBe(3);
  expect(findMergedSeasonEpisode(episodes, 2, 3)).toBeUndefined();
});
