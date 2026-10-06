import { AuthService } from "@server/modules/auth/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { Elysia } from "elysia";

export const originGuard = (publicOrigin?: string) =>
  new Elysia({ name: "auth.origin" }).onBeforeHandle(
    { as: "scoped" },
    ({ request }) => assertSameOrigin(request, publicOrigin),
  );

export const sessionGuard = (context: AppContext) =>
  new Elysia({ name: "auth.session" }).onBeforeHandle(
    { as: "scoped" },
    ({ request, cookie }) => {
      assertSameOrigin(request, context.publicOrigin);

      if (!AuthService.session(context, String(cookie.session?.value ?? ""))) {
        throw new AppError(401, "UNAUTHENTICATED", "请先登录");
      }
    },
  );

const assertSameOrigin = (request: Request, publicOrigin?: string) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;

  const origin = request.headers.get("origin");
  const expected = publicOrigin?.trim() || new URL(request.url).origin;

  if (
    (origin && origin !== expected) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AppError(403, "CROSS_ORIGIN", "不允许跨站修改配置");
  }
};
