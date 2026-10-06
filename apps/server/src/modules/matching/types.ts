import type { mappingSchema } from "@server/modules/matching/model";

export type MappingInput = typeof mappingSchema.static;

export interface MatchCandidate {
  id: number;
  name: string;
  nameCn: string;
  date: string;
  score: number;
  source: string;
}

export interface MatchResult {
  subjectId: number;
  episodeId: number;
  trace: Record<string, unknown>[];
  mapped: boolean;
}
