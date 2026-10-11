import { t } from "elysia";

export const mappingSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 500 }),
  season: t.Integer({ minimum: -1, maximum: 100 }),
  subjectId: t.Integer({ minimum: 1 }),
  episodeOffset: t.Integer({ minimum: -9999, maximum: 9999 }),
  resolveSeries: t.Optional(t.Boolean()),
});

export const resolveCandidateSchema = t.Object({
  subjectId: t.Union([t.Integer({ minimum: 1 }), t.Null()]),
  episodeOffset: t.Integer({ minimum: -9999, maximum: 9999 }),
});

export const matchResultSchema = t.Object({
  subjectId: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  episodeId: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  trace: t.Array(t.Record(t.String(), t.Unknown())),
  mapped: t.Boolean(),
});
