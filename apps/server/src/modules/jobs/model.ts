import { t } from "elysia";

export const jobsQuerySchema = t.Object({
  state: t.Optional(
    t.Union([
      t.Literal("active"),
      t.Literal("waiting"),
      t.Literal("retrying"),
      t.Literal("pending"),
      t.Literal("running"),
      t.Literal("succeeded"),
      t.Literal("failed"),
      t.Literal("cancelled"),
    ]),
  ),
  kind: t.Optional(
    t.Union([
      t.Literal("plex-scan"),
      t.Literal("catalog-data"),
      t.Literal("sync"),
    ]),
  ),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  offset: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })),
});

export type JobsQuery = typeof jobsQuerySchema.static;
