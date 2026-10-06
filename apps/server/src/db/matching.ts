import type { AppDatabase } from "@server/db/client";
import { candidates, mappings } from "@server/db/schema";
import { and, asc, desc, eq, or } from "drizzle-orm";

export const listMappings = (database: AppDatabase) =>
  database.orm.select().from(mappings).orderBy(desc(mappings.createdAt)).all();

export const getMapping = (database: AppDatabase, id: string) =>
  database.orm.select().from(mappings).where(eq(mappings.id, id)).get();

export const findMappingIdentity = (
  database: AppDatabase,
  title: string,
  season: number,
) =>
  database.orm
    .select()
    .from(mappings)
    .where(and(eq(mappings.title, title), eq(mappings.season, season)))
    .get();

export const updateMapping = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof mappings.$inferInsert>,
) =>
  database.orm
    .update(mappings)
    .set(changes)
    .where(eq(mappings.id, id))
    .returning()
    .get();

export const upsertMapping = (
  database: AppDatabase,
  conflictChanges: Partial<typeof mappings.$inferInsert>,
  value: typeof mappings.$inferInsert,
) =>
  database.orm
    .insert(mappings)
    .values(value)
    .onConflictDoUpdate({
      target: [mappings.title, mappings.season],
      set: conflictChanges,
    })
    .returning()
    .get();

export const deleteMapping = (database: AppDatabase, id: string) =>
  database.orm.delete(mappings).where(eq(mappings.id, id)).run();

export const listPendingCandidates = (database: AppDatabase) =>
  database.orm
    .select()
    .from(candidates)
    .where(eq(candidates.state, "pending"))
    .orderBy(desc(candidates.createdAt))
    .all();

export const getPendingCandidate = (database: AppDatabase, id: string) =>
  database.orm
    .select()
    .from(candidates)
    .where(and(eq(candidates.id, id), eq(candidates.state, "pending")))
    .get();

export const updateCandidateState = (
  database: AppDatabase,
  id: string,
  changes: Partial<typeof candidates.$inferInsert>,
) =>
  database.orm
    .update(candidates)
    .set(changes)
    .where(eq(candidates.id, id))
    .run();

export const findSeasonMappings = (database: AppDatabase, season: number) =>
  database.orm
    .select()
    .from(mappings)
    .where(or(eq(mappings.season, season), eq(mappings.season, -1)))
    .orderBy(asc(mappings.createdAt), asc(mappings.id))
    .all();
