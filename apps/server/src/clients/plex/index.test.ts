import { expect, test } from "bun:test";
import { PlexClient } from "@server/clients/plex";
import type { HttpTransport } from "@server/utils/http";

const episode = (key: string, viewCount = 1) => ({
  ratingKey: key,
  type: "episode",
  grandparentTitle: "测试番剧",
  parentIndex: 1,
  index: Number(key),
  viewCount,
});

const response = (container: unknown) =>
  Response.json({ MediaContainer: container });

test("short pages, manual watched without timestamp, no token in URL and movie filtering", async () => {
  const requests: Request[] = [];

  const transport: HttpTransport = async (request) => {
    requests.push(request);

    const url = new URL(request.url);

    if (url.pathname === "/identity")
      return response({ machineIdentifier: "one" });

    if (url.pathname === "/library/sections")
      return response({
        Directory: [
          { key: "1", type: "show", title: "动画" },
          { key: "2", type: "movie", title: "电影" },
        ],
      });

    if (url.pathname.endsWith("/1/all")) {
      expect(url.searchParams.get("episode.viewCount>>")).toBe("0");

      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));

      return response({
        totalSize: 3,
        offset,
        Metadata:
          offset === 0 ? [episode("1"), episode("2", 0)] : [episode("3")],
      });
    }

    expect(url.searchParams.get("unwatched")).toBe("0");

    return response({
      totalSize: 1,
      Metadata: [
        { ratingKey: "4", type: "movie", title: "电影", viewCount: 2 },
      ],
    });
  };

  const client = new PlexClient("http://plex:32400", "secret", transport);

  expect((await client.identity()).id).toBe("one");

  const events = await Array.fromAsync(client.watched([]));
  const items = events.flatMap((event) =>
    event.type === "item" ? [event.item] : [],
  );

  expect(items.map((item) => item.ratingKey)).toEqual(["1", "3", "4"]);
  expect(items[0]?.lastViewedAt).toBeNull();
  expect(
    requests.every(
      (r) =>
        r.headers.get("X-Plex-Token") === "secret" && !r.url.includes("secret"),
    ),
  ).toBe(true);
});

test("XML identity and sections work, unsupported filter falls back only once", async () => {
  let scans = 0;

  const client = new PlexClient("http://plex", "token", async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/identity")
      return new Response('<MediaContainer machineIdentifier="xml-server"/>');

    if (url.pathname === "/library/sections")
      return new Response(
        '<MediaContainer size="1"><Directory key="1" type="show" title="动画"/></MediaContainer>',
      );

    scans++;

    if (url.searchParams.has("episode.viewCount>>"))
      return new Response("bad filter", { status: 400 });

    return new Response(
      '<MediaContainer totalSize="2" offset="0"><Video ratingKey="1" type="episode" grandparentTitle="番剧" parentIndex="0" index="1" viewCount="1"/><Video ratingKey="2" type="episode" viewCount="0"/></MediaContainer>',
    );
  });

  expect((await client.identity()).id).toBe("xml-server");

  const events = await Array.fromAsync(client.watched([]));
  const items = events.flatMap((event) =>
    event.type === "item" ? [event.item] : [],
  );

  expect(scans).toBe(2);
  expect(items).toHaveLength(1);
  expect(items[0]?.season).toBe(0);
});

test("repeated pages and inaccessible libraries fail explicitly", async () => {
  const client = new PlexClient("http://plex", "token", async (request) =>
    new URL(request.url).pathname === "/library/sections"
      ? response({ Directory: [{ key: "1", type: "show" }] })
      : response({ totalSize: 4, Metadata: [episode("1")] }),
  );

  expect(await Array.fromAsync(client.watched(["2"]))).toMatchObject([
    {
      type: "issue",
      issue: {
        scope: "library",
        message: "所选媒体库不可访问，请重新选择媒体库",
      },
    },
  ]);
  const events = await Array.fromAsync(client.watched(["1"]));
  expect(events.at(-1)).toMatchObject({
    type: "issue",
    issue: { scope: "library", message: "Plex 返回了重复分页" },
  });
});

test("credentials in URLs are rejected", () => {
  expect(() => new PlexClient("http://user:secret@plex", "token")).toThrow(
    "凭据",
  );
});

test("scanning continues past S02E00 across pages", async () => {
  const client = new PlexClient("http://plex", "token", async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/library/sections")
      return response({ Directory: [{ key: "1", type: "show" }] });

    const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
    return response({
      totalSize: 3,
      offset,
      Metadata:
        offset === 0
          ? [episode("1"), { ...episode("2"), parentIndex: 2, index: 0 }]
          : [episode("3")],
    });
  });

  const events = await Array.fromAsync(client.watched(["1"]));
  const items = events.flatMap((event) =>
    event.type === "item" ? [event.item] : [],
  );
  expect(items.map(({ ratingKey }) => ratingKey)).toEqual(["1", "2", "3"]);
  expect(items[1]).toMatchObject({ season: 2, episode: 0 });
});

test("malformed scalar fields are isolated without coercing objects or dropping later items", async () => {
  const invalid = { toString: null };
  const client = new PlexClient("http://plex", "token", async (request) =>
    new URL(request.url).pathname === "/library/sections"
      ? response({ Directory: [{ key: "1", type: "show" }] })
      : response({
          totalSize: 4,
          Metadata: [
            { ...episode("1"), grandparentTitle: invalid },
            { ...episode("2"), ratingKey: invalid },
            { ...episode("3"), viewCount: invalid },
            episode("4"),
          ],
        }),
  );
  const events = await Array.fromAsync(client.watched(["1"]));
  expect(events).toMatchObject([
    { type: "issue", issue: { scope: "item" } },
    { type: "issue", issue: { scope: "item" } },
    { type: "issue", issue: { scope: "item" } },
    { type: "item", item: { ratingKey: "4" } },
  ]);
});

test("repeated malformed pages terminate only the affected library", async () => {
  let pages = 0;
  const client = new PlexClient("http://plex", "secret", async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/library/sections")
      return response({
        Directory: [
          { key: "1", type: "show" },
          { key: "2", type: "show" },
        ],
      });
    if (url.pathname.endsWith("/2/all"))
      return response({ totalSize: 1, Metadata: [episode("2")] });
    pages++;
    if (pages > 2) throw new Error("Unbounded pagination");
    return response({ Metadata: [null] });
  });
  const events = await Array.fromAsync(client.watched([]));
  expect(pages).toBe(2);
  expect(events).toMatchObject([
    { type: "issue", issue: { scope: "item" } },
    {
      type: "issue",
      issue: { scope: "library", message: "Plex 返回了重复分页" },
    },
    { type: "item", item: { ratingKey: "2" } },
  ]);
});

test.each([403, 404, "invalid-response", "invalid-list"])(
  "library failure remains local (%s)",
  async (failure) => {
    const client = new PlexClient("http://plex", "secret", async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/library/sections")
        return response({
          Directory: [
            { key: "1", type: "show" },
            { key: "2", type: "show" },
          ],
        });
      if (url.pathname.endsWith("/2/all"))
        return response({ totalSize: 1, Metadata: [episode("2")] });
      if (failure === "invalid-response")
        return new Response("not-json-with-secret");
      if (failure === "invalid-list")
        return response({ Metadata: "not-a-list-with-secret" });
      return new Response(null, { status: Number(failure) });
    });
    const events = await Array.fromAsync(client.watched([]));
    expect(events).toMatchObject([
      { type: "issue", issue: { scope: "library", retryable: false } },
      { type: "item", item: { ratingKey: "2" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("with-secret");
  },
);
