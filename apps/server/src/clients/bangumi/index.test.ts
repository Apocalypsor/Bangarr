import { expect, test } from "bun:test";
import { BangumiClient } from "@server/clients/bangumi";
import type { HttpTransport } from "@server/utils/http";

test("anime completion requires a known positive total and enough watched episodes", async () => {
  for (const [total, watched, completed] of [
    [12, 11, false],
    [12, 12, true],
    [12, 13, true],
    [0, 100, false],
    [-1, 100, false],
  ] as const) {
    const writes: unknown[] = [];

    const transport: HttpTransport = async (request) => {
      const path = new URL(request.url).pathname;

      if (request.method === "POST") {
        writes.push(await request.json());

        return new Response(null, { status: 204 });
      }

      if (path.endsWith("/collections/10"))
        return Response.json({ type: 3, ep_status: watched });

      if (path.endsWith("/subjects/10"))
        return Response.json({ id: 10, type: 2, eps: total });

      throw new Error(`Unexpected request ${path}`);
    };

    const api = new BangumiClient("https://bangumi.test", "test", transport);

    expect(await api.completeIfWatched(10, true)).toEqual({
      changed: completed,
    });
    expect(writes).toEqual(completed ? [{ type: 2, private: true }] : []);
  }
});

test("already completed subjects are not written again and movies do not require episode counts", async () => {
  let complete = false;
  const calls: string[] = [];

  const api = new BangumiClient(
    "https://bangumi.test",
    "test",
    async (request) => {
      calls.push(request.method);
      expect(new URL(request.url).pathname).toBe("/v0/users/-/collections/10");

      if (request.method === "GET")
        return Response.json({ type: complete ? 2 : 3 });

      complete = true;

      return new Response(null, { status: 204 });
    },
  );

  expect(await api.completeIfWatched(10, false, true)).toEqual({
    changed: true,
  });
  expect(await api.completeIfWatched(10, false, true)).toEqual({
    changed: false,
  });
  expect(await api.completeIfWatched(10, false)).toEqual({ changed: false });
  expect(calls).toEqual(["GET", "POST", "GET", "GET"]);
});
