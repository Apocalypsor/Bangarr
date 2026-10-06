import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  CatalogStore,
  createCatalog,
  finalizeCatalog,
  insertSubject,
} from "@server/db/catalog";
import type { BangumiDataItem } from "@server/modules/catalog/types";
import { limitedText } from "@server/modules/catalog/utils";
import { JobsService } from "@server/modules/jobs/service";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError, RemoteError } from "@server/utils/errors";

export abstract class CatalogService {
  static async refreshData(context: AppContext) {
    const store = new CatalogStore(context.database.path);
    const config = SettingsService.read(context);

    const response = await CatalogService.downloadResponse(
      context,
      config.bangumi.dataUrl,
    );

    const buffer = await limitedText(response, 50 * 1024 * 1024);
    let document: {
      items: BangumiDataItem[];
    };

    try {
      document = JSON.parse(buffer);

      if (!Array.isArray(document.items)) throw new Error();
    } catch {
      throw new AppError(502, "CATALOG_INVALID", "bangumi-data 返回格式错误");
    }

    const temporary = join(store.directory, `${crypto.randomUUID()}.sqlite`);
    const db = createCatalog(temporary);
    let count = 0;

    try {
      db.transaction(() => {
        for (const item of document.items) {
          const id = Number(
            item.sites?.find((site) => site.site === "bangumi")?.id,
          );

          if (!Number.isInteger(id) || id <= 0 || !item.title) continue;

          const translations = Object.values(item.titleTranslate ?? {}).flat();

          insertSubject(db, {
            id,
            name: item.title,
            name_cn: item.titleTranslate?.["zh-Hans"]?.[0] ?? "",
            aliases: translations,
            type: 2,
            platform:
              (
                { tv: "TV", web: "WEB", ova: "OVA", movie: "剧场版" } as Record<
                  string,
                  string
                >
              )[item.type ?? ""] ?? "",
            date: item.begin?.slice(0, 10) ?? "",
            source: "data",
          });
          count++;
        }
      })();

      if (!count)
        throw new AppError(502, "CATALOG_EMPTY", "数据集为空，保留已有数据");

      finalizeCatalog(db);
      db.close();
      renameSync(temporary, store.path());

      return { subjects: count };
    } finally {
      try {
        db.close();
      } catch {}

      rmSync(temporary, { force: true });
    }
  }

  private static async downloadResponse(context: AppContext, input: string) {
    const url = new URL(input);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new AppError(400, "DATA_URL", "数据下载地址无效");

    try {
      // 公共数据下载不携带任何用户凭据，允许 GitHub/CDN 的下载重定向。
      const response = await (context.transport ?? fetch)(
        new Request(url.toString(), {
          redirect: "follow",
          signal: AbortSignal.timeout(60000),
          headers: { "User-Agent": "Bangarr/2.0" },
        }),
      );

      if (!response.ok)
        throw new RemoteError("Bangumi 数据源", response.status);

      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;

      throw new AppError(502, "REMOTE_UNREACHABLE", "数据源暂时无法连接");
    }
  }

  static maintain(context: AppContext) {
    const config = SettingsService.read(context).bangumi;

    if (!config.dataEnabled) return;

    const now = (context.now ?? Date.now)();
    const updated = new CatalogStore(context.database.path).updatedAt();

    if (updated && now - updated < config.dataRefreshDays * 86400000) return;

    const last = Number(SettingsService.get(context, "catalog-auto:data") ?? 0);

    if (last && now - last < 3600000) return;

    JobsService.enqueue(context, {
      kind: "catalog-data",
      dedupeKey: "catalog-data",
      payload: {},
      maxAttempts: 3,
    });
    SettingsService.set(context, "catalog-auto:data", String(now));
  }
}
