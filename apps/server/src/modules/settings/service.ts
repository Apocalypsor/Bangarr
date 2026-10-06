import {
  findSetting,
  insertSettingIfAbsent,
  upsertSetting,
} from "@server/db/settings";
import type { Settings } from "@server/modules/settings/model";
import {
  defaultSettings,
  settingsSchema,
} from "@server/modules/settings/model";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { randomToken } from "@server/utils/secrets";
import { validateHttpUrl } from "@server/utils/url";
import { Value } from "@sinclair/typebox/value";
import { Cron } from "croner";

export abstract class SettingsService {
  static read(context: AppContext): Settings {
    const stored = SettingsService.get(context, "app");
    const saved = stored ? JSON.parse(stored) : {};

    const value = Object.fromEntries(
      Object.entries(defaultSettings).map(([section, defaults]) => [
        section,
        { ...structuredClone(defaults), ...saved[section] },
      ]),
    ) as Settings;

    if (value.plex.token)
      value.plex.token = context.vault.open(value.plex.token);

    return value;
  }

  static public(context: AppContext) {
    const value = SettingsService.read(context);

    return {
      ...value,
      plex: {
        ...value.plex,
        token: "",
        tokenConfigured: Boolean(value.plex.token),
      },
    };
  }

  static save(context: AppContext, input: Settings) {
    if (!Value.Check(settingsSchema, input))
      throw new AppError(400, "INVALID_SETTINGS", "设置格式或数值超出允许范围");

    const value = structuredClone(input);

    value.plex.url = value.plex.url.trim().replace(/\/$/, "");
    value.plex.userName = value.plex.userName.trim();

    if (value.plex.url) validateHttpUrl(value.plex.url);

    validateHttpUrl(value.bangumi.apiUrl);
    validateHttpUrl(value.bangumi.dataUrl);

    try {
      new Intl.DateTimeFormat("en", { timeZone: value.scheduler.timezone });

      const cron = new Cron(value.plex.cron, {
        paused: true,
        timezone: value.scheduler.timezone,
      });

      if (!cron.nextRun()) throw new Error("No next run");

      cron.stop();
    } catch {
      throw new AppError(400, "INVALID_SCHEDULE", "请检查 Cron 表达式与时区");
    }

    value.plex.token =
      value.plex.token.trim() || SettingsService.read(context).plex.token;

    if (
      value.plex.enabled &&
      (!value.plex.url || !value.plex.token || !value.plex.userName)
    ) {
      throw new AppError(
        400,
        "PLEX_INCOMPLETE",
        "启用 Plex 前请填写服务器地址、Token 与用户名",
      );
    }

    if (value.plex.token)
      value.plex.token = context.vault.seal(value.plex.token);

    SettingsService.set(context, "app", JSON.stringify(value));

    return SettingsService.public(context);
  }

  static webhookKey(context: AppContext) {
    const current = SettingsService.get(context, "webhook-key");

    if (current) return context.vault.open(current);

    // 多进程初始化由唯一键协调，读回最终存储的值。
    insertSettingIfAbsent(context.database, {
      key: "webhook-key",
      value: context.vault.seal(randomToken()),
      updatedAt: Date.now(),
    });

    return context.vault.open(
      SettingsService.get(context, "webhook-key") ?? "",
    );
  }

  static get(context: AppContext, key: string) {
    return findSetting(context.database, key)?.value;
  }

  static set(context: AppContext, key: string, value: string) {
    upsertSetting(
      context.database,
      { value, updatedAt: Date.now() },
      { key, value, updatedAt: Date.now() },
    );
  }
}
