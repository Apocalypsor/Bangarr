import { settingsSchema } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const settingsRoutes = (context: AppContext) =>
  new Elysia({ name: "settings.controller", prefix: "/settings" })

    .use(sessionGuard(context))

    .get("", () => SettingsService.public(context))

    .put("", ({ body }) => SettingsService.save(context, body), {
      body: settingsSchema,
    })

    .get("/webhook", () => ({
      path: `/api/webhooks/plex/${SettingsService.webhookKey(context)}`,
    }));
