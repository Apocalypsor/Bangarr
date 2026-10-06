import { timingSafeEqual } from "node:crypto";
import type { PlexItem } from "@server/clients/plex";
import { PlexClient, parsePlexItem } from "@server/clients/plex";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import { isObject } from "@server/modules/plex/utils";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { tokenDigest } from "@server/utils/secrets";

export abstract class PlexService {
  static client(context: AppContext) {
    const config = SettingsService.read(context).plex;

    if (!config.url || !config.token)
      throw new AppError(400, "PLEX_INCOMPLETE", "请先保存 Plex 地址与 Token");

    return new PlexClient(config.url, config.token, context.transport ?? fetch);
  }

  static async inspect(context: AppContext) {
    const client = PlexService.client(context);

    const [server, libraries] = await Promise.all([
      client.identity(),
      client.libraries(),
    ]);

    return { server, libraries };
  }

  static scan(context: AppContext, full = false) {
    const config = SettingsService.read(context);

    if (!config.plex.enabled)
      throw new AppError(400, "PLEX_DISABLED", "请先启用 Plex 同步");

    if (!AccountService.targets(context, config.plex.userName).length)
      throw new AppError(
        400,
        "NO_ACCOUNT",
        "尚未绑定此 Plex 用户的 Bangumi 账号",
      );

    return JobsService.enqueue(context, {
      kind: "plex-scan",
      dedupeKey: "plex-scan",
      payload: { full },
      maxAttempts: config.scheduler.maxAttempts,
    });
  }

  static webhook(context: AppContext, key: string, payload: unknown) {
    PlexService.authenticate(context, key);

    if (!isObject(payload))
      throw new AppError(400, "INVALID_PAYLOAD", "Plex Webhook 报文无效");

    const event = payload.event;

    if (event !== "media.scrobble" && event !== "media.play")
      return { accepted: false, reason: "无需处理此事件" };

    if (!isObject(payload.Metadata) || !isObject(payload.Account))
      throw new AppError(400, "INVALID_PAYLOAD", "缺少 Plex 项目或用户信息");

    if (event === "media.play" && payload.Metadata.type !== "movie")
      return { accepted: false, reason: "仅电影开始播放事件需要处理" };

    if (
      event === "media.play" &&
      !SettingsService.read(context).sync.movieWatching
    )
      return { accepted: false, reason: "电影在看同步未启用" };

    const item = parsePlexItem(payload.Metadata);
    const userName = String(payload.Account.title ?? "");
    const serverId = isObject(payload.Server)
      ? String(payload.Server.uuid ?? "")
      : "";

    if (!serverId || !item.ratingKey)
      throw new AppError(400, "INVALID_PAYLOAD", "缺少 Plex 服务器或项目标识");

    const action = event === "media.play" ? "watching" : "watched";

    return PlexService.enqueue(context, item, serverId, userName, action);
  }

  private static authenticate(context: AppContext, key: string) {
    if (
      !timingSafeEqual(
        Buffer.from(tokenDigest(key)),
        Buffer.from(tokenDigest(SettingsService.webhookKey(context))),
      )
    )
      throw new AppError(401, "INVALID_WEBHOOK_KEY", "Webhook 密钥无效");
  }

  private static enqueue(
    context: AppContext,
    item: PlexItem,
    serverId: string,
    userName: string,
    action: "watching" | "watched",
  ) {
    const targets = AccountService.targets(context, userName);

    if (!targets.length)
      throw new AppError(403, "NO_ACCOUNT", "此 Plex 用户未绑定 Bangumi 账号");

    const scope = tokenDigest(JSON.stringify([serverId, userName]));

    const ids = targets.map(
      (account) =>
        JobsService.enqueue(context, {
          kind: "sync",
          dedupeKey: `sync:${scope}:${item.ratingKey}:${account.id}:${action}`,
          payload: {
            item,
            scope,
            userName,
            accountId: account.id,
            action,
            source: "plex",
          },
          maxAttempts: SettingsService.read(context).scheduler.maxAttempts,
        }).job.id,
    );

    return { accepted: true, jobIds: ids };
  }
}
