import type { jobs } from "@server/db/schema";

export type Job = typeof jobs.$inferSelect;

export interface EnqueueInput {
  kind: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: number;
}
