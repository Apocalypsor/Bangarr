import { expect, test } from "bun:test";
import {
  baseTitle,
  normalizeTitle,
  seasonNumbers,
  similarity,
} from "@server/modules/matching/utils/title";

test("normalization handles Unicode spacing and retains meaningful titles", () => {
  expect(normalizeTitle(" 【我推的孩子】 {tmdb-203737} ")).toBe("我推的孩子");
  expect(similarity("葬送的芙莉莲", " 葬送的芙莉莲 ")).toBe(1);
  expect(similarity("", "a")).toBe(0);
  expect(similarity("abc", "axc")).toBeCloseTo(2 / 3);
});

test("explicit seasons include conflicting declarations rather than silently picking one", () => {
  expect([...seasonNumbers("番剧 第十二季")]).toEqual([12]);
  expect([...seasonNumbers("Name 2nd Season")]).toEqual([2]);
  expect(seasonNumbers("Name Season 1 第二季")).toEqual(new Set([1, 2]));
  expect(baseTitle("番剧 第二季")).toBe(baseTitle("番剧"));
});
