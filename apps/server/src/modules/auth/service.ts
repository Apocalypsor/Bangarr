import {
  deleteAdministratorSessions,
  deleteExpiredSessions,
  deleteSession,
  findAdministrator,
  getAdministrator,
  getSessionUser,
  insertAdministrator,
  insertSession,
  updateAdministrator,
} from "@server/db/auth";
import { transaction } from "@server/db/client";
import type { AccountUpdate } from "@server/modules/auth/model";
import type { LoginAttempt } from "@server/modules/auth/types";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { randomToken, tokenDigest } from "@server/utils/secrets";

export abstract class AuthService {
  static initialize(context: Pick<AppContext, "database">) {
    if (getAdministrator(context.database)) return;

    const passwordHash = Bun.password.hashSync("admin", {
      algorithm: "argon2id",
      memoryCost: 19456,
      timeCost: 2,
    });

    transaction(
      context.database,
      () => {
        if (!getAdministrator(context.database)) {
          insertAdministrator(context.database, {
            id: 1,
            username: "admin",
            passwordHash,
          });
        }
      },
      "immediate",
    );
  }

  static async updateAccount(
    context: Pick<AppContext, "database" | "now">,
    token: string,
    input: AccountUpdate,
  ) {
    const user = AuthService.session(context, token);
    if (!user) throw new AppError(401, "UNAUTHENTICATED", "请先登录");

    const admin = findAdministrator(context.database, user.username);
    if (
      !admin ||
      !(await Bun.password.verify(input.currentPassword, admin.passwordHash))
    ) {
      throw new AppError(400, "INVALID_PASSWORD", "当前密码不正确");
    }

    const username = input.username.trim();
    if (!username)
      throw new AppError(400, "USERNAME_REQUIRED", "用户名不能为空");

    const passwordHash = await Bun.password.hash(input.newPassword, {
      algorithm: "argon2id",
      memoryCost: 19456,
      timeCost: 2,
    });

    return transaction(
      context.database,
      () => {
        if (
          !AuthService.session(context, token) ||
          !updateAdministrator(context.database, admin.id, admin.passwordHash, {
            username,
            passwordHash,
          })
        ) {
          throw new AppError(
            409,
            "ACCOUNT_CHANGED",
            "登录状态或账号已变更，请重新登录",
          );
        }

        deleteAdministratorSessions(context.database, admin.id);
        return AuthService.newSession(context, admin.id);
      },
      "immediate",
    );
  }

  static async login(
    context: Pick<AppContext, "database" | "now">,
    username: string,
    password: string,
    client: string,
    attempts: Map<string, LoginAttempt>,
  ) {
    const now = (context.now ?? Date.now)();

    for (const [key, entry] of attempts)
      if (entry.expiresAt <= now) attempts.delete(key);

    const key = tokenDigest(client);
    const attempt = attempts.get(key) ?? {
      count: 0,
      expiresAt: now + 15 * 60000,
    };

    if (attempt.count >= 5)
      throw new AppError(429, "LOGIN_RATE_LIMIT", "尝试次数过多，请稍后再试");

    attempt.count += 1;
    attempts.set(key, attempt);

    const admin = findAdministrator(context.database, username);
    const valid =
      admin && (await Bun.password.verify(password, admin.passwordHash));

    if (!valid || !admin)
      throw new AppError(401, "INVALID_LOGIN", "用户名或密码错误");

    attempts.delete(key);

    return AuthService.newSession(context, admin.id);
  }

  static session(
    context: Pick<AppContext, "database" | "now">,
    token?: string,
  ) {
    if (!token) return null;

    const found = getSessionUser(
      context.database,
      tokenDigest(token),
      (context.now ?? Date.now)(),
    );

    return found ?? null;
  }

  static logout(context: Pick<AppContext, "database" | "now">, token?: string) {
    if (token) deleteSession(context.database, tokenDigest(token));
  }

  private static newSession(
    context: Pick<AppContext, "database" | "now">,
    adminId: number,
  ) {
    const token = randomToken();
    const expiresAt = (context.now ?? Date.now)() + 7 * 24 * 60 * 60000;

    deleteExpiredSessions(context.database, (context.now ?? Date.now)());
    insertSession(context.database, {
      tokenHash: tokenDigest(token),
      adminId,
      expiresAt,
    });

    return { token, expiresAt };
  }
}
