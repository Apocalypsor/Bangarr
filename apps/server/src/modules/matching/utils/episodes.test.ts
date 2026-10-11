import { expect, test } from "bun:test";
import type { BangumiEpisode } from "@server/clients/bangumi/types";
import {
  findCumulativeEpisode,
  findDatedEpisode,
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

test("local numbering follows the reference sort minus first normal sort plus one", () => {
  const episodes = [episode(10, 0, 1), episode(11, 1, 2), episode(12, 2, 3)];
  expect(findLocalEpisode(episodes, 1)?.id).toBe(10);
  expect(findLocalEpisode(episodes, 2)?.id).toBe(11);
  expect(findLocalEpisode(episodes, 3)?.id).toBe(12);
  expect(findLocalEpisode([episode(1, 76, 1), episode(2, 77, 2)], 2)?.id).toBe(
    2,
  );
});

test("same-season fallback counts actual normal chapters including a prologue", () => {
  const first = {
    subject: { id: 1, name: "番剧 第二季", name_cn: "", type: 2, eps: 13 },
    episodes: Array.from({ length: 13 }, (_, i) => episode(100 + i, i, i + 1)),
  };
  const second = {
    subject: {
      id: 2,
      name: "番剧 第二季 第2部分",
      name_cn: "",
      type: 2,
      eps: 12,
    },
    episodes: Array.from({ length: 12 }, (_, i) =>
      episode(200 + i, 13 + i, i + 1),
    ),
  };
  expect(findCumulativeEpisode([first, second], 0)).toBeUndefined();
  expect(findCumulativeEpisode([first, second], 13)).toEqual({
    subjectId: 1,
    episodeId: 112,
  });
  expect(findCumulativeEpisode([first, second], 14)).toEqual({
    subjectId: 2,
    episodeId: 200,
  });
  expect(findCumulativeEpisode([first, second], 17)).toEqual({
    subjectId: 2,
    episodeId: 203,
  });
  expect(findCumulativeEpisode([first, second], 25)).toEqual({
    subjectId: 2,
    episodeId: 211,
  });
  first.episodes = first.episodes.filter((row) => row.sort !== 12);
  expect(findCumulativeEpisode([first, second], 13)).toBeUndefined();
  expect(findCumulativeEpisode([first, second], 14)).toEqual({
    subjectId: 2,
    episodeId: 200,
  });
});

test("chapter airdate resolution follows numbering, a 120-day bound and unique dates", () => {
  const segment = (id: number, airdate: string) => ({
    subject: { id, name: "番剧 第二季", name_cn: "", type: 2 },
    episodes: [
      { ...episode(id * 100, 8), airdate },
      { ...episode(id * 100 + 1, 9), airdate: "2024-06-01" },
    ],
  });
  const first = segment(1, "2024-01-01");
  const second = segment(2, "2024-05-31");
  // Another chapter has the exact date, but only the requested number competes.
  expect(findDatedEpisode([first, second], 8, "2024-06-01")).toEqual({
    subjectId: 2,
    episodeId: 200,
    days: 1,
  });
  expect(findDatedEpisode([first], 8, "2024-04-30")?.days).toBe(120);
  expect(findDatedEpisode([first], 8, "2024-05-01")).toBeUndefined();
  expect(
    findDatedEpisode([second, segment(3, "2024-06-02")], 8, "2024-06-01"),
  ).toBeNull();
  expect(findDatedEpisode([second], 0, "2024-05-31")).toBeUndefined();
  expect(findDatedEpisode([second], 3, "2024-05-31")).toBeUndefined();
  expect(findDatedEpisode([second], 8, "invalid")).toBeUndefined();
  expect(findDatedEpisode([second], 8, "")).toBeUndefined();
  expect(findDatedEpisode([segment(3, "")], 8, "2024-06-01")).toBeUndefined();
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
  expect(findMergedSeasonEpisode(episodes, 2, 1)?.id).toBe(3);
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
