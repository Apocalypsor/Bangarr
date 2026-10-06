import { t } from "elysia";

export const plexAccountSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  url: t.String({ minLength: 1, maxLength: 2048 }),
  token: t.String({ maxLength: 2048 }),
  userName: t.String({ minLength: 1, maxLength: 100 }),
  enabled: t.Boolean(),
  libraryIds: t.Array(t.String({ pattern: "^[0-9]+$" }), { maxItems: 100 }),
  cron: t.String({ maxLength: 100 }),
});

export const scanSchema = t.Object({ full: t.Boolean() });
export type PlexAccountInput = typeof plexAccountSchema.static;

export const plexConnectionSchema = t.Object({
  url: t.String({ minLength: 1, maxLength: 2048 }),
  token: t.String({ maxLength: 2048 }),
  accountId: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
});

export type PlexConnectionInput = typeof plexConnectionSchema.static;
