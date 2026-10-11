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

export abstract class SettingsService {
  static read(context: AppContext): Settings {
    const stored = SettingsService.get(context, "app");
    const saved = stored ? JSON.parse(stored) : {};

    return Object.fromEntries(
      Object.entries(defaultSettings).map(([section, defaults]) => [
        section,
        { ...structuredClone(defaults), ...saved[section] },
      ]),
    ) as Settings;
  }

  static save(context: AppContext, input: Settings) {
    if (!Value.Check(settingsSchema, input))
      throw new AppError(400, "INVALID_SETTINGS", "设置格式或数值超出允许范围");

    const value = structuredClone(input);

    validateHttpUrl(value.bangumi.apiUrl);
    validateHttpUrl(value.bangumi.dataUrl);

    try {
      new Intl.DateTimeFormat("en", { timeZone: value.scheduler.timezone });
    } catch {
      throw new AppError(400, "INVALID_SCHEDULE", "请检查时区设置");
    }

    SettingsService.set(context, "app", JSON.stringify(value));

    return SettingsService.read(context);
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
