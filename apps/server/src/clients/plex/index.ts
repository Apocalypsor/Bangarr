import { AppError, RemoteError } from "@server/utils/errors";
import type { HttpTransport } from "@server/utils/http";
import { HttpClient } from "@server/utils/http";
import { validateHttpUrl } from "@server/utils/url";
import { XMLParser } from "fast-xml-parser";

export interface PlexLibrary {
  id: string;
  title: string;
  type: "show" | "movie";
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  originalTitle: string;
  season: number;
  episode: number;
  mediaType: "episode" | "movie";
  releaseDate: string;
  viewCount: number;
  lastViewedAt: number | null;
}

interface Container {
  [key: string]: unknown;
}

export class PlexClient {
  private http: HttpClient;

  constructor(url: string, token: string, transport?: HttpTransport) {
    validateHttpUrl(url);
    this.http = new HttpClient(
      url,
      "Plex",
      { "X-Plex-Token": token },
      transport,
    );
  }

  async identity() {
    const body = await this.container("identity");

    if (typeof body.machineIdentifier !== "string" || !body.machineIdentifier)
      throw new AppError(502, "PLEX_INVALID_IDENTITY", "Plex 未返回服务器标识");

    return { id: body.machineIdentifier, version: String(body.version ?? "") };
  }

  async libraries(): Promise<PlexLibrary[]> {
    const body = await this.container("library/sections");

    return rows(body, "Directory")
      .filter((row) => row.type === "show" || row.type === "movie")
      .map((row) => ({
        id: String(row.key),
        title: String(row.title ?? ""),
        type: row.type as "show" | "movie",
      }));
  }

  async *watched(
    libraryIds: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<PlexItem> {
    const libraries = await this.libraries();

    if (
      libraryIds.some((id) => !libraries.some((library) => library.id === id))
    )
      throw new AppError(
        400,
        "PLEX_LIBRARY_MISSING",
        "所选媒体库不可访问，请重新选择媒体库",
      );

    for (const library of libraries) {
      if (libraryIds.length && !libraryIds.includes(library.id)) continue;

      let found = false;

      try {
        for await (const item of this.scan(library, true, signal)) {
          found = true;
          yield item;
        }
      } catch (error) {
        if (
          !(
            library.type === "show" &&
            !found &&
            error instanceof RemoteError &&
            [400, 422].includes(error.remoteStatus)
          )
        )
          throw error;
      }

      if (!found && library.type === "show")
        yield* this.scan(library, false, signal);
    }
  }

  private async *scan(
    library: PlexLibrary,
    filtered: boolean,
    signal?: AbortSignal,
  ) {
    const seen = new Set<string>();
    let offset = 0;

    while (true) {
      const params: Record<string, string | number> = {
        type: library.type === "show" ? 4 : 1,
        "X-Plex-Container-Start": offset,
        "X-Plex-Container-Size": 200,
      };

      if (filtered)
        params[library.type === "show" ? "episode.viewCount>>" : "unwatched"] =
          0;

      const body = await this.container(
        `library/sections/${encodeURIComponent(library.id)}/all`,
        params,
        signal,
      );

      const entries = rows(body, "Metadata");
      const total =
        body.totalSize === undefined ? null : Number(body.totalSize);

      if (total !== null && (!Number.isInteger(total) || total < 0))
        throw new AppError(502, "PLEX_INVALID_PAGE", "Plex 分页总数无效");

      if (!entries.length) {
        if (total !== null && offset < total)
          throw new AppError(502, "PLEX_INCOMPLETE_PAGE", "Plex 分页提前结束");

        break;
      }

      if (body.offset !== undefined && Number(body.offset) !== offset)
        throw new AppError(502, "PLEX_INVALID_PAGE", "Plex 分页位置不正确");

      if (entries.every((row) => seen.has(String(row.ratingKey))))
        throw new AppError(502, "PLEX_REPEATED_PAGE", "Plex 返回了重复分页");

      for (const row of entries) {
        const key = String(row.ratingKey ?? "");

        if (!key)
          throw new AppError(502, "PLEX_INVALID_ITEM", "Plex 项目缺少标识");

        if (seen.has(key)) continue;

        seen.add(key);

        if (
          Number(row.viewCount ?? 0) <= 0 ||
          !["movie", "episode"].includes(String(row.type))
        )
          continue;

        yield parsePlexItem(row);
      }

      offset += entries.length;

      if (total !== null && offset >= total) break;
    }
  }

  private async container(
    path: string,
    params?: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<Container> {
    const response = await this.http.request(path, { params, signal });
    const text = await response.text();

    try {
      let parsed: unknown;

      if (text.trimStart().startsWith("<")) {
        // 不解析外部实体/DTD，固定集合为数组，包括只有一个元素时。
        if (/<!DOCTYPE|<!ENTITY/i.test(text))
          throw new Error("DTD is unsupported");

        parsed = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "",
          parseAttributeValue: false,
          processEntities: false,
          isArray: (name) => ["Directory", "Video"].includes(name),
        }).parse(text);
      } else parsed = JSON.parse(text);

      if (!isObject(parsed) || !isObject(parsed.MediaContainer))
        throw new Error("Invalid container");

      const container = parsed.MediaContainer;

      if (container.Video !== undefined) container.Metadata = container.Video;

      return container;
    } catch {
      throw new AppError(
        502,
        "PLEX_INVALID_RESPONSE",
        "Plex 返回了无法识别的数据",
      );
    }
  }
}

export const parsePlexItem = (row: Record<string, unknown>): PlexItem => {
  const movie = row.type === "movie";

  if (!movie && row.type !== "episode")
    throw new AppError(400, "PLEX_UNSUPPORTED_TYPE", "只支持 Plex 剧集和电影");

  const title = String((movie ? row.title : row.grandparentTitle) ?? "").trim();
  const season = movie ? 1 : Number(row.parentIndex);
  const episode = movie ? 1 : Number(row.index);

  if (
    !title ||
    !Number.isInteger(season) ||
    season < 0 ||
    !Number.isInteger(episode) ||
    episode < 1
  )
    throw new AppError(
      400,
      "PLEX_INVALID_ITEM",
      "Plex 项目缺少标题、季度或集数",
    );

  return {
    ratingKey: String(row.ratingKey ?? ""),
    title,
    originalTitle: movie ? String(row.originalTitle ?? "").trim() : "",
    season,
    episode,
    mediaType: movie ? "movie" : "episode",
    releaseDate: String(row.originallyAvailableAt ?? ""),
    viewCount: Number(row.viewCount ?? 0),
    lastViewedAt: row.lastViewedAt ? Number(row.lastViewedAt) : null,
  };
};

const rows = (container: Container, key: string): Record<string, unknown>[] => {
  const value = container[key];

  if (
    value === undefined &&
    (Number(container.size) === 0 || Number(container.totalSize) === 0)
  )
    return [];

  if (!Array.isArray(value) || !value.every(isObject))
    throw new AppError(502, "PLEX_INVALID_LIST", "Plex 返回了无效列表");

  return value;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
