import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@server/db/client";
import { writePlexAccounts } from "@server/db/plex";
import type { PlexAccountInput } from "@server/modules/plex/model";
import type { SyncPayload } from "@server/tasks/types";
import { SecretVault } from "@server/utils/secrets";

export const testContext = () => {
  const directory = mkdtempSync(join(tmpdir(), "bangumi-test-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  const vault = new SecretVault(crypto.getRandomValues(new Uint8Array(32)));

  return {
    directory,
    database,
    vault,
    dispose: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};

export const seedPlexAccount = (
  context: ReturnType<typeof testContext>,
  input: Partial<PlexAccountInput> = {},
) => {
  writePlexAccounts(context.database, [
    {
      id: "default",
      name: "Home",
      serverId: "",
      enabled: true,
      url: "http://plex",
      userName: "alice",
      libraryIds: ["1"],
      cron: "*/15 * * * *",
      ...input,
      token: context.vault.seal(input.token ?? "plex-secret"),
    },
  ]);
};

export const testSyncPayload = (
  changes: Partial<SyncPayload> & Record<string, unknown> = {},
): SyncPayload & Record<string, unknown> => ({
  item: {
    title: "番剧",
    originalTitle: "",
    ratingKey: "1",
    season: 1,
    episode: 1,
    mediaType: "episode",
    releaseDate: "",
    viewCount: 1,
    lastViewedAt: null,
  },
  scope: "test",
  userName: "alice",
  accountId: "test",
  source: "test",
  action: "watched",
  ...changes,
});
