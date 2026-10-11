import { CatalogStore } from "@server/db/catalog";
import { CatalogService } from "@server/modules/catalog/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const catalogRoutes = (context: AppContext) =>
  new Elysia({ name: "catalog.controller", prefix: "/catalog" })

    .use(sessionGuard(context))

    .get("", () => new CatalogStore(context.database.path).status())

    .post("/update", ({ set }) => {
      set.status = 202;

      return CatalogService.enqueue(context);
    });
