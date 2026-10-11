import type { PlexItem, PlexScanIssue } from "@server/clients/plex/types";
import type { MatchResult } from "@server/modules/matching/types";

export interface ScanReport {
  scanned: number;
  queued: number;
  skipped: number;
  failedItems: number;
  failedLibraries: number;
  issues: PlexScanIssue[];
  issuesOmitted: number;
}

export interface SyncPayload {
  item: PlexItem;
  scope: string;
  userName: string;
  accountId: string;
  plexAccountId?: string;
  plexAccountName?: string;
  action: "watching" | "watched";
  source: string;
  full?: boolean;
  resolved?: MatchResult;
}
