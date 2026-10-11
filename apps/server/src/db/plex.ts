import type { AppDatabase } from "@server/db/client";
import { findSetting, upsertSetting } from "@server/db/settings";
import type { PlexAccount } from "@server/modules/plex/types";

export const readPlexAccounts = (database: AppDatabase): PlexAccount[] => {
  const stored = findSetting(database, "plex-accounts");
  return stored ? (JSON.parse(stored.value) as PlexAccount[]) : [];
};

export const writePlexAccounts = (
  database: AppDatabase,
  accounts: PlexAccount[],
) => {
  const row = {
    key: "plex-accounts",
    value: JSON.stringify(accounts),
    updatedAt: Date.now(),
  };
  upsertSetting(database, row, row);
};
