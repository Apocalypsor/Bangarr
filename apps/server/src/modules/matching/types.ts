import type {
  mappingSchema,
  matchResultSchema,
} from "@server/modules/matching/model";

export type MappingInput = typeof mappingSchema.static;

export interface MatchCandidate {
  id: number;
  name: string;
  nameCn: string;
  date: string;
  score: number;
  source: string;
  seasonMatched?: boolean;
}

export type MatchResult = typeof matchResultSchema.static;
