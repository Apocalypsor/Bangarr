import type { AppDatabase } from "@server/db/client";
import { findSetting, upsertSetting } from "@server/db/settings";
import type { PlexAccount } from "@server/modules/plex/types";

export const readPlexAccounts = (database: AppDatabase): PlexAccount[] => {
  const stored = findSetting(database, "plex-accounts");
  if (stored) return JSON.parse(stored.value) as PlexAccount[];

  // Preserve the configured single account until the first account edit.
  const legacy = JSON.parse(findSetting(database, "app")?.value ?? "{}").plex;
  return legacy?.url && legacy?.userName
    ? [{ ...legacy, id: "default", name: legacy.userName, serverId: "" }]
    : [];
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
