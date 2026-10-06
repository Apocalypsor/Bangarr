import { resolve } from "node:path";
import { createApp } from "@server/app";
import { openDatabase } from "@server/db/client";
import { startTasks } from "@server/tasks";
import { loadVault } from "@server/utils/secrets";
import { Elysia } from "elysia";

const dataDirectory = resolve(process.env.DATA_DIR ?? "data");

const database = openDatabase(resolve(dataDirectory, "bangumi.sqlite"));

const vault = loadVault(dataDirectory);

const shutdownController = new AbortController();

const api = createApp({
  database,
  vault,
  shutdownSignal: shutdownController.signal,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  secureCookies: process.env.COOKIE_SECURE === "true",
  clientAddress: (request) => {
    const address = server.server?.requestIP(request)?.address ?? "unknown";

    if (
      process.env.TRUST_PROXY === "true" &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
    )
      return request.headers.get("X-Real-IP") || address;

    return address;
  },
});

let stopTasks: () => Promise<void> = async () => {};

const server = new Elysia({ serve: { maxRequestBodySize: 2 * 1024 * 1024 } })

  .use(api)
  .onStart(() => {
    stopTasks = startTasks(database, vault);
  })
  .listen({
    port: Number(process.env.PORT ?? 3000),
    hostname: process.env.HOST ?? "127.0.0.1",
  });

console.info(`Bangarr API listening on ${server.server?.url}`);

let stopping = false;

const shutdown = async () => {
  if (stopping) return;

  stopping = true;
  console.info("Stopping API and background tasks");
  shutdownController.abort();

  const listener = server.server;
  const deadline = setTimeout(() => void listener?.stop(true), 5000);

  try {
    await Promise.all([server.stop(), stopTasks()]);
  } finally {
    clearTimeout(deadline);
    database.close();
  }

  console.info("API and background tasks stopped");
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
