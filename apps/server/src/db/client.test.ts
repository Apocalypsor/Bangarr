import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@server/db/client";
import { mappings } from "@server/db/schema";

test("fresh schema persists mappings and enforces unique title and season", () => {
  const directory = mkdtempSync(join(tmpdir(), "bangarr-schema-"));
  const path = join(directory, "database.sqlite");

  try {
    const database = openDatabase(path);

    database.orm
      .insert(mappings)
      .values({
        id: "exact",
        title: "番剧",
        season: 2,
        subjectId: 100,
        episodeOffset: -12,
        resolveSeries: true,
        createdAt: 1,
      })
      .run();
    expect(() =>
      database.orm
        .insert(mappings)
        .values({
          id: "duplicate",
          title: "番剧",
          season: 2,
          subjectId: 200,
          episodeOffset: 0,
          resolveSeries: false,
          createdAt: 2,
        })
        .run(),
    ).toThrow();
    database.close();

    const reopened = openDatabase(path);

    try {
      expect(reopened.orm.select().from(mappings).all()).toHaveLength(1);
      expect(reopened.orm.select().from(mappings).get()).toMatchObject({
        subjectId: 100,
        episodeOffset: -12,
        resolveSeries: true,
      });
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
