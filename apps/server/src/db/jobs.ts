import type { AppDatabase } from "@server/db/client";
import { accounts, candidates, jobs } from "@server/db/schema";
import type { JobsQuery } from "@server/modules/jobs/model";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

export const findActiveJob = (database: AppDatabase, dedupeKey: string) =>
  database.orm
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.dedupeKey, dedupeKey),
        inArray(jobs.state, ["pending", "running"]),
      ),
    )
    .get();

export const insertJob = (
  database: AppDatabase,
  value: typeof jobs.$inferInsert,
) => database.orm.insert(jobs).values(value).returning().get();

export const recoverExpiredJobs = (database: AppDatabase, now: number) =>
  database.sqlite
    .query(
      "UPDATE jobs SET state=CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'pending' END, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE state='running' AND lease_until<=?",
    )
    .run(now, now);

export const findReadyJob = (database: AppDatabase, now: number) =>
  database.sqlite
    .query<
      {
        id: string;
      },
      [number]
    >(
      "SELECT id FROM jobs WHERE state='pending' AND available_at<=? AND attempt<max_attempts ORDER BY available_at,created_at,id LIMIT 1",
    )
    .get(now);

export const assignJobLease = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(eq(jobs.id, id))
    .returning()
    .get();

export const incrementJobAttempt = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(eq(jobs.id, id))
    .returning()
    .get();

export const renewJobLease = (
  database: AppDatabase,
  id: string,
  owner: string,
  now: number,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.leaseOwner, owner),
        eq(jobs.state, "running"),
        gt(jobs.leaseUntil, now),
      ),
    )
    .returning({ id: jobs.id })
    .get();

export const checkpointJob = (
  database: AppDatabase,
  id: string,
  owner: string,
  now: number,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.leaseOwner, owner),
        eq(jobs.state, "running"),
        gt(jobs.leaseUntil, now),
      ),
    )
    .returning({ id: jobs.id })
    .get();

export const completeJob = (
  database: AppDatabase,
  id: string,
  owner: string,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.leaseOwner, owner),
        eq(jobs.state, "running"),
      ),
    )
    .returning()
    .get();

export const updateJobFailure = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof jobs.$inferInsert>,
) => database.orm.update(jobs).set(changes).where(eq(jobs.id, id)).run();

export const cancelPendingJob = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof jobs.$inferInsert>,
) =>
  database.orm
    .update(jobs)
    .set(changes)
    .where(and(eq(jobs.id, id), eq(jobs.state, "pending")))
    .returning()
    .get();

export const getJob = (database: AppDatabase, id: string) =>
  database.orm.select().from(jobs).where(eq(jobs.id, id)).get();

export const listJobs = (
  database: AppDatabase,
  limit: number,
  offset: number,
) =>
  database.orm
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

export const listTaskPage = (database: AppDatabase, filter: JobsQuery) => {
  const where = and(
    filter.state ? eq(jobs.state, filter.state) : undefined,
    filter.kind ? eq(jobs.kind, filter.kind) : undefined,
  );
  const limit = filter.limit ?? 30;
  const offset = filter.offset ?? 0;

  return database.sqlite.transaction(() => {
    const order = [
      sql`case ${jobs.state} when 'running' then 0 when 'pending' then 1 else 2 end`,
      desc(jobs.createdAt),
      desc(jobs.id),
    ];
    const ids = database.orm
      .select({ id: jobs.id })
      .from(jobs)
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => row.id);

    return {
      items: ids.length
        ? database.orm
            .select({
              id: jobs.id,
              kind: jobs.kind,
              state: jobs.state,
              attempt: jobs.attempt,
              maxAttempts: jobs.maxAttempts,
              lastError: jobs.lastError,
              result: jobs.result,
              availableAt: jobs.availableAt,
              createdAt: jobs.createdAt,
              updatedAt: jobs.updatedAt,
              title: sql<
                string | null
              >`json_extract(${jobs.payload}, '$.item.title')`,
              season: sql<
                number | null
              >`json_extract(${jobs.payload}, '$.item.season')`,
              episode: sql<
                number | null
              >`json_extract(${jobs.payload}, '$.item.episode')`,
              userName: sql<
                string | null
              >`json_extract(${jobs.payload}, '$.userName')`,
              accountName: accounts.username,
              plexAccountName: sql<
                string | null
              >`json_extract(${jobs.payload}, '$.plexAccountName')`,
              needsConfirmation:
                sql<boolean>`exists(select 1 from ${candidates} where ${candidates.jobId} = ${jobs.id} and ${candidates.state} = 'pending')`.mapWith(
                  Boolean,
                ),
            })
            .from(jobs)
            .leftJoin(
              accounts,
              eq(
                accounts.id,
                sql`json_extract(${jobs.payload}, '$.accountId')`,
              ),
            )
            .where(inArray(jobs.id, ids))
            .orderBy(...order)
            .all()
        : [],
      total:
        database.orm
          .select({ count: sql<number>`count(*)` })
          .from(jobs)
          .where(where)
          .get()?.count ?? 0,
      counts: database.orm
        .select({ state: jobs.state, count: sql<number>`count(*)` })
        .from(jobs)
        .groupBy(jobs.state)
        .all(),
      limit,
      offset,
    };
  })();
};
