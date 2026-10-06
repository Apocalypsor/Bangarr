import { expect, test } from "bun:test";
import { PlexClient, parsePlexItem } from "@server/clients/plex";
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

  const items = await Array.fromAsync(client.watched([]));

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

  const items = await Array.fromAsync(client.watched([]));

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

  await expect(Array.fromAsync(client.watched(["2"]))).rejects.toThrow(
    "不可访问",
  );
  await expect(Array.fromAsync(client.watched(["1"]))).rejects.toThrow(
    "重复分页",
  );
});

test("credentials in URLs are rejected, incomplete episode metadata fails safely", () => {
  expect(() => new PlexClient("http://user:secret@plex", "token")).toThrow(
    "凭据",
  );
  expect(() =>
    parsePlexItem({ ...episode("1"), parentIndex: undefined }),
  ).toThrow("季度");
  expect(
    parsePlexItem({ ...episode("1"), originalTitle: "a single episode" })
      .originalTitle,
  ).toBe("");
});
