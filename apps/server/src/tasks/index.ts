import type { AppDatabase } from "@server/db/client";
import { readPlexAccounts } from "@server/db/plex";
import { CatalogService } from "@server/modules/catalog/service";
import { JobsService } from "@server/modules/jobs/service";
import { SettingsService } from "@server/modules/settings/service";
import { TaskService } from "@server/tasks/service";
import type { AppContext } from "@server/types";
import type { SecretVault } from "@server/utils/secrets";
import { Cron } from "croner";

export const startTasks = (database: AppDatabase, vault: SecretVault) => {
  const context: AppContext = { database, vault };
  const owner = crypto.randomUUID();
  let active: Promise<boolean> | null = null;
  let schedulers: Cron[] = [];
  let scheduleKey = "";
  let lastMaintenance = 0;
  let ready = false;
  let stopping = false;

  const refreshRuntime = () => {
    const config = SettingsService.read(context);

    const accounts = readPlexAccounts(database);
    const key = JSON.stringify([
      accounts.map(({ id, enabled, cron }) => ({ id, enabled, cron })),
      config.scheduler.timezone,
    ]);

    if (key !== scheduleKey) {
      for (const scheduler of schedulers) scheduler.stop();
      schedulers = accounts
        .filter((account) => account.enabled)
        .map(
          (account) =>
            new Cron(
              account.cron,
              { timezone: config.scheduler.timezone, protect: true },
              () => {
                JobsService.enqueue(context, {
                  kind: "plex-scan",
                  dedupeKey: `plex-scan:${account.id}`,
                  payload: {
                    full: false,
                    plexAccountId: account.id,
                    plexAccountName: account.name,
                    userName: account.userName,
                  },
                  maxAttempts:
                    SettingsService.read(context).scheduler.maxAttempts,
                });
              },
            ),
        );
      scheduleKey = key;
    }

    if (Date.now() - lastMaintenance > 60_000) {
      CatalogService.maintain(context);
      lastMaintenance = Date.now();
    }

    ready = true;
  };

  const tick = () => {
    if (stopping || !ready || active) return;

    active = TaskService.runOne(context, owner).finally(() => {
      active = null;
    });
  };

  refreshRuntime();
  tick();

  const refreshTimer = setInterval(refreshRuntime, 5000);
  const workerTimer = setInterval(tick, 500);

  return async () => {
    stopping = true;
    clearInterval(refreshTimer);
    clearInterval(workerTimer);
    for (const scheduler of schedulers) scheduler.stop();
    await active;
  };
};
