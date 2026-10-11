import { expect, test } from "bun:test";
import { parsePlexItem } from "@server/clients/plex/utils";

const episode = (key: string, viewCount = 1) => ({
  ratingKey: key,
  type: "episode",
  grandparentTitle: "测试番剧",
  parentIndex: 1,
  index: Number(key),
  viewCount,
});

test("incomplete episode metadata fails safely", () => {
  expect(() =>
    parsePlexItem({ ...episode("1"), parentIndex: undefined }),
  ).toThrow("季度");
  expect(
    parsePlexItem({ ...episode("1"), originalTitle: "a single episode" })
      .originalTitle,
  ).toBe("");
});

test("episode zero is valid while absent or invalid season and episode numbers remain invalid", () => {
  for (const index of [0, "0", "00"])
    expect(
      parsePlexItem({ ...episode("1"), parentIndex: 2, index }),
    ).toMatchObject({
      season: 2,
      episode: 0,
    });

  for (const field of ["index", "parentIndex"])
    for (const value of [
      undefined,
      null,
      "",
      " ",
      false,
      true,
      [],
      -1,
      0.5,
      "oops",
    ])
      expect(() => parsePlexItem({ ...episode("1"), [field]: value })).toThrow(
        "季度、集数无效",
      );
});
