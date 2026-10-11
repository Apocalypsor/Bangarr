import type { AppDatabase } from "@server/db/client";
import { accounts } from "@server/db/schema";
import { findSetting, upsertSetting } from "@server/db/settings";
import { plexAccountSchema } from "@server/modules/plex/model";
import type { PlexAccount } from "@server/modules/plex/types";
import { Value } from "@sinclair/typebox/value";
import { eq } from "drizzle-orm";

export const readPlexAccounts = (database: AppDatabase): PlexAccount[] => {
  const stored = findSetting(database, "plex-accounts");
  return stored ? (JSON.parse(stored.value) as PlexAccount[]) : [];
};

// Run once when opening an existing database. Move encrypted values verbatim;
// an existing account list (including []) always takes precedence.
export const migratePlexSettings = (database: AppDatabase) => {
  database.sqlite
    .transaction(() => {
      const stored = findSetting(database, "app");
      if (!stored) return;
      const saved = JSON.parse(stored.value);
      if (!Object.hasOwn(saved, "plex")) return;
      const legacy = saved.plex;
      if (
        !findSetting(database, "plex-accounts") &&
        legacy?.url &&
        legacy?.userName
      ) {
        const account = {
          ...legacy,
          id: "default",
          name: legacy.userName,
          serverId: "",
        };
        if (!Value.Check(plexAccountSchema, account))
          throw new Error("旧 Plex 配置格式无效，未修改配置");
        writePlexAccounts(database, [
          { ...account, id: "default", serverId: "" },
        ]);
      }

      const sources = readPlexAccounts(database);
      const defaultAccount = sources.find((source) => source.id === "default");
      if (defaultAccount) {
        const ids = new Set(sources.map((source) => source.id));
        for (const account of database.orm.select().from(accounts).all()) {
          const plexUsers = [
            ...new Set(
              account.plexUsers.map((value) =>
                !ids.has(value) && value === defaultAccount.userName
                  ? defaultAccount.id
                  : value,
              ),
            ),
          ];
          if (JSON.stringify(plexUsers) !== JSON.stringify(account.plexUsers))
            database.orm
              .update(accounts)
              .set({ plexUsers })
              .where(eq(accounts.id, account.id))
              .run();
        }
      }
      delete saved.plex;
      upsertSetting(
        database,
        { value: JSON.stringify(saved) },
        { ...stored, value: JSON.stringify(saved) },
      );
    })
    .immediate();
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
