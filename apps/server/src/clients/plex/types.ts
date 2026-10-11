import { t } from "elysia";

export interface PlexLibrary {
  id: string;
  title: string;
  type: "show" | "movie";
}

export const plexItemSchema = t.Object({
  ratingKey: t.String({ minLength: 1 }),
  title: t.String({ minLength: 1 }),
  originalTitle: t.String(),
  season: t.Integer({ minimum: 0 }),
  episode: t.Integer({ minimum: 0 }),
  mediaType: t.Union([t.Literal("episode"), t.Literal("movie")]),
  releaseDate: t.String(),
  viewCount: t.Integer({ minimum: 0 }),
  lastViewedAt: t.Union([t.Number(), t.Null()]),
});
export type PlexItem = typeof plexItemSchema.static;

export interface PlexScanIssue {
  id: string;
  scope: "item" | "library";
  libraryId: string;
  libraryTitle: string;
  ratingKey: string | null;
  title: string | null;
  message: string;
  retryable: boolean;
  retryAfter: number;
}

export type PlexScanEvent =
  | { type: "item"; item: PlexItem }
  | { type: "issue"; issue: PlexScanIssue };

export interface PlexContainer {
  [key: string]: unknown;
}
