import type { AppDatabase } from "@server/db/client";
import { accounts } from "@server/db/schema";
import { eq } from "drizzle-orm";

export const listAccounts = (database: AppDatabase) =>
  database.orm.select().from(accounts).all();

export const getAccount = (database: AppDatabase, id: string) =>
  database.orm.select().from(accounts).where(eq(accounts.id, id)).get();

export const listEnabledAccounts = (database: AppDatabase) =>
  database.orm.select().from(accounts).where(eq(accounts.enabled, true)).all();

export const upsertAccount = (
  database: AppDatabase,
  conflictChanges: Partial<typeof accounts.$inferInsert>,
  value: typeof accounts.$inferInsert,
) =>
  database.orm
    .insert(accounts)
    .values(value)
    .onConflictDoUpdate({ target: accounts.id, set: conflictChanges })
    .run();

export const deleteAccount = (database: AppDatabase, id: string) =>
  database.orm.delete(accounts).where(eq(accounts.id, id)).run();
