import { BangumiClient } from "@server/clients/bangumi";
import {
  deleteAccount,
  getAccount,
  listAccounts,
  listEnabledAccounts,
  upsertAccount,
} from "@server/db/accounts";
import { readPlexAccounts } from "@server/db/plex";
import type { AccountInput } from "@server/modules/accounts/types";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";

export abstract class AccountService {
  static list(context: AppContext) {
    return listAccounts(context.database).map(
      ({ accessToken, ...account }) => ({
        ...account,
        plexUsers: AccountService.bindings(context, account.plexUsers),
        tokenConfigured: Boolean(accessToken),
      }),
    );
  }

  static get(context: AppContext, id: string) {
    const account = getAccount(context.database, id);

    if (!account)
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "Bangumi 账号不存在");

    return account;
  }

  static client(context: AppContext, id: string) {
    const account = AccountService.get(context, id);

    return new BangumiClient(
      SettingsService.read(context).bangumi.apiUrl,
      context.vault.open(account.accessToken),
      context.transport ?? fetch,
    );
  }

  static targets(context: AppContext, plexUser: string) {
    return listEnabledAccounts(context.database).filter((account) =>
      AccountService.bindings(context, account.plexUsers).includes(plexUser),
    );
  }

  static bindings(context: AppContext, values: string[]) {
    const sources = readPlexAccounts(context.database);
    return [
      ...new Set(
        values.flatMap((value) => {
          if (sources.some((source) => source.id === value)) return [value];
          const legacy = sources.find(
            (source) => source.id === "default" && source.userName === value,
          );
          return [legacy?.id ?? value];
        }),
      ),
    ];
  }

  static materializeBindings(context: AppContext) {
    for (const account of listAccounts(context.database)) {
      const plexUsers = AccountService.bindings(context, account.plexUsers);
      if (JSON.stringify(plexUsers) !== JSON.stringify(account.plexUsers)) {
        upsertAccount(
          context.database,
          { plexUsers },
          { ...account, plexUsers },
        );
      }
    }
  }

  static async save(context: AppContext, input: AccountInput, id?: string) {
    const existing = id ? AccountService.get(context, id) : null;
    const plexUsers = AccountService.bindings(context, input.plexUsers);
    const sources = readPlexAccounts(context.database);
    if (
      plexUsers.some((value) => !sources.some((source) => source.id === value))
    ) {
      throw new AppError(
        400,
        "PLEX_ACCOUNT_MISSING",
        "请选择已配置的 Plex 账号",
      );
    }

    const token =
      input.token.trim() ||
      (existing ? context.vault.open(existing.accessToken) : "");

    if (!token)
      throw new AppError(400, "TOKEN_REQUIRED", "请填写 Bangumi Token");

    const user = await new BangumiClient(
      SettingsService.read(context).bangumi.apiUrl,
      token,
      context.transport ?? fetch,
    ).me();

    if (!user.username || !user.id)
      throw new AppError(502, "INVALID_ACCOUNT", "Bangumi 返回了无效账号");

    const accountId = existing?.id ?? crypto.randomUUID();

    const values = {
      username: user.username,
      nickname: user.nickname ?? "",
      accessToken: context.vault.seal(token),
      plexUsers,
      enabled: input.enabled,
      private: input.private,
    };

    upsertAccount(context.database, values, {
      id: accountId,
      ...values,
      createdAt: Date.now(),
    });

    return AccountService.list(context).find(
      (account) => account.id === accountId,
    );
  }

  static delete(context: AppContext, id: string) {
    AccountService.get(context, id);
    deleteAccount(context.database, id);

    return { ok: true };
  }
}
