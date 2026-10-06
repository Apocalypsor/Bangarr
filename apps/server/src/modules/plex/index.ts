import {
  plexAccountSchema,
  plexConnectionSchema,
  scanSchema,
} from "@server/modules/plex/model";
import { PlexService } from "@server/modules/plex/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";
import { Elysia } from "elysia";

export const webhookRoutes = (context: AppContext) =>
  new Elysia({ name: "plex.webhooks", prefix: "/webhooks" }).post(
    "/plex/:key",
    async ({ params, request, set }) => {
      const contentType = request.headers.get("content-type") ?? "";
      let payload: unknown;

      try {
        if (
          contentType.includes("multipart/form-data") ||
          contentType.includes("application/x-www-form-urlencoded")
        ) {
          const raw = (await request.formData()).get("payload");

          if (typeof raw !== "string") throw new Error();

          payload = JSON.parse(raw);
        } else payload = await request.json();
      } catch {
        throw new AppError(400, "INVALID_PAYLOAD", "Plex Webhook 格式无效");
      }

      const result = await PlexService.webhook(context, params.key, payload);

      set.status = 202;

      return result;
    },
    { parse: "none" },
  );

export const plexRoutes = (context: AppContext) =>
  new Elysia({ name: "plex.controller", prefix: "/plex" })

    .use(sessionGuard(context))

    .post("/test", ({ body }) => PlexService.testConnection(context, body), {
      body: plexConnectionSchema,
    })

    .get("/accounts", () => PlexService.list(context))
    .post("/accounts", ({ body }) => PlexService.save(context, body), {
      body: plexAccountSchema,
    })
    .put(
      "/accounts/:id",
      ({ params, body }) => PlexService.save(context, body, params.id),
      { body: plexAccountSchema },
    )
    .delete("/accounts/:id", ({ params }) =>
      PlexService.delete(context, params.id),
    )
    .get("/accounts/:id/libraries", ({ params }) =>
      PlexService.inspect(context, params.id),
    )

    .post(
      "/accounts/:id/scan",
      ({ body, params, set }) => {
        set.status = 202;

        return PlexService.scan(context, params.id, body.full);
      },
      { body: scanSchema },
    );
