import { expect, test } from "bun:test";
import type { BangumiSubject } from "@server/clients/bangumi/types";
import { selectDatedSubject } from "@server/modules/matching/utils/candidates";

const pick = (subjects: BangumiSubject[], releaseDate: string) =>
  selectDatedSubject(
    subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      nameCn: subject.name_cn,
      date: subject.date ?? "",
      score: subject.name === "My Anime" ? 1 : 0.5,
      source: "data",
    })),
    new Map(subjects.map((subject) => [subject.id, subject])),
    ["My Anime"],
    releaseDate,
  );

test("exact aliases use the nearest premiere beyond the old seven-day limit", () => {
  expect(
    pick(
      [
        { id: 1, name: "My Anime", name_cn: "", type: 2, date: "2020-01-01" },
        { id: 2, name: "My Anime", name_cn: "", type: 2, date: "2024-01-01" },
      ],
      "2024-03-01",
    ),
  ).toMatchObject({ candidate: { id: 2 }, method: "exact-title-date" });
});

test("partial titles need both name evidence and a date within 90 days", () => {
  const old = {
    id: 1,
    name: "My Anime",
    name_cn: "",
    type: 2,
    date: "2020-01-01",
  };
  const related = {
    id: 2,
    name: "My Anime Part 2",
    name_cn: "",
    type: 2,
    date: "2024-01-01",
  };
  const unrelated = {
    id: 3,
    name: "Completely Different Show",
    name_cn: "",
    type: 2,
    date: "2024-03-31",
  };
  expect(pick([old, unrelated, related], "2024-03-31")).toMatchObject({
    candidate: { id: 2 },
    days: 90,
  });
  expect(pick([old, related], "2024-04-01")).toBeUndefined();
  expect(pick([old, unrelated], "2024-03-31")).toBeUndefined();
});

test("equally dated candidates and invalid dates cannot be resolved by ID", () => {
  const exact = {
    id: 1,
    name: "My Anime",
    name_cn: "",
    type: 2,
    date: "2024-01-01",
  };
  expect(pick([exact, { ...exact, id: 2 }], "2024-01-08")).toBeNull();
  expect(pick([exact], "invalid")).toBeUndefined();
  const old = { ...exact, date: "2020-01-01" };
  const part = { ...exact, id: 2, name: "My Anime Part 2" };
  expect(pick([old, part, { ...part, id: 3 }], "2024-01-08")).toBeNull();
});
