import { scanSchema } from "@server/modules/plex/model";
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

      const result = PlexService.webhook(context, params.key, payload);

      set.status = 202;

      return result;
    },
    { parse: "none" },
  );

export const plexRoutes = (context: AppContext) =>
  new Elysia({ name: "plex.controller", prefix: "/plex" })

    .use(sessionGuard(context))

    .get("/libraries", () => PlexService.inspect(context))

    .post(
      "/scan",
      ({ body, set }) => {
        set.status = 202;

        return PlexService.scan(context, body.full);
      },
      { body: scanSchema },
    );
