import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@server/db/schema";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export type AppDatabase = ReturnType<typeof openDatabase>;

const migrationsFolder = fileURLToPath(
  new URL("../../migrations", import.meta.url),
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
    const orm = drizzle(sqlite, { schema });
    migrate(orm, { migrationsFolder });
    return { path, sqlite, orm, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();

    throw error;
  }
};

export const transaction = <T>(
  database: AppDatabase,
  callback: () => T,
  mode: "deferred" | "immediate" = "deferred",
) => database.sqlite.transaction(callback)[mode]();
