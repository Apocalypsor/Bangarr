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

test("opening an existing database adds query indexes without changing its rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "bangarr-indexes-"));
  const path = join(directory, "database.sqlite");
  try {
    const db = openDatabase(path);
    db.sqlite.exec(
      "DROP INDEX jobs_dedupe_key; DROP INDEX candidates_job_state; DROP INDEX candidates_state;",
    );
    db.sqlite
      .query(
        "INSERT INTO jobs (id, kind, dedupe_key, payload, state, available_at, created_at, updated_at) VALUES ('kept','sync','key','{}','failed',0,0,0)",
      )
      .run();
    db.close();
    const reopened = openDatabase(path);
    try {
      expect(reopened.sqlite.query("SELECT id FROM jobs").all()).toEqual([
        { id: "kept" },
      ]);
      const latest = reopened.sqlite
        .query(
          "EXPLAIN QUERY PLAN SELECT max(rowid) FROM jobs GROUP BY dedupe_key",
        )
        .all();
      expect(JSON.stringify(latest)).toContain("jobs_dedupe_key");
      expect(JSON.stringify(latest)).not.toContain("TEMP B-TREE");
      const candidates = reopened.sqlite
        .query(
          "EXPLAIN QUERY PLAN SELECT 1 FROM candidates WHERE job_id='job' AND state='pending'",
        )
        .all();
      expect(JSON.stringify(candidates)).toContain("candidates_job_state");
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
