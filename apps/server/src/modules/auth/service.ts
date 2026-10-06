import {
  deleteExpiredSessions,
  deleteSession,
  findAdministrator,
  getAdministrator,
  getSessionUser,
  insertAdministrator,
  insertSession,
} from "@server/db/auth";
import { transaction } from "@server/db/client";
import type { LoginAttempt } from "@server/modules/auth/types";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { randomToken, tokenDigest } from "@server/utils/secrets";

export abstract class AuthService {
  static needsSetup(context: Pick<AppContext, "database" | "now">) {
    return !getAdministrator(context.database);
  }

  static async setup(
    context: Pick<AppContext, "database" | "now">,
    username: string,
    password: string,
  ) {
    if (!AuthService.needsSetup(context))
      throw new AppError(409, "ALREADY_INITIALIZED", "管理员已设置，请登录");

    const passwordHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 19456,
      timeCost: 2,
    });

    transaction(
      context.database,
      () => {
        if (!AuthService.needsSetup(context))
          throw new AppError(
            409,
            "ALREADY_INITIALIZED",
            "管理员已设置，请登录",
          );

        insertAdministrator(context.database, {
          id: 1,
          username,
          passwordHash,
        });
      },
      "immediate",
    );

    return AuthService.newSession(context, 1);
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
