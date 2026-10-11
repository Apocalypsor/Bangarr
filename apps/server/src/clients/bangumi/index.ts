import type {
  BangumiCollection,
  BangumiEpisode,
  BangumiEpisodeCollection,
  BangumiPage,
  BangumiRelation,
  BangumiSearchOptions,
  BangumiSubject,
  BangumiUser,
} from "@server/clients/bangumi/types";
import { AppError, RemoteError } from "@server/utils/errors";
import type { HttpTransport } from "@server/utils/http";
import { HttpClient } from "@server/utils/http";

export class BangumiClient {
  private http: HttpClient;

  constructor(
    url: string,
    token = "",
    transport?: HttpTransport,
    private username?: string,
  ) {
    this.http = new HttpClient(
      `${url.replace(/\/$/, "")}/v0`,
      "Bangumi",
      token ? { Authorization: `Bearer ${token}` } : {},
      transport,
    );
  }

  me() {
    return this.http.json<BangumiUser>("me");
  }

  subject(id: number) {
    return this.http.json<BangumiSubject>(`subjects/${id}`);
  }

  relations(id: number) {
    return this.http.json<BangumiRelation[]>(`subjects/${id}/subjects`);
  }

  async search(
    keyword: string,
    realAction = false,
    options: BangumiSearchOptions = {},
  ) {
    const airDate = [
      options.startDate && `>=${options.startDate}`,
      options.endDate && `<${options.endDate}`,
    ].filter(Boolean);
    const page = await this.http.json<BangumiPage<BangumiSubject>>(
      "search/subjects",
      {
        method: "POST",
        params: { limit: options.limit ?? 20 },
        body: {
          keyword,
          sort: "match",
          filter: {
            type: options.types ?? (realAction ? [2, 6] : [2]),
            nsfw: true,
            ...(airDate.length ? { air_date: airDate } : {}),
          },
        },
      },
    );

    return page.data;
  }

  async episodes(subjectId: number, type = 0) {
    const all: BangumiEpisode[] = [];
    const seen = new Set<number>();

    for (let offset = 0; ; ) {
      const page = await this.http.json<BangumiPage<BangumiEpisode>>(
        "episodes",
        {
          params: { subject_id: subjectId, type, limit: 100, offset },
        },
      );

      if (!Array.isArray(page.data)) throw new Error("Bangumi 剧集列表无效");

      if (!page.data.length) {
        if (offset < page.total) throw new Error("Bangumi 剧集分页不完整");

        break;
      }

      if (page.data.every((ep) => seen.has(ep.id)))
        throw new Error("Bangumi 剧集分页重复");

      for (const ep of page.data)
        if (!seen.has(ep.id)) {
          seen.add(ep.id);
          all.push(ep);
        }

      offset += page.data.length;

      if (offset >= page.total) break;
    }

    return all;
  }

  async collection(subjectId: number) {
    // Subject collection GET requires a username; '-' is only supported by
    // the authenticated write endpoints and episode collection endpoints.
    const username = this.username ?? (await this.me()).username;
    if (!username?.trim() || username === "-")
      throw new AppError(502, "INVALID_ACCOUNT", "Bangumi 返回了无效账号");
    this.username = username;

    try {
      return await this.http.json<BangumiCollection>(
        `users/${encodeURIComponent(username)}/collections/${subjectId}`,
      );
    } catch (error) {
      if (error instanceof RemoteError && error.remoteStatus === 404)
        return null;

      throw error;
    }
  }

  async episodeCollection(episodeId: number) {
    try {
      return await this.http.json<BangumiEpisodeCollection>(
        `users/-/collections/-/episodes/${episodeId}`,
      );
    } catch (error) {
      if (error instanceof RemoteError && error.remoteStatus === 404)
        return null;

      throw error;
    }
  }

  async setCollection(subjectId: number, type: 2 | 3, isPrivate: boolean) {
    await this.http.request(`users/-/collections/${subjectId}`, {
      method: "POST",
      body: { type, private: isPrivate },
    });
  }

  async markWatched(subjectId: number, episodeId: number, isPrivate: boolean) {
    const collection = await this.collection(subjectId);

    if (collection?.type === 2) return { changed: false };

    const changesSubject = !collection || [1, 4].includes(collection.type);
    if (changesSubject) await this.setCollection(subjectId, 3, isPrivate);

    if ((await this.episodeCollection(episodeId))?.type === 2)
      return { changed: changesSubject };

    await this.http.request(`users/-/collections/-/episodes/${episodeId}`, {
      method: "PUT",
      body: { type: 2 },
    });

    return { changed: true };
  }

  async markWatching(subjectId: number, isPrivate: boolean) {
    const current = await this.collection(subjectId);

    if (current && ![1, 4].includes(current.type)) return { changed: false };

    await this.setCollection(subjectId, 3, isPrivate);

    return { changed: true };
  }

  async completeIfWatched(
    subjectId: number,
    isPrivate: boolean,
    movie = false,
  ) {
    const collection = await this.collection(subjectId);

    if (collection?.type === 2) return { changed: false };

    if (!movie) {
      // 整部完成必须核对当前总集数，避免提前完成连载作品。
      const subject = await this.subject(subjectId);
      const total = subject.eps ?? 0;

      if (
        !Number.isInteger(total) ||
        total <= 0 ||
        (collection?.ep_status ?? 0) < total
      )
        return { changed: false };
    }

    await this.setCollection(subjectId, 2, isPrivate);

    return { changed: true };
  }
}
