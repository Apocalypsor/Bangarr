import { timingSafeEqual } from "node:crypto";
import { PlexClient } from "@server/clients/plex";
import type { PlexItem } from "@server/clients/plex/types";
import { parsePlexItem } from "@server/clients/plex/utils";
import { transaction } from "@server/db/client";
import { readPlexAccounts, writePlexAccounts } from "@server/db/plex";
import { AccountService } from "@server/modules/accounts/service";
import { JobsService } from "@server/modules/jobs/service";
import type {
  PlexAccountInput,
  PlexConnectionInput,
} from "@server/modules/plex/model";
import { isObject } from "@server/modules/plex/utils";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { tokenDigest } from "@server/utils/secrets";
import { validateHttpUrl } from "@server/utils/url";
import { Cron } from "croner";

export abstract class PlexService {
  static list(context: AppContext) {
    return readPlexAccounts(context.database).map(({ token, ...account }) => ({
      ...account,
      token: "",
      tokenConfigured: Boolean(token),
    }));
  }

  static get(context: AppContext, id: string) {
    const account = readPlexAccounts(context.database).find(
      (row) => row.id === id,
    );
    if (!account)
      throw new AppError(404, "PLEX_ACCOUNT_MISSING", "Plex 账号不存在");
    return {
      ...account,
      token: account.token ? context.vault.open(account.token) : "",
    };
  }

  static async save(context: AppContext, input: PlexAccountInput, id?: string) {
    const previous = id ? PlexService.get(context, id) : null;
    const value = {
      ...input,
      name: input.name.trim(),
      userName: input.userName.trim(),
      url: input.url.trim().replace(/\/$/, ""),
      token: input.token.trim() || previous?.token || "",
    };
    if (!value.name || !value.userName || !value.token)
      throw new AppError(
        400,
        "PLEX_INCOMPLETE",
        "请填写账号名称、用户名和 Token",
      );
    validateHttpUrl(value.url);
    try {
      const cron = new Cron(value.cron, {
        paused: true,
        timezone: SettingsService.read(context).scheduler.timezone,
      });
      const next = cron.nextRun();
      cron.stop();
      if (!next) throw new Error();
    } catch {
      throw new AppError(400, "INVALID_SCHEDULE", "请检查扫描频率");
    }

    const connectionChanged =
      !previous || previous.url !== value.url || previous.token !== value.token;
    let serverId = previous?.serverId ?? "";
    if (connectionChanged || (!serverId && value.enabled)) {
      const client = new PlexClient(value.url, value.token, context.transport);
      const [server, libraries] = await Promise.all([
        client.identity(),
        client.libraries(),
      ]);
      if (
        value.libraryIds.some(
          (libraryId) => !libraries.some((library) => library.id === libraryId),
        )
      ) {
        throw new AppError(
          400,
          "PLEX_LIBRARY_MISSING",
          "所选媒体库不可访问，请重新选择",
        );
      }
      serverId = server.id;
    }

    const accountId = id ?? crypto.randomUUID();
    transaction(
      context.database,
      () => {
        AccountService.materializeBindings(context);
        const accounts = readPlexAccounts(context.database);
        if (id && !accounts.some((row) => row.id === id))
          throw new AppError(404, "PLEX_ACCOUNT_MISSING", "Plex 账号不存在");
        if (
          accounts.some(
            (row) =>
              row.id !== accountId &&
              (row.serverId === serverId ||
                (!row.serverId && row.url === value.url)) &&
              row.userName === value.userName,
          )
        )
          throw new AppError(
            409,
            "PLEX_ACCOUNT_EXISTS",
            "此服务器的 Plex 用户已添加",
          );
        const account = {
          ...value,
          id: accountId,
          serverId,
          token: context.vault.seal(value.token),
        };
        writePlexAccounts(context.database, [
          ...accounts.filter((row) => row.id !== accountId),
          account,
        ]);
      },
      "immediate",
    );
    return PlexService.list(context).find((row) => row.id === accountId);
  }

  static delete(context: AppContext, id: string) {
    transaction(
      context.database,
      () => {
        PlexService.get(context, id);
        AccountService.materializeBindings(context);
        writePlexAccounts(
          context.database,
          readPlexAccounts(context.database).filter((row) => row.id !== id),
        );
      },
      "immediate",
    );
    return { ok: true };
  }

  static async testConnection(context: AppContext, input: PlexConnectionInput) {
    const url = input.url.trim().replace(/\/$/, "");
    validateHttpUrl(url);

    const saved = input.accountId
      ? PlexService.get(context, input.accountId)
      : null;
    const token = input.token.trim() || (saved?.url === url ? saved.token : "");
    if (!token)
      throw new AppError(400, "PLEX_TOKEN_REQUIRED", "请填写 Plex Token");

    const client = new PlexClient(url, token, context.transport);
    const [server, libraries] = await Promise.all([
      client.identity(),
      client.libraries(),
    ]);
    return { server, libraries };
  }

  static inspect(context: AppContext, id: string) {
    const account = PlexService.get(context, id);
    return PlexService.testConnection(context, {
      url: account.url,
      token: "",
      accountId: id,
    });
  }

  static scan(context: AppContext, id: string, full = false) {
    const account = PlexService.get(context, id);
    if (!account.enabled)
      throw new AppError(400, "PLEX_DISABLED", "请先启用此 Plex 账号");
    if (!AccountService.targets(context, id).length)
      throw new AppError(
        400,
        "NO_ACCOUNT",
        "此 Plex 账号尚未绑定 Bangumi 账号",
      );
    return JobsService.enqueue(context, {
      kind: "plex-scan",
      dedupeKey: `plex-scan:${id}`,
      payload: {
        full,
        plexAccountId: id,
        plexAccountName: account.name,
        userName: account.userName,
      },
      maxAttempts: SettingsService.read(context).scheduler.maxAttempts,
    });
  }

  static async webhook(context: AppContext, key: string, payload: unknown) {
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

    const source = readPlexAccounts(context.database).find(
      (account) =>
        account.enabled &&
        account.userName === userName &&
        (!account.serverId || account.serverId === serverId),
    );
    if (!source)
      throw new AppError(
        403,
        "PLEX_ACCOUNT_UNBOUND",
        "此 Plex 账号未配置或已停用",
      );
    if (!source.serverId) {
      const configured = PlexService.get(context, source.id);
      const actual = await new PlexClient(
        configured.url,
        configured.token,
        context.transport,
      ).identity();
      if (actual.id !== serverId)
        throw new AppError(403, "PLEX_SERVER_MISMATCH", "Plex 服务器不匹配");
      transaction(
        context.database,
        () => {
          writePlexAccounts(
            context.database,
            readPlexAccounts(context.database).map((row) =>
              row.id === source.id ? { ...row, serverId } : row,
            ),
          );
        },
        "immediate",
      );
    }
    return PlexService.enqueue(
      context,
      item,
      serverId,
      userName,
      action,
      source.id,
    );
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
    plexAccountId: string,
  ) {
    const targets = AccountService.targets(context, plexAccountId);

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
            plexAccountId,
            plexAccountName: PlexService.get(context, plexAccountId).name,
          },
          maxAttempts: SettingsService.read(context).scheduler.maxAttempts,
        }).job.id,
    );

    return { accepted: true, jobIds: ids };
  }
}
