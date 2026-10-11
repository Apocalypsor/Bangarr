import { expect, test } from "bun:test";
import golden from "@server/modules/matching/fixtures/reference-title-golden.json";
import { apiCandidate } from "@server/modules/matching/utils/candidates";
import {
  normalizeTitle,
  searchVariants,
  seasonNumbers,
  stripSeasonSuffix,
  titleRatio,
} from "@server/modules/matching/utils/title";

test("index normalization and Indel ratio retain their separate purposes", () => {
  expect(normalizeTitle(" 【我推的孩子】 {tmdb-203737} ")).toBe("我推的孩子");
  expect(titleRatio("abc", "axc")).toBeCloseTo(2 / 3);
  expect(titleRatio("", "a")).toBe(0);
});

test("explicit seasons include conflicting declarations", () => {
  expect([...seasonNumbers("番剧 第十二季")]).toEqual([12]);
  expect([...seasonNumbers("Name 2nd Season")]).toEqual([2]);
  expect(seasonNumbers("Name Season 1 第二季")).toEqual(new Set([1, 2]));
  expect(stripSeasonSuffix("番剧 第二季")).toBe("番剧");
});

test("API scores agree with the reference Python implementation and RapidFuzz", () => {
  for (const row of golden.scores) {
    const candidate = apiCandidate(
      {
        id: 1,
        name: row.aliases[0] ?? "",
        name_cn: row.aliases[1] ?? "",
        type: 2,
      },
      { ...row, season: 1, releaseDate: "", mediaType: "episode" },
    );
    expect(
      candidate.score,
      `${row.title} / ${row.aliases.join(" / ")}`,
    ).toBeCloseTo(row.score, 10);
  }
});

test("fallback query order agrees with the reference Python implementation", () => {
  for (const row of golden.variants)
    expect(searchVariants(row.title, row.originalTitle), row.title).toEqual(
      row.expected,
    );
});
