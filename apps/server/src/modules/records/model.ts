import { t } from "elysia";

export const recordQuerySchema = t.Object({
  status: t.Optional(t.String({ maxLength: 50 })),
  search: t.Optional(t.String({ maxLength: 500 })),
  accountId: t.Optional(t.String({ maxLength: 100 })),
  userName: t.Optional(t.String({ maxLength: 100 })),
  mediaType: t.Optional(t.Union([t.Literal("movie"), t.Literal("episode")])),
  from: t.Optional(t.Numeric({ minimum: 0 })),
  to: t.Optional(t.Numeric({ minimum: 0 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
});
