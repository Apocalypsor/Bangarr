import { createHash } from "node:crypto";
import type {
  PlexContainer,
  PlexItem,
  PlexLibrary,
  PlexScanEvent,
  PlexScanIssue,
} from "@server/clients/plex/types";
import {
  containerRows,
  isObject,
  parsePlexContainer,
  parsePlexItem,
  plexNumber,
  plexText,
} from "@server/clients/plex/utils";
import { AppError, RemoteError } from "@server/utils/errors";
import type { HttpTransport } from "@server/utils/http";
import { HttpClient } from "@server/utils/http";
import { validateHttpUrl } from "@server/utils/url";

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

    return containerRows(body, "Directory")
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
  ): AsyncGenerator<PlexScanEvent> {
    const libraries = await this.libraries();

    for (const id of new Set(libraryIds))
      if (!libraries.some((library) => library.id === id))
        yield scanIssue(
          { id, title: id, type: "show" },
          "library",
          "所选媒体库不可访问，请重新选择媒体库",
        );

    for (const library of libraries) {
      if (libraryIds.length && !libraryIds.includes(library.id)) continue;

      try {
        let found = false;
        try {
          for await (const event of this.scan(library, true, signal)) {
            found = true;
            yield event;
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
      } catch (error) {
        if (!isLibraryError(error)) throw error;

        yield scanIssue(library, "library", error.message, undefined, error);
      }
    }
  }

  private async *scan(
    library: PlexLibrary,
    filtered: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<PlexScanEvent> {
    const seen = new Set<string>();
    const pages = new Set<string>();
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

      const entries: unknown =
        body.Metadata ??
        (Number(body.size ?? body.totalSize) === 0 ? [] : undefined);

      if (!Array.isArray(entries))
        throw new AppError(502, "PLEX_INVALID_LIST", "Plex 返回了无效列表");

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

      const fingerprint = createHash("sha256")
        .update(JSON.stringify(entries))
        .digest("hex");
      if (
        pages.has(fingerprint) ||
        entries.every(
          (row) => isObject(row) && seen.has(plexText(row.ratingKey)),
        )
      )
        throw new AppError(502, "PLEX_REPEATED_PAGE", "Plex 返回了重复分页");
      pages.add(fingerprint);

      for (const row of entries) {
        if (!isObject(row)) {
          yield scanIssue(library, "item", "Plex 项目格式无效");
          continue;
        }

        const key = plexText(row.ratingKey);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);

        if (row.type !== "movie" && row.type !== "episode") continue;

        const viewCount = plexNumber(row.viewCount ?? 0);
        if (!Number.isInteger(viewCount) || viewCount < 0) {
          yield scanIssue(library, "item", "Plex 项目观看次数无效", row);
          continue;
        }
        if (viewCount === 0) continue;

        if (!key) {
          yield scanIssue(library, "item", "Plex 项目缺少标识", row);
          continue;
        }

        let item: PlexItem;
        try {
          item = parsePlexItem(row);
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            error.code !== "PLEX_INVALID_ITEM"
          )
            throw error;
          yield scanIssue(library, "item", error.message, row);
          continue;
        }

        yield { type: "item", item };
      }

      offset += entries.length;

      if (total !== null && offset >= total) break;
    }
  }

  private async container(
    path: string,
    params?: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<PlexContainer> {
    const response = await this.http.request(path, { params, signal });
    const text = await response.text();

    return parsePlexContainer(text);
  }
}

const isLibraryError = (error: unknown): error is AppError =>
  error instanceof RemoteError
    ? ![401, 429].includes(error.remoteStatus)
    : error instanceof AppError &&
      [
        "PLEX_INVALID_PAGE",
        "PLEX_INCOMPLETE_PAGE",
        "PLEX_REPEATED_PAGE",
        "PLEX_INVALID_LIST",
        "PLEX_INVALID_RESPONSE",
      ].includes(error.code);

const scanIssue = (
  library: PlexLibrary,
  scope: PlexScanIssue["scope"],
  message: string,
  row?: Record<string, unknown>,
  error?: AppError,
): PlexScanEvent => ({
  type: "issue",
  issue: {
    id: crypto.randomUUID(),
    scope,
    libraryId: library.id,
    libraryTitle: library.title.slice(0, 200),
    ratingKey:
      typeof row?.ratingKey === "string" || typeof row?.ratingKey === "number"
        ? String(row.ratingKey).slice(0, 200)
        : null,
    title:
      typeof (row?.grandparentTitle ?? row?.title) === "string"
        ? String(row?.grandparentTitle ?? row?.title).slice(0, 500)
        : null,
    message,
    retryable: error instanceof RemoteError && error.remoteStatus >= 500,
    retryAfter: error instanceof RemoteError ? error.retryAfter : 0,
  },
});
