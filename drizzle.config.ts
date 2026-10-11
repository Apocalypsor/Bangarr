import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./apps/server/src/db/schema.ts",
  out: "./apps/server/migrations",
});
