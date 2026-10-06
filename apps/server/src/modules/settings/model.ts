import { t } from "elysia";

export const settingsSchema = t.Object({
  plex: t.Object({
    enabled: t.Boolean(),
    url: t.String({ maxLength: 2048 }),
    token: t.String({ maxLength: 2048 }),
    userName: t.String({ maxLength: 100 }),
    libraryIds: t.Array(t.String({ pattern: "^[0-9]+$" }), { maxItems: 100 }),
    cron: t.String({ maxLength: 100 }),
  }),
  sync: t.Object({
    confidence: t.Number({ minimum: 0, maximum: 1 }),
    minMargin: t.Number({ minimum: 0, maximum: 1 }),
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
});

export type Settings = typeof settingsSchema.static;

export const defaultSettings: Settings = {
  plex: {
    enabled: false,
    url: "",
    token: "",
    userName: "",
    libraryIds: [],
    cron: "*/15 * * * *",
  },
  sync: {
    confidence: 0.85,
    minMargin: 0.1,
    realAction: false,
    movieWatching: true,
    movieCompleted: true,
    animeCompleted: false,
    blockedKeywords: [],
  },
  scheduler: { timezone: "Asia/Shanghai", maxAttempts: 5 },
  bangumi: {
    apiUrl: "https://api.bgm.tv",
    dataUrl: "https://unpkg.com/bangumi-data@0.3/dist/data.json",
    dataEnabled: true,
    dataRefreshDays: 7,
  },
};
