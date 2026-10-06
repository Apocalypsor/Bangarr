import { accountRoutes } from "@server/modules/accounts";
import { authRoutes } from "@server/modules/auth";
import { AuthService } from "@server/modules/auth/service";
import { catalogRoutes } from "@server/modules/catalog";
import { jobsRoutes } from "@server/modules/jobs";
import { matchingRoutes } from "@server/modules/matching";
import { plexRoutes, webhookRoutes } from "@server/modules/plex";
import { recordsRoutes } from "@server/modules/records";
import { settingsRoutes } from "@server/modules/settings";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import type { HttpTransport } from "@server/utils/http";
import { Elysia } from "elysia";

export const createApp = (options: AppContext) => {
  AuthService.initialize(options);

  const transport: HttpTransport = (request) =>
    (options.transport ?? fetch)(
      options.shutdownSignal
        ? new Request(request, {
            signal: AbortSignal.any([request.signal, options.shutdownSignal]),
          })
        : request,
    );

  const context: AppContext = { ...options, transport };

  return new Elysia({ prefix: "/api" })
    .onError(({ error, code, status }) => {
      if (error instanceof AppError)
        return status(error.status, {
          code: error.code,
          message: error.message,
        });

      if (code === "VALIDATION" || code === "PARSE")
        return status(400, {
          code: "INVALID_INPUT",
          message: "请求参数不正确",
        });

      if (code === "NOT_FOUND")
        return status(404, { code: "NOT_FOUND", message: "接口不存在" });

      return status(500, {
        code: "INTERNAL_ERROR",
        message: "操作失败，请检查服务日志",
      });
    })

    .get("/health", () => ({ status: "ok" }))

    .use(webhookRoutes(context))
    .use(authRoutes(context))

    .use(catalogRoutes(context))
    .use(settingsRoutes(context))

    .use(matchingRoutes(context))
    .use(accountRoutes(context))

    .use(recordsRoutes(context))
    .use(jobsRoutes(context))

    .use(plexRoutes(context));
};

export type App = ReturnType<typeof createApp>;
