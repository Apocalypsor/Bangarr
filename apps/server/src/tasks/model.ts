import { plexItemSchema } from "@server/clients/plex/types";
import { matchResultSchema } from "@server/modules/matching/model";
import { t } from "elysia";

export const syncPayloadSchema = t.Object({
  item: plexItemSchema,
  scope: t.String({ minLength: 1 }),
  userName: t.String(),
  accountId: t.String({ minLength: 1 }),
  plexAccountId: t.Optional(t.String()),
  plexAccountName: t.Optional(t.String()),
  action: t.Union([t.Literal("watching"), t.Literal("watched")]),
  source: t.String(),
  full: t.Optional(t.Boolean()),
  resolved: t.Optional(matchResultSchema),
});

export const taskSchema = t.Union([
  t.Object({ kind: t.Literal("sync"), payload: syncPayloadSchema }),
  t.Object({
    kind: t.Literal("plex-scan"),
    payload: t.Object({
      full: t.Optional(t.Boolean()),
      plexAccountId: t.Optional(t.String()),
      plexAccountName: t.Optional(t.String()),
      userName: t.Optional(t.String()),
    }),
  }),
  t.Object({
    kind: t.Literal("catalog-data"),
    payload: t.Record(t.String(), t.Unknown()),
  }),
]);
