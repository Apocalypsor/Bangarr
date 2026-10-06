import type { AppDatabase } from "@server/db/client";
import { admins, sessions } from "@server/db/schema";
import { and, eq, gt, lte } from "drizzle-orm";

export const getAdministrator = (database: AppDatabase) =>
  database.orm.select({ id: admins.id }).from(admins).get();

export const insertAdministrator = (
  database: AppDatabase,
  value: typeof admins.$inferInsert,
) => database.orm.insert(admins).values(value).run();

export const findAdministrator = (database: AppDatabase, username: string) =>
  database.orm.select().from(admins).where(eq(admins.username, username)).get();

export const getSessionUser = (
  database: AppDatabase,
  tokenHash: string,
  now: number,
) =>
  database.orm
    .select({ username: admins.username, id: admins.id })
    .from(sessions)
    .innerJoin(admins, eq(sessions.adminId, admins.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .get();

export const deleteSession = (database: AppDatabase, tokenHash: string) =>
  database.orm.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();

export const deleteExpiredSessions = (database: AppDatabase, now: number) =>
  database.orm.delete(sessions).where(lte(sessions.expiresAt, now)).run();

export const insertSession = (
  database: AppDatabase,
  value: typeof sessions.$inferInsert,
) => database.orm.insert(sessions).values(value).run();

export const updateAdministrator = (
  database: AppDatabase,
  id: number,
  previousPasswordHash: string,
  changes: { username: string; passwordHash: string },
) =>
  database.orm
    .update(admins)
    .set(changes)
    .where(
      and(eq(admins.id, id), eq(admins.passwordHash, previousPasswordHash)),
    )
    .returning({ id: admins.id })
    .get();

export const deleteAdministratorSessions = (
  database: AppDatabase,
  adminId: number,
) => database.orm.delete(sessions).where(eq(sessions.adminId, adminId)).run();
