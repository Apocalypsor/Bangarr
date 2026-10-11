import type { PlexScanIssue } from "@server/clients/plex/types";
import type { syncPayloadSchema, taskSchema } from "@server/tasks/model";

export type SyncPayload = typeof syncPayloadSchema.static;
export type Task = typeof taskSchema.static;

export interface ScanReport {
  scanned: number;
  queued: number;
  skipped: number;
  failedItems: number;
  failedLibraries: number;
  issues: PlexScanIssue[];
  issuesOmitted: number;
}
