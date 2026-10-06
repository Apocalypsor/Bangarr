import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "@server/app";
import type { Settings } from "@server/modules/settings/model";
import { testContext } from "@server/utils/testing";

const disposables: (() => void)[] = [];

const fixture = () => {
  const context = testContext();

  disposables.push(context.dispose);

  return { ...context, app: createApp(context) };
};

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  origin?: string,
) =>
  new Request(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const credentials = { username: "admin", password: "a-strong-test-password" };

const login = async (app: ReturnType<typeof createApp>) => {
  const response = await app.handle(
    request("/auth/setup", "POST", credentials),
  );

  expect(response.status).toBe(200);

  const cookie = response.headers.get("set-cookie")?.split(";")[0];

  expect(cookie).toBeTruthy();

  return cookie ?? "";
};

describe("management authentication", () => {
  test("authentication status stays public when feature guards are composed", async () => {
    const { app } = fixture();
    const response = await app.handle(request("/auth/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ needsSetup: true });
    expect((await app.handle(request("/auth/logout", "POST"))).status).toBe(
      401,
    );
  });
  test("mapping edits require authentication and retain identity when title or scope changes", async () => {
    const { app } = fixture();

    const input = {
      title: "原始标题",
      season: 1,
      subjectId: 10,
      episodeOffset: 0,
    };

    expect(
      (await app.handle(request("/mappings/unknown", "PUT", input))).status,
    ).toBe(401);

    const cookie = await login(app);
    const created = await app.handle(
      request("/mappings", "POST", input, cookie),
    );
    const row = (await created.json()) as {
      id: string;
    };

    expect(created.status).toBe(200);
    expect(
      (
        await app.handle(
          request(
            `/mappings/${row.id}`,
            "PUT",
            { ...input, title: "新标题", season: -1, resolveSeries: true },
            cookie,
          ),
        )
      ).status,
    ).toBe(200);

    const rows = (await (
      await app.handle(request("/mappings", "GET", undefined, cookie))
    ).json()) as {
      id: string;
      title: string;
      season: number;
      resolveSeries: boolean;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: row.id,
      title: "新标题",
      season: -1,
      resolveSeries: true,
    });
  });
  test("empty configured public origin uses the request origin for same-site setup", async () => {
    const context = fixture();
    const app = createApp({ ...context, publicOrigin: "" });

    const response = await app.handle(
      request(
        "/auth/setup",
        "POST",
        credentials,
        undefined,
        "http://localhost",
      ),
    );

    expect(response.status).toBe(200);
  });
  test("all management surfaces reject anonymous requests", async () => {
    const { app } = fixture();

    for (const path of [
      "/settings",
      "/settings/webhook",
      "/accounts",
      "/plex/libraries",
      "/jobs",
      "/records",
      "/catalog",
      "/mappings",
      "/candidates",
    ])
      expect((await app.handle(request(path))).status).toBe(401);

    expect((await app.handle(request("/health"))).status).toBe(200);
  });
  test("setup once, password hashed, cookie session persists, logout revokes", async () => {
    const { app, database } = fixture();
    const response = await app.handle(
      request("/auth/setup", "POST", credentials),
    );
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "samesite=strict",
    );
    expect(
      (await app.handle(request("/auth/setup", "POST", credentials))).status,
    ).toBe(409);

    const row = database.sqlite
      .query<
        {
          password_hash: string;
        },
        []
      >("SELECT password_hash FROM admins")

      .get();

    expect(row?.password_hash).not.toContain(credentials.password);
    expect(
      (await app.handle(request("/settings", "GET", undefined, cookie))).status,
    ).toBe(200);

    const reopenedApp = createApp({ database, vault: fixture().vault });

    expect(
      (
        await reopenedApp.handle(
          request("/auth/status", "GET", undefined, cookie),
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.handle(request("/auth/logout", "POST", {}, cookie))).status,
    ).toBe(200);
    expect(
      (await app.handle(request("/settings", "GET", undefined, cookie))).status,
    ).toBe(401);
  });
  test("cross-origin writes and concurrent setup are rejected", async () => {
    const { app } = fixture();

    expect(
      (
        await app.handle(
          request(
            "/auth/setup",
            "POST",
            credentials,
            undefined,
            "https://evil.test",
          ),
        )
      ).status,
    ).toBe(403);

    const result = await Promise.all([
      app.handle(request("/auth/setup", "POST", credentials)),
      app.handle(request("/auth/setup", "POST", credentials)),
    ]);

    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  test("failed login rate limit cannot be bypassed by request headers", async () => {
    const { app } = fixture();

    await login(app);

    for (let i = 0; i < 5; i++) {
      const req = request("/auth/login", "POST", {
        ...credentials,
        password: "incorrect-long-password",
      });

      req.headers.set("x-forwarded-for", `192.0.2.${i}`);
      expect((await app.handle(req)).status).toBe(401);
    }

    expect(
      (await app.handle(request("/auth/login", "POST", credentials))).status,
    ).toBe(429);
  });
  test("settings mask credentials, encrypt storage, preserve empty secret, validate schedule", async () => {
    const { app, database } = fixture();
    const cookie = await login(app);

    const config = (await (
      await app.handle(request("/settings", "GET", undefined, cookie))
    ).json()) as Settings;

    config.plex = {
      enabled: true,
      url: "http://plex:32400",
      token: "sensitive-test-token",
      userName: "alice",
      libraryIds: ["1"],
      cron: "*/15 * * * *",
    };

    let response = await app.handle(
      request("/settings", "PUT", config, cookie),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("sensitive-test-token");
    expect(
      JSON.stringify(database.sqlite.query("SELECT * FROM settings").all()),
    ).not.toContain("sensitive-test-token");
    config.plex.token = "";
    response = await app.handle(request("/settings", "PUT", config, cookie));
    expect(
      (
        (await response.json()) as {
          plex: {
            tokenConfigured: boolean;
          };
        }
      ).plex.tokenConfigured,
    ).toBe(true);
    config.plex.cron = "broken";
    expect(
      (await app.handle(request("/settings", "PUT", config, cookie))).status,
    ).toBe(400);
  });
});

test("Plex multipart webhook persists per-account tasks and validates the secret", async () => {
  const context = testContext();

  disposables.push(context.dispose);

  const { SettingsService } = await import("@server/modules/settings/service");
  const { AccountService } = await import("@server/modules/accounts/service");
  const { JobsService } = await import("@server/modules/jobs/service");
  const settings = {
    database: context.database,
    vault: context.vault,
  };
  const transport = async () =>
    Response.json({ id: 1, username: "bgm-user", nickname: "" });

  await AccountService.save(
    { ...context, transport },
    {
      token: "test-token",
      plexUsers: ["alice"],
      enabled: true,
      private: false,
    },
  );

  const app = createApp({ ...context, transport });
  const key = SettingsService.webhookKey(settings);

  const payload = {
    event: "media.scrobble",
    Server: { uuid: "server-1" },
    Account: { title: "alice" },
    Metadata: {
      ratingKey: "1",
      type: "episode",
      grandparentTitle: "番剧",
      parentIndex: 1,
      index: 1,
    },
  };

  const makeRequest = (secret: string, body: unknown) => {
    const data = new FormData();

    data.set("payload", JSON.stringify(body));
    data.set("thumb", new Blob(["image"], { type: "image/jpeg" }), "thumb.jpg");

    return new Request(`http://localhost/api/webhooks/plex/${secret}`, {
      method: "POST",
      body: data,
    });
  };

  expect((await app.handle(makeRequest("wrong", payload))).status).toBe(401);
  expect((await app.handle(makeRequest(key, payload))).status).toBe(202);
  expect((await app.handle(makeRequest(key, payload))).status).toBe(202);

  const queue = {
    database: context.database,
  };

  expect(JobsService.list(queue)).toHaveLength(1);
  expect(JSON.stringify(JobsService.list(queue))).not.toContain("test-token");
  expect(
    (
      await app.handle(
        makeRequest(key, { ...payload, Account: { title: "stranger" } }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await app.handle(makeRequest(key, { ...payload, event: "media.pause" })))
      .status,
  ).toBe(202);
  expect(JobsService.list(queue)).toHaveLength(1);
});

test("core management writes require a session and reject cross-origin requests", async () => {
  const { app } = fixture();
  const cookie = await login(app);

  const account = {
    token: "test-token",
    plexUsers: ["alice"],
    enabled: true,
    private: false,
  };

  const mapping = { title: "番剧", season: 1, subjectId: 10, episodeOffset: 0 };

  const mutations: [string, string, unknown][] = [
    ["/catalog/update", "POST", undefined],
    ["/plex/scan", "POST", { full: false }],
    ["/jobs/id/retry", "POST", undefined],
    ["/records/id/retry", "POST", undefined],
    ["/accounts", "POST", account],
    ["/accounts/id", "PUT", account],
    ["/accounts/id", "DELETE", undefined],
    ["/mappings", "POST", mapping],
    ["/mappings/id", "DELETE", undefined],
  ];

  for (const [path, method, body] of mutations) {
    expect((await app.handle(request(path, method, body))).status).toBe(401);
    expect(
      (
        await app.handle(
          request(path, method, body, cookie, "https://untrusted.test"),
        )
      ).status,
    ).toBe(403);
  }
});

test("removed feature endpoints are unavailable even to the administrator", async () => {
  const { app } = fixture();
  const cookie = await login(app);

  for (const path of [
    "/catalog/uploads",
    "/calendar",
    "/summary/jobs",
    "/notifications",
    "/events/stream",
    "/oauth/bangumi/callback",
    "/overview",
  ])
    expect(
      (await app.handle(request(path, "GET", undefined, cookie))).status,
    ).toBe(404);
});
