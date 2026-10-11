import { expect, test } from "bun:test";
import { BangumiClient } from "@server/clients/bangumi";
import type { HttpTransport } from "@server/utils/http";

test.each([2, 3])(
  "rechecking completed episode progress preserves or completes subject state %s",
  async (initialType) => {
    let state: number = initialType;
    const writes: { path: string; type: number }[] = [];
    const api = new BangumiClient(
      "https://bangumi.test",
      "test",
      async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/v0/me")
          return Response.json({ id: 1, username: "alice", nickname: "" });
        if (request.method === "GET") {
          // Only writes accept '-' for subject collections. Reads require a username.
          if (path === "/v0/users/-/collections/10")
            return new Response(null, { status: 404 });
          if (path === "/v0/users/alice/collections/10")
            return Response.json({ type: state, ep_status: 12 });
          if (path === "/v0/subjects/10")
            return Response.json({ id: 10, type: 2, eps: 12 });
          if (path === "/v0/users/-/collections/-/episodes/101")
            return Response.json({ type: initialType === 2 ? 0 : 2 });
        }
        if (
          request.method === "POST" &&
          path === "/v0/users/-/collections/10"
        ) {
          const body = (await request.json()) as { type: number };
          writes.push({ path, type: body.type });
          state = body.type;
          return new Response(null, { status: 204 });
        }
        if (request.method === "PUT") {
          const body = (await request.json()) as { type: number };
          writes.push({ path, type: body.type });
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request ${request.method} ${path}`);
      },
    );

    await api.markWatched(10, 101, false);
    await api.completeIfWatched(10, false);
    expect(state).toBe(2);
    expect(writes).toEqual(
      initialType === 2
        ? []
        : [{ path: "/v0/users/-/collections/10", type: 2 }],
    );
  },
);

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
        expect(path).toBe("/v0/users/-/collections/10");
        writes.push(await request.json());

        return new Response(null, { status: 204 });
      }

      if (path === "/v0/users/alice/collections/10")
        return Response.json({ type: 3, ep_status: watched });

      if (path.endsWith("/subjects/10"))
        return Response.json({ id: 10, type: 2, eps: total });

      throw new Error(`Unexpected request ${path}`);
    };

    const api = new BangumiClient(
      "https://bangumi.test",
      "test",
      transport,
      "alice",
    );

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
      expect(new URL(request.url).pathname).toBe(
        request.method === "GET"
          ? "/v0/users/alice/collections/10"
          : "/v0/users/-/collections/10",
      );

      if (request.method === "GET")
        return Response.json({ type: complete ? 2 : 3 });

      complete = true;

      return new Response(null, { status: 204 });
    },
    "alice",
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

test.each([401, 403, 429, 500])(
  "collection read failure %s never becomes an uncollected subject",
  async (status) => {
    const calls: string[] = [];
    const api = new BangumiClient(
      "https://bangumi.test",
      "test",
      async (request) => {
        calls.push(request.method);
        expect(new URL(request.url).pathname).toBe(
          "/v0/users/alice/collections/10",
        );
        return new Response(null, { status });
      },
      "alice",
    );
    await expect(api.markWatched(10, 101, false)).rejects.toMatchObject({
      remoteStatus: status,
    });
    await expect(api.markWatching(10, false)).rejects.toMatchObject({
      remoteStatus: status,
    });
    expect(calls).toEqual(["GET", "GET"]);
  },
);

test("identity lookup failures do not trigger collection creation", async () => {
  const calls: string[] = [];
  const api = new BangumiClient(
    "https://bangumi.test",
    "test",
    async (request) => {
      calls.push(request.method);
      expect(new URL(request.url).pathname).toBe("/v0/me");
      return new Response(null, { status: 404 });
    },
  );
  await expect(api.markWatched(10, 101, false)).rejects.toMatchObject({
    remoteStatus: 404,
  });
  expect(calls).toEqual(["GET"]);
});

test("playback start leaves a completed subject untouched", async () => {
  const api = new BangumiClient(
    "https://bangumi.test",
    "test",
    async (request) => {
      expect(request.method).toBe("GET");
      expect(new URL(request.url).pathname).toBe(
        "/v0/users/alice/collections/10",
      );
      return Response.json({ type: 2 });
    },
    "alice",
  );
  expect(await api.markWatching(10, false)).toEqual({ changed: false });
});

test.each([null, 1, 2, 3, 4, 5])(
  "watched and playback-start transitions follow the reference for collection state %s",
  async (state) => {
    for (const action of ["watched", "watching"] as const) {
      for (const episodeType of [0, 2]) {
        const writes: { method: string; path: string; body: unknown }[] = [];
        const api = new BangumiClient(
          "https://bangumi.test",
          "test",
          async (request) => {
            const path = new URL(request.url).pathname;
            if (request.method === "GET") {
              if (path === "/v0/users/alice/collections/10")
                return state === null
                  ? new Response(null, { status: 404 })
                  : Response.json({ type: state });
              if (path === "/v0/users/-/collections/-/episodes/101")
                return Response.json({ type: episodeType });
              throw new Error(`Unexpected read ${path}`);
            }
            writes.push({
              method: request.method,
              path,
              body: await request.json(),
            });
            return new Response(null, { status: 204 });
          },
          "alice",
        );
        const result =
          action === "watched"
            ? await api.markWatched(10, 101, true)
            : await api.markWatching(10, true);
        const changesSubject = state === null || state === 1 || state === 4;
        const changesEpisode =
          action === "watched" && state !== 2 && episodeType !== 2;
        expect(writes).toEqual([
          ...(changesSubject
            ? [
                {
                  method: "POST",
                  path: "/v0/users/-/collections/10",
                  body: { type: 3, private: true },
                },
              ]
            : []),
          ...(changesEpisode
            ? [
                {
                  method: "PUT",
                  path: "/v0/users/-/collections/-/episodes/101",
                  body: { type: 2 },
                },
              ]
            : []),
        ]);
        expect(result.changed).toBe(changesSubject || changesEpisode);
      }
    }
  },
);
