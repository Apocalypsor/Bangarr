import type { AppDatabase } from "@server/db/client";
import { CatalogService } from "@server/modules/catalog/service";
import { JobsService } from "@server/modules/jobs/service";
import { SettingsService } from "@server/modules/settings/service";
import { SyncService } from "@server/modules/sync/service";
import type { AppContext } from "@server/types";
import type { SecretVault } from "@server/utils/secrets";
import { Cron } from "croner";

export const startTasks = (database: AppDatabase, vault: SecretVault) => {
  const context: AppContext = { database, vault };
  const owner = crypto.randomUUID();
  let active: Promise<boolean> | null = null;
  let scheduler: Cron | null = null;
  let scheduleKey = "";
  let lastMaintenance = 0;
  let ready = false;
  let stopping = false;

  const refreshRuntime = () => {
    const config = SettingsService.read(context);

    const key = JSON.stringify([
      config.plex.enabled,
      config.plex.cron,
      config.scheduler.timezone,
    ]);

    if (key !== scheduleKey) {
      scheduler?.stop();
      scheduler = null;
      scheduleKey = key;

      if (config.plex.enabled) {
        scheduler = new Cron(
          config.plex.cron,
          { timezone: config.scheduler.timezone, protect: true },
          () => {
            JobsService.enqueue(context, {
              kind: "plex-scan",
              dedupeKey: "plex-scan",
              payload: { full: false },
              maxAttempts: SettingsService.read(context).scheduler.maxAttempts,
            });
          },
        );
      }
    }

    if (Date.now() - lastMaintenance > 60_000) {
      CatalogService.maintain(context);
      lastMaintenance = Date.now();
    }

    ready = true;
  };

  const tick = () => {
    if (stopping || !ready || active) return;

    active = SyncService.runOne(context, owner).finally(() => {
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
    scheduler?.stop();
    await active;
  };
};
