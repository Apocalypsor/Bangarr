import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "@server/db/schema";
import { drizzle } from "drizzle-orm/bun-sqlite";

export type AppDatabase = ReturnType<typeof openDatabase>;

const initialSchema = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
);

export const openDatabase = (path: string) => {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const sqlite = new Database(path, { create: true, strict: true });

  try {
    sqlite.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
    sqlite
      .transaction(() => {
        const initialized = sqlite
          .query(`
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            LIMIT 1
          `)
          .get();

        if (!initialized) sqlite.exec(initialSchema);
      })
      .immediate();
  } catch (error) {
    sqlite.close();

    throw error;
  }

  return {
    path,
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
};

export const transaction = <T>(
  database: AppDatabase,
  callback: () => T,
  mode: "deferred" | "immediate" = "deferred",
) => database.sqlite.transaction(callback)[mode]();
