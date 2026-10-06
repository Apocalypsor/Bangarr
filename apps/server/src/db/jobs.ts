import type { AppDatabase } from "@server/db/client";
import { jobs } from "@server/db/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

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

export const listBackgroundStatus = (database: AppDatabase) =>
  ["plex-scan", "catalog-data"].flatMap((kind) => {
    const job = database.orm
      .select({
        id: jobs.id,
        kind: jobs.kind,
        state: jobs.state,
        lastError: jobs.lastError,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(eq(jobs.kind, kind))
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(1)
      .get();

    return job ? [job] : [];
  });
