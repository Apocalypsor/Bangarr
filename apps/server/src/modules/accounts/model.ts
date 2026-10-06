import { t } from "elysia";

export const accountSchema = t.Object({
  token: t.String({ maxLength: 2048 }),
  plexUsers: t.Array(t.String({ maxLength: 100 }), { maxItems: 100 }),
  enabled: t.Boolean(),
  private: t.Boolean(),
});
