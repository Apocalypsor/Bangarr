import { defaultJobMaxAttempts } from "@server/db/schema";
import { t } from "elysia";

export const settingsSchema = t.Object(
  {
    sync: t.Object({
      confidence: t.Number({ minimum: 0, maximum: 1 }),
      realAction: t.Boolean(),
      movieWatching: t.Boolean(),
      movieCompleted: t.Boolean(),
      animeCompleted: t.Boolean(),
      blockedKeywords: t.Array(t.String({ minLength: 1, maxLength: 200 }), {
        maxItems: 500,
      }),
    }),
    scheduler: t.Object({
      timezone: t.String({ maxLength: 100 }),
      maxAttempts: t.Integer({ minimum: 1, maximum: 50 }),
    }),
    bangumi: t.Object({
      apiUrl: t.String({ maxLength: 2048 }),
      dataUrl: t.String({ maxLength: 2048 }),
      dataEnabled: t.Boolean(),
      dataRefreshDays: t.Integer({ minimum: 1, maximum: 365 }),
    }),
  },
  { additionalProperties: false },
);

export type Settings = typeof settingsSchema.static;

export const defaultSettings: Settings = {
  sync: {
    confidence: 0.6,
    realAction: false,
    movieWatching: true,
    movieCompleted: true,
    animeCompleted: false,
    blockedKeywords: [],
  },
  scheduler: { timezone: "Asia/Shanghai", maxAttempts: defaultJobMaxAttempts },
  bangumi: {
    apiUrl: "https://api.bgm.tv",
    dataUrl: "https://unpkg.com/bangumi-data@0.3/dist/data.json",
    dataEnabled: true,
    dataRefreshDays: 7,
  },
};
