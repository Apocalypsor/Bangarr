import { afterEach, expect, test } from "bun:test";
import { createApp } from "@server/app";
import { readPlexAccounts } from "@server/db/plex";
import { accounts } from "@server/db/schema";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import { PlexService } from "@server/modules/plex/service";
import { SettingsService } from "@server/modules/settings/service";
import { TaskService } from "@server/tasks/service";
import { testContext } from "@server/utils/testing";

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const fixture = () => {
  const context = testContext();
  disposables.push(context.dispose);
  const requests: { host: string; token: string | null }[] = [];
  const transport = async (request: Request) => {
    const url = new URL(request.url);
    requests.push({
      host: url.host,
      token: request.headers.get("X-Plex-Token"),
    });
    if (url.pathname === "/identity")
      return Response.json({
        MediaContainer: { machineIdentifier: url.hostname },
      });
    if (url.pathname === "/library/sections")
      return Response.json({
        MediaContainer: {
          Directory: [{ key: "1", title: "动画", type: "show" }],
        },
      });
    if (url.pathname.includes("/all"))
      return Response.json({
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "1",
              type: "episode",
              grandparentTitle: "番剧",
              parentIndex: 1,
              index: 1,
              viewCount: 1,
            },
          ],
        },
      });
    if (url.pathname === "/v0/me")
      return Response.json({ id: 1, username: "bgm", nickname: "" });
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  return { ...context, transport, requests };
};

const source = (host: string, userName = "alice") => ({
  name: host,
  url: `http://${host}`,
  userName,
  token: `token-${host}`,
  enabled: true,
  libraryIds: ["1"],
  cron: "*/15 * * * *",
});

test("Plex accounts isolate tokens, scans and webhook bindings across servers", async () => {
  const context = fixture();
  const first = await PlexService.save(context, source("first.test"));
  const second = await PlexService.save(context, source("second.test"));
  if (!first || !second) throw new Error("Missing account");
  const bgm = await AccountService.save(context, {
    token: "bgm-token",
    plexUsers: [first.id, second.id],
    enabled: true,
    private: false,
  });
  expect(bgm?.plexUsers).toEqual([first.id, second.id]);
  expect(JSON.stringify(PlexService.list(context))).not.toContain(
    "token-first",
  );
  expect(JSON.stringify(readPlexAccounts(context.database))).not.toContain(
    "token-first",
  );

  const scanA = PlexService.scan(context, first.id);
  const scanB = PlexService.scan(context, second.id);
  expect(scanA.job.id).not.toBe(scanB.job.id);
  expect(PlexService.scan(context, first.id).created).toBe(false);
  await TaskService.runOne(context);
  await TaskService.runOne(context);
  const jobs = JobsService.list(context).filter((job) => job.kind === "sync");
  expect(jobs).toHaveLength(2);
  expect(new Set(jobs.map((job) => job.payload.scope)).size).toBe(2);
  expect(
    context.requests.some(
      (row) => row.host === "first.test" && row.token === "token-first.test",
    ),
  ).toBe(true);
  expect(
    context.requests.some(
      (row) => row.host === "second.test" && row.token === "token-second.test",
    ),
  ).toBe(true);

  const payload = {
    event: "media.scrobble",
    Server: { uuid: "first.test" },
    Account: { title: "alice" },
    Metadata: {
      ratingKey: "1",
      type: "episode",
      grandparentTitle: "番剧",
      parentIndex: 1,
      index: 1,
    },
  };
  const key = SettingsService.webhookKey(context);
  await PlexService.webhook(context, key, payload);
  expect(
    JobsService.list(context).filter((job) => job.kind === "sync"),
  ).toHaveLength(2);
  await expect(
    PlexService.webhook(context, key, {
      ...payload,
      Server: { uuid: "unknown.test" },
    }),
  ).rejects.toThrow("未配置");

  await AccountService.save(
    context,
    { token: "", plexUsers: [first.id], enabled: true, private: false },
    bgm?.id,
  );
  expect(AccountService.targets(context, second.id)).toHaveLength(0);
  await expect(
    PlexService.webhook(context, key, {
      ...payload,
      Server: { uuid: "second.test" },
    }),
  ).rejects.toThrow("未绑定");
});

test("existing single-Plex credentials and bindings survive edits and deleting all accounts", async () => {
  const context = fixture();
  const config = SettingsService.read(context);
  config.plex = source("legacy.test");
  SettingsService.save(context, config);
  context.database.orm
    .insert(accounts)
    .values({
      id: "old",
      username: "bgm",
      accessToken: context.vault.seal("bgm-token"),
      plexUsers: ["alice"],
      createdAt: 0,
    })
    .run();
  expect(PlexService.get(context, "default").token).toBe("token-legacy.test");
  expect(AccountService.list(context)[0]?.plexUsers).toEqual(["default"]);
  await PlexService.save(
    context,
    { ...source("legacy.test", "new-name"), token: "" },
    "default",
  );
  expect(AccountService.targets(context, "default")).toHaveLength(1);
  expect(PlexService.get(context, "default").token).toBe("token-legacy.test");
  PlexService.delete(context, "default");
  expect(PlexService.list(context)).toEqual([]);
  expect(PlexService.list(context)).toEqual([]);
});

