import type { jobs } from "@server/db/schema";
import type { Task } from "@server/tasks/types";

export type Job = typeof jobs.$inferSelect;

export type EnqueueInput = Task & {
  dedupeKey: string;
  maxAttempts?: number;
  availableAt?: number;
};
