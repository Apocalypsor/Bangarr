import { t } from "elysia";

export const loginSchema = t.Object({
  username: t.String({ minLength: 1, maxLength: 100 }),
  password: t.String({ minLength: 12, maxLength: 200 }),
});