test("new Plex management endpoints require authentication", async () => {
  const context = fixture();
  const app = createApp(context);
  for (const [path, method, body] of [
    ["/plex/accounts", "POST", source("test.local")],
    ["/plex/accounts/id", "PUT", source("test.local")],
    ["/plex/accounts/id", "DELETE", undefined],
    ["/plex/accounts/id/libraries", "GET", undefined],
    ["/plex/accounts/id/scan", "POST", { full: false }],
  ] as const) {
    const response = await app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    expect(response.status).toBe(401);
  }
});

test("bulk scans yield to API requests while durably batching thousands of jobs", async () => {
  const original = fixture();
  const total = 3000;
  const context = {
    ...original,
    transport: async (request: Request) => {
      const url = new URL(request.url);
      if (!url.pathname.endsWith("/all")) return original.transport(request);
      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
      return Response.json({
        MediaContainer: {
          totalSize: total,
          offset,
          Metadata: Array.from(
            { length: Math.min(200, total - offset) },
            (_, index) => ({
              ratingKey: String(offset + index + 1),
              type: "episode",
              grandparentTitle: "批量测试",
              parentIndex: 1,
              index: offset + index + 1,
              viewCount: 1,
            }),
          ),
        },
      });
    },
  };
  const plex = await PlexService.save(context, source("bulk.test"));
  if (!plex) throw new Error("Missing source");
  await AccountService.save(context, {
    token: "bgm-token",
    plexUsers: [plex.id],
    enabled: true,
    private: false,
  });
  const app = createApp(context);
  const login = await app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    }),
  );
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const scan = PlexService.scan(context, plex.id);
  let active = true;
  let responses = 0;
  let maxLatency = 0;
  const pending: Promise<void>[] = [];
  const timer = setInterval(() => {
    const started = performance.now();
    pending.push(
      app
        .handle(
          new Request("http://localhost/api/jobs?limit=30", {
            headers: { Cookie: cookie },
          }),
        )
        .then((response) => {
          expect(response.status).toBe(200);
          if (active) responses++;
          maxLatency = Math.max(maxLatency, performance.now() - started);
        }),
    );
  }, 5);
  try {
    await TaskService.runOne(context);
    active = false;
  } finally {
    clearInterval(timer);
    await Promise.all(pending);
  }
  expect(JobsService.get(context, scan.job.id)?.state).toBe("succeeded");
  expect(JobsService.page(context, { kind: "sync" }).total).toBe(total);
  expect(responses).toBeGreaterThan(1);
  console.info(
    `Bulk scan: ${total} tasks; ${responses} API responses during scan; max request ${Math.round(maxLatency)} ms`,
  );
});

test("connection testing uses unsaved credentials, requires auth and never saves an account", async () => {
  const context = fixture();
  const app = createApp(context);
  const input = { url: "http://draft.test", token: "draft-token" };
  const request = (cookie?: string, origin = "http://localhost") =>
    new Request("http://localhost/api/plex/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(input),
    });
  expect((await app.handle(request())).status).toBe(401);
  expect(context.requests).toHaveLength(0);
  const login = await app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    }),
  );
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  expect(
    (await app.handle(request(cookie, "https://untrusted.test"))).status,
  ).toBe(403);
  expect(context.requests).toHaveLength(0);

  const response = await app.handle(request(cookie));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    server: { id: "draft.test" },
    libraries: [{ id: "1" }],
  });
  expect(context.requests.every((row) => row.token === "draft-token")).toBe(
    true,
  );
  expect(PlexService.list(context)).toEqual([]);
  expect(
    context.database.sqlite
      .query("SELECT count(*) AS count FROM settings")
      .get(),
  ).toEqual({ count: 0 });

  const saved = await PlexService.save(context, source("saved.test"));
  if (!saved) throw new Error("Missing account");
  const result = await PlexService.testConnection(context, {
    url: "http://saved.test",
    token: "",
    accountId: saved.id,
  });
  expect(result.server.id).toBe("saved.test");
  await expect(
    PlexService.testConnection(context, {
      url: "http://different.test",
      token: "",
      accountId: saved.id,
    }),
  ).rejects.toThrow("Token");
  expect(PlexService.get(context, saved.id).url).toBe("http://saved.test");
});
