import { expect, test } from "bun:test";
import { openDatabase } from "@server/db/client";
import { readPlexAccounts, writePlexAccounts } from "@server/db/plex";
import { accounts } from "@server/db/schema";
import { SettingsService } from "@server/modules/settings/service";
import { testContext } from "@server/utils/testing";

test.each([false, true])(
  "opening a database migrates legacy Plex settings once (deleted accounts: %s)",
  (deleted) => {
    const context = testContext();
    const token = context.vault.seal("preserved-secret");
    const legacy = {
      url: "http://plex",
      userName: "alice",
      token,
      enabled: true,
      libraryIds: ["2"],
      cron: "0 * * * *",
    };
    SettingsService.set(
      context,
      "app",
      JSON.stringify({ plex: legacy, sync: { animeCompleted: true } }),
    );
    context.database.orm
      .insert(accounts)
      .values({
        id: "bgm",
        username: "bgm",
        accessToken: token,
        plexUsers: ["alice"],
        createdAt: 1,
      })
      .run();
    if (deleted) writePlexAccounts(context.database, []);
    context.database.sqlite.exec("DROP TABLE __drizzle_migrations");
    context.database.close();
    const database = openDatabase(context.database.path);
    try {
      const sources = readPlexAccounts(database);
      expect(sources).toHaveLength(deleted ? 0 : 1);
      if (!deleted) {
        expect(sources[0]).toMatchObject({ ...legacy, id: "default" });
        expect(context.vault.open(sources[0]?.token ?? "")).toBe(
          "preserved-secret",
        );
        expect(database.orm.select().from(accounts).get()?.plexUsers).toEqual([
          "default",
        ]);
      }
      const saved = JSON.parse(
        SettingsService.get({ ...context, database }, "app") ?? "{}",
      );
      expect(saved).toEqual({ sync: { animeCompleted: true } });
      writePlexAccounts(database, []);
      const reopened = openDatabase(database.path);
      try {
        expect(readPlexAccounts(reopened)).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      database.close();
      context.dispose();
    }
  },
);

test("general settings cannot reintroduce a second Plex configuration", () => {
  const context = testContext();
  try {
    const config = SettingsService.read(context);
    expect(config).not.toHaveProperty("plex");
    expect(() =>
      SettingsService.save(context, {
        ...config,
        plex: { cron: "0 * * * *" },
      } as typeof config),
    ).toThrow("设置格式");
    expect(SettingsService.get(context, "app")).toBeUndefined();
  } finally {
    context.dispose();
  }
});

test("existing Plex accounts win over stale configuration and failed migration keeps the original", () => {
  const context = testContext();
  try {
    const legacy = {
      url: "http://old",
      userName: "alice",
      token: "encrypted",
      enabled: true,
      libraryIds: [],
      cron: "0 * * * *",
    };
    const current = {
      ...legacy,
      id: "current",
      name: "Current",
      serverId: "server",
      url: "http://current",
    };
    SettingsService.set(
      context,
      "app",
      JSON.stringify({ plex: legacy, sync: { animeCompleted: true } }),
    );
    writePlexAccounts(context.database, [current]);
    context.database.sqlite.exec("DROP TABLE __drizzle_migrations");
    openDatabase(context.database.path).close();
    expect(readPlexAccounts(context.database)).toEqual([current]);
    expect(SettingsService.read(context).sync.animeCompleted).toBe(true);

    context.database.sqlite.exec(
      "DELETE FROM settings WHERE key='plex-accounts'",
    );
    const invalid = JSON.stringify({ plex: { ...legacy, libraryIds: 1 } });
    SettingsService.set(context, "app", invalid);
    context.database.sqlite.exec("DROP TABLE __drizzle_migrations");
    context.database.sqlite.exec("DROP INDEX jobs_dedupe_key");
    expect(() => openDatabase(context.database.path)).toThrow();
    expect(SettingsService.get(context, "app")).toBe(invalid);
    expect(SettingsService.get(context, "plex-accounts")).toBeUndefined();
    expect(
      context.database.sqlite
        .query("SELECT count(*) AS total FROM __drizzle_migrations")
        .get(),
    ).toEqual({ total: 0 });
    expect(
      context.database.sqlite
        .query("SELECT name FROM sqlite_master WHERE name='jobs_dedupe_key'")
        .all(),
    ).toEqual([]);
    // Fix the data and retry: all pending schema/data changes commit together.
    SettingsService.set(context, "app", JSON.stringify({ plex: legacy }));
    openDatabase(context.database.path).close();
    expect(readPlexAccounts(context.database)[0]?.id).toBe("default");
    expect(
      context.database.sqlite
        .query("SELECT count(*) AS total FROM __drizzle_migrations")
        .get(),
    ).toEqual({ total: 3 });
  } finally {
    context.dispose();
  }
});
