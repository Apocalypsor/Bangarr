import type { AppDatabase } from "@server/db/client";
import { settings } from "@server/db/schema";
import { eq } from "drizzle-orm";

export const insertSettingIfAbsent = (
  database: AppDatabase,
  value: typeof settings.$inferInsert,
) => database.orm.insert(settings).values(value).onConflictDoNothing().run();

export const findSetting = (database: AppDatabase, key: string) =>
  database.orm.select().from(settings).where(eq(settings.key, key)).get();

export const upsertSetting = (
  database: AppDatabase,
  conflictChanges: Partial<typeof settings.$inferInsert>,
  value: typeof settings.$inferInsert,
) =>
  database.orm
    .insert(settings)
    .values(value)
    .onConflictDoUpdate({
      target: settings.key,
      set: conflictChanges,
    })
    .run();
