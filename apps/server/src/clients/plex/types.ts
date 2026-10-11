export interface PlexLibrary {
  id: string;
  title: string;
  type: "show" | "movie";
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  originalTitle: string;
  season: number;
  episode: number;
  mediaType: "episode" | "movie";
  releaseDate: string;
  viewCount: number;
  lastViewedAt: number | null;
}

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
