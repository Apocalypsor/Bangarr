import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@server/db/client";
import { mappings } from "@server/db/schema";
import { openLegacyTestDatabase } from "@server/utils/testing";
import { readMigrationFiles } from "drizzle-orm/migrator";

test("fresh schema persists mappings and enforces unique title, season and episode", () => {
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

test("mapping migration preserves existing offsets and permits an independent E00 rule", () => {
  const directory = mkdtempSync(join(tmpdir(), "bangarr-mapping-migration-"));
  const path = join(directory, "database.sqlite");
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../migrations", import.meta.url),
    ),
  });
  const old = openLegacyTestDatabase(path);
  try {
    // Reproduce a database that has already recorded migrations 0000–0002.
    old.sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    for (const [index, migration] of migrations.slice(0, 3).entries()) {
      if (index > 0)
        for (const statement of migration.sql) old.sqlite.exec(statement);
      old.sqlite
        .query(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(migration.hash, migration.folderMillis);
    }
    old.sqlite
      .query(
        "INSERT INTO mappings (id, title, season, subject_id, episode_offset, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("kept", "作品", 2, 444557, 25, 7);
  } finally {
    old.close();
  }
  try {
    const database = openDatabase(path);
    try {
      const original = database.orm.select().from(mappings).get();
      expect(original).toEqual({
        id: "kept",
        title: "作品",
        season: 2,
        episode: -1,
        subjectId: 444557,
        episodeOffset: 25,
        resolveSeries: false,
        createdAt: 7,
      });
      if (!original) throw new Error("Missing migrated mapping");
      const single = {
        ...original,
        id: "zero",
        episode: 0,
        subjectId: 373247,
        episodeOffset: 1,
      };
      database.orm.insert(mappings).values(single).run();
      expect(() =>
        database.orm
          .insert(mappings)
          .values({ ...single, id: "duplicate" })
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
    const reopened = openDatabase(path);
    try {
      expect(reopened.orm.select().from(mappings).all()).toHaveLength(2);
      expect(reopened.sqlite.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
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
    const db = openLegacyTestDatabase(path);
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

test("Drizzle records each migration once and does not rerun applied SQL", () => {
  const directory = mkdtempSync(join(tmpdir(), "bangarr-migrations-"));
  const path = join(directory, "database.sqlite");
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../migrations", import.meta.url),
    ),
  });
  const expected = migrations.map((migration) => ({
    hash: migration.hash,
    created_at: migration.folderMillis,
  }));
  try {
    const first = openDatabase(path);
    expect(
      first.sqlite
        .query(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
        )
        .all(),
    ).toEqual(expected);
    // Applied migrations must not become perpetual repair routines on startup.
    first.sqlite.exec("DROP INDEX candidates_state");
    first.close();
    const second = openDatabase(path);
    try {
      expect(
        second.sqlite
          .query(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
          )
          .all(),
      ).toEqual(expected);
      expect(
        second.sqlite
          .query("SELECT name FROM sqlite_master WHERE name='candidates_state'")
          .all(),
      ).toEqual([]);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
