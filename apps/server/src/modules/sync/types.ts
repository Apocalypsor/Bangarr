import type { PlexItem } from "@server/clients/plex";
import type { MatchResult } from "@server/modules/matching/types";

export interface SyncPayload {
  item: PlexItem;
  scope: string;
  userName: string;
  accountId: string;
  action: "watching" | "watched";
  source: string;
  full?: boolean;
  resolved?: MatchResult;
}
