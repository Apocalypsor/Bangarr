import { expect, test } from "bun:test";
import type { BangumiEpisode } from "@server/clients/bangumi";
import {
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
