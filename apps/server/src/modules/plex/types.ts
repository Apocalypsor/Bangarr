import type { PlexAccountInput } from "@server/modules/plex/model";

export interface PlexAccount extends PlexAccountInput {
  id: string;
  serverId: string;
}
