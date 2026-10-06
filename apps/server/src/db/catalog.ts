import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BangumiSubject } from "@server/clients/bangumi";
import { normalizeTitle } from "@server/modules/matching/utils/title";
import { AppError } from "@server/utils/errors";

export interface CatalogSubject extends BangumiSubject {
  aliases?: string[];
  source: "data";
}

interface JsonRow {
  data: string;
}

export class CatalogStore {
  readonly directory: string;

  constructor(databasePath: string) {
    this.directory = join(dirname(databasePath), "catalog");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  path() {
    return join(this.directory, "data.sqlite");
  }

  updatedAt() {
    return (
      this.read((db) =>
        Number(
          db
            .query<
              {
                value: string;
              },
              []
            >("SELECT value FROM meta WHERE key='updatedAt'")
            .get()?.value ?? 0,
        ),
      ) ?? 0
    );
  }

  status() {
    return (
      this.read((db) => ({
        ready: true,
        subjects:
          db
            .query<
              {
                count: number;
              },
              []
            >("SELECT count(*) AS count FROM subjects")
            .get()?.count ?? 0,
        updatedAt: Number(
          db
            .query<
              {
                value: string;
              },
              []
            >("SELECT value FROM meta WHERE key='updatedAt'")
            .get()?.value ?? 0,
        ),
      })) ?? { ready: false, subjects: 0, updatedAt: 0 }
    );
  }

  search(names: string[]) {
    const found = new Map<number, CatalogSubject>();

    this.read((db) => {
      for (const name of names) {
        const normalized = normalizeTitle(name);

        if (!normalized) continue;

        const exact = db
          .query<JsonRow, [string]>(
            "SELECT subjects.data FROM names JOIN subjects ON subjects.id=names.subject_id WHERE names.title=? LIMIT 100",
          )
          .all(normalized);

        for (const row of exact) {
          const subject = JSON.parse(row.data) as CatalogSubject;

          found.set(subject.id, { ...subject, source: "data" });
        }

        if (exact.length || [...normalized].length < 3) continue;

        const chars = [...normalized];

        const grams = [
          ...new Set(
            chars
              .slice(0, -2)
              .map((_, index) => chars.slice(index, index + 3).join("")),
          ),
        ].slice(0, 30);

        const query = grams
          .map((gram) => `"${gram.replaceAll('"', '""')}"`)
          .join(" OR ");

        const fuzzy = db
          .query<JsonRow, [string]>(
            "SELECT subjects.data FROM name_search JOIN subjects ON subjects.id=name_search.subject_id WHERE name_search MATCH ? ORDER BY rank LIMIT 60",
          )
          .all(query);

        for (const row of fuzzy) {
          const subject = JSON.parse(row.data) as CatalogSubject;

          found.set(subject.id, { ...subject, source: "data" });
        }
      }
    });

    return [...found.values()];
  }

  private read<T>(callback: (db: Database) => T): T | null {
    if (!existsSync(this.path())) return null;

    const db = new Database(this.path(), { readonly: true });

    try {
      return callback(db);
    } finally {
      db.close();
    }
  }
}

export const createCatalog = (path: string) => {
  const db = new Database(path, { create: true });

  db.exec(`
    PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
    CREATE TABLE subjects(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE names(title TEXT NOT NULL,subject_id INTEGER NOT NULL,PRIMARY KEY(title,subject_id));
    CREATE VIRTUAL TABLE name_search USING fts5(title,subject_id UNINDEXED,tokenize='trigram');
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);

  return db;
};

export const insertSubject = (db: Database, subject: CatalogSubject) => {
  db.query("INSERT OR REPLACE INTO subjects(id,data) VALUES(?,?)").run(
    subject.id,
    JSON.stringify(subject),
  );

  const names = new Set(
    [subject.name, subject.name_cn, ...(subject.aliases ?? [])]
      .map(normalizeTitle)
      .filter(Boolean),
  );

  for (const title of names) {
    db.query("INSERT OR IGNORE INTO names(title,subject_id) VALUES(?,?)").run(
      title,
      subject.id,
    );
    db.query("INSERT INTO name_search(title,subject_id) VALUES(?,?)").run(
      title,
      subject.id,
    );
  }
};

export const finalizeCatalog = (db: Database) => {
  db.query("INSERT OR REPLACE INTO meta(key,value) VALUES('updatedAt',?)").run(
    String(Date.now()),
  );
  db.exec(
    "INSERT INTO name_search(name_search) VALUES('optimize'); PRAGMA optimize;",
  );

  const check = db
    .query<
      {
        integrity_check: string;
      },
      []
    >("PRAGMA integrity_check")
    .get();

  if (check?.integrity_check !== "ok")
    throw new AppError(500, "CATALOG_INTEGRITY", "标题索引完整性检查失败");
};
