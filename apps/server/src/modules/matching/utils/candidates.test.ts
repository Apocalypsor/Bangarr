import { expect, test } from "bun:test";
import type { BangumiSubject } from "@server/clients/bangumi/types";
import {
  apiCandidate,
  selectApiSubject,
  selectCatalogSubject,
} from "@server/modules/matching/utils/candidates";

const item = {
  title: "My Anime",
  originalTitle: "",
  season: 1,
  releaseDate: "2024-01-08",
  mediaType: "episode" as const,
};
const subject = (id: number, name: string, date: string): BangumiSubject => ({
  id,
  name,
  name_cn: "",
  type: 2,
  date,
  platform: "TV",
});

test("local exact dates use 180 days and catalog rejection is a nonterminal miss", () => {
  const rows = [
    subject(1, "My Anime", "2020-01-01"),
    subject(2, "My Anime", "2024-01-01"),
  ];
  expect(
    selectCatalogSubject(rows, { ...item, releaseDate: "2024-03-01" }).candidate
      ?.id,
  ).toBe(2);
  const result = selectCatalogSubject(rows.slice(0, 1), item);
  expect(result.candidate).toBeUndefined();
  expect(result.trace[0]).toMatchObject({ outcome: "miss" });
  expect(result.candidates).toHaveLength(1);
});

test("90 days limits only local partial-date overrides, with stable ties as in the reference", () => {
  const old = subject(1, "My Anime", "2020-01-01");
  const part = subject(20, "My Anime Part 2", "2024-01-01");
  const unrelated = subject(3, "Completely Different", "2024-03-31");
  expect(
    selectCatalogSubject([old, unrelated, part], {
      ...item,
      releaseDate: "2024-03-31",
    }).candidate?.id,
  ).toBe(20);
  expect(
    selectCatalogSubject([old, part], { ...item, releaseDate: "2024-04-01" })
      .candidate,
  ).toBeUndefined();
  expect(
    selectCatalogSubject([old, part, { ...part, id: 2 }], item).candidate?.id,
  ).toBe(20);
  expect(
    selectCatalogSubject([part, { ...part, id: 2 }], {
      ...item,
      title: part.name,
    }).candidate?.id,
  ).toBe(20);
});

test("API selection uses stable platform order, season reselection and no date cutoff", () => {
  const base = subject(9, "My Anime", "2020-01-01");
  const second = subject(2, "My Anime Season 2", "2024-01-01");
  expect(selectApiSubject([second, base], item)).toMatchObject({
    subject: { id: 9 },
    seasonMatched: true,
  });
  expect(
    selectApiSubject([second, base], { ...item, season: 2 }),
  ).toMatchObject({ subject: { id: 2 }, seasonMatched: true });
  expect(
    selectApiSubject([{ ...base, id: 1, platform: "OVA" }, base], item).subject
      ?.id,
  ).toBe(9);
  expect(selectApiSubject([base, { ...base, id: 1 }], item).subject?.id).toBe(
    9,
  );
});

test("season penalty requires explicit conflicting titles, not Plex season metadata", () => {
  const candidate = subject(2, "My Anime Season 2", "2024-01-01");
  expect(apiCandidate(candidate, { ...item, season: 4 }).score).toBe(
    apiCandidate(candidate, item).score,
  );
  expect(
    apiCandidate(candidate, { ...item, title: "My Anime Season 3" }).score,
  ).toBeCloseTo(13 / 14 - 0.15);
});

test("media reselection uses title evidence, independently of platform ranking", () => {
  const feature = {
    ...subject(1, "My Anime", "2024-01-01"),
    platform: "剧场版",
  };
  expect(selectApiSubject([feature], item).subject?.id).toBe(1);
  const ova = { ...subject(2, "My Anime OVA", "2024-01-01"), platform: "" };
  expect(selectApiSubject([ova, feature], item)).toMatchObject({
    subject: { id: 1 },
    seasonMatched: true,
  });
});
