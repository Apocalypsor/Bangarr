import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  adminId: integer("admin_id")
    .notNull()
    .references(() => admins.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  nickname: text("nickname").notNull().default(""),
  accessToken: text("access_token").notNull(),
  plexUsers: text("plex_users", { mode: "json" }).$type<string[]>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  private: integer("private", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    state: text("state", {
      enum: ["pending", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at").notNull(),
    leaseUntil: integer("lease_until"),
    leaseOwner: text("lease_owner"),
    lastError: text("last_error"),
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("jobs_ready").on(table.state, table.availableAt),
    uniqueIndex("jobs_active_key")
      .on(table.dedupeKey)
      .where(sql`${table.state} IN ('pending', 'running')`),
    check(
      "jobs_state_check",
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id"),
    accountId: text("account_id"),
    title: text("title").notNull(),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    mediaType: text("media_type").notNull(),
    plexUser: text("plex_user").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    subjectId: integer("subject_id"),
    episodeId: integer("episode_id"),
    message: text("message").notNull(),
    trace: text("trace", { mode: "json" })
      .$type<Record<string, unknown>[]>()
      .notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("records_created").on(table.createdAt)],
);

export const watched = sqliteTable(
  "watched",
  {
    scope: text("scope").notNull(),
    ratingKey: text("rating_key").notNull(),
    accountId: text("account_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    episodeId: integer("episode_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("watched_identity").on(
      table.scope,
      table.ratingKey,
      table.accountId,
    ),
  ],
);

export const mappings = sqliteTable(
  "mappings",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    season: integer("season").notNull(),
    subjectId: integer("subject_id").notNull(),
    episodeOffset: integer("episode_offset").notNull().default(0),
    resolveSeries: integer("resolve_series", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("mapping_title_season").on(table.title, table.season),
  ],
);

export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    title: text("title").notNull(),
    season: integer("season").notNull(),
    choices: text("choices", { mode: "json" })
      .$type<Record<string, unknown>[]>()
      .notNull(),
    state: text("state", {
      enum: ["pending", "confirmed", "rejected"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "candidates_state_check",
      sql`${table.state} IN ('pending', 'confirmed', 'rejected')`,
    ),
  ],
);
