import type { AppDatabase } from "@server/db/client";
import { candidates, records, watched } from "@server/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

export interface HistoryFilter {
  status?: string;
  search?: string;
  accountId?: string;
  userName?: string;
  mediaType?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export const insertWatched = (
  database: AppDatabase,
  value: typeof watched.$inferInsert,
) => database.orm.insert(watched).values(value).onConflictDoNothing().run();

export const insertSyncRecord = (
  database: AppDatabase,
  value: typeof records.$inferInsert,
) => database.orm.insert(records).values(value).run();

export const findPendingJobCandidate = (database: AppDatabase, jobId: string) =>
  database.orm
    .select()
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), eq(candidates.state, "pending")))
    .get();

export const insertMatchingCandidate = (
  database: AppDatabase,
  value: typeof candidates.$inferInsert,
) => database.orm.insert(candidates).values(value).run();

export const findWatched = (
  database: AppDatabase,
  scope: string,
  ratingKey: string,
  accountId: string,
) =>
  database.orm
    .select()
    .from(watched)
    .where(
      and(
        eq(watched.scope, scope),
        eq(watched.ratingKey, ratingKey),
        eq(watched.accountId, accountId),
      ),
    )
    .get();

export const listSyncRecords = (
  database: AppDatabase,
  filter: HistoryFilter,
) => {
  const where = and(
    filter.status ? eq(records.status, filter.status) : undefined,
    filter.search
      ? sql`instr(lower(${records.title}),lower(${filter.search}))>0`
      : undefined,
    filter.accountId ? eq(records.accountId, filter.accountId) : undefined,
    filter.userName ? eq(records.plexUser, filter.userName) : undefined,
    filter.mediaType ? eq(records.mediaType, filter.mediaType) : undefined,
    filter.from === undefined ? undefined : gte(records.createdAt, filter.from),
    filter.to === undefined ? undefined : lte(records.createdAt, filter.to),
  );

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  return database.sqlite.transaction(() => ({
    items: database.orm
      .select()
      .from(records)
      .where(where)
      .orderBy(desc(records.createdAt), desc(records.id))
      .limit(limit)
      .offset(offset)
      .all(),
    total:
      database.orm
        .select({ count: sql<number>`count(*)` })
        .from(records)
        .where(where)
        .get()?.count ?? 0,
    limit,
    offset,
  }))();
};

export const getSyncRecord = (database: AppDatabase, id: string) =>
  database.orm.select().from(records).where(eq(records.id, id)).get();
