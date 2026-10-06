import { accountUpdateSchema, loginSchema } from "@server/modules/auth/model";
import { AuthService } from "@server/modules/auth/service";
import type { LoginAttempt } from "@server/modules/auth/types";
import { originGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { Elysia } from "elysia";

export const authRoutes = (context: AppContext) => {
  const attempts = new Map<string, LoginAttempt>();

  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: context.secureCookies ?? false,
    path: "/",
  };

  return new Elysia({ name: "auth.controller", prefix: "/auth" })

    .use(originGuard(context.publicOrigin))

    .get("/status", ({ cookie }) => ({
      user: AuthService.session(context, String(cookie.session?.value ?? "")),
    }))

    .post(
      "/login",
      async ({ body, request, cookie }) => {
        // 不信任客户端自填的 X-Forwarded-For；地址由实际 Bun socket 提供。
        const session = await AuthService.login(
          context,
          body.username,
          body.password,
          context.clientAddress?.(request) ?? "local",
          attempts,
        );

        cookie.session?.set({
          ...cookieOptions,
          value: session.token,
          expires: new Date(session.expiresAt),
        });

        return { ok: true };
      },
      { body: loginSchema },
    )

    .put(
      "/account",
      async ({ body, cookie }) => {
        const session = await AuthService.updateAccount(
          context,
          String(cookie.session?.value ?? ""),
          body,
        );

        cookie.session?.set({
          ...cookieOptions,
          value: session.token,
          expires: new Date(session.expiresAt),
        });

        return { ok: true };
      },
      { body: accountUpdateSchema },
    )

    .post(
      "/logout",
      ({ cookie }) => {
        AuthService.logout(context, String(cookie.session?.value ?? ""));
        cookie.session?.remove();

        return { ok: true };
      },
      {
        beforeHandle: ({ cookie }) => {
          if (
            !AuthService.session(context, String(cookie.session?.value ?? ""))
          ) {
            throw new AppError(401, "UNAUTHENTICATED", "请先登录");
          }
        },
      },
    );
};
