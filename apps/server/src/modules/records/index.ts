import { recordQuerySchema } from "@server/modules/records/model";
import { RecordsService } from "@server/modules/records/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const recordsRoutes = (context: AppContext) =>
  new Elysia({ name: "records.controller" })

    .use(sessionGuard(context))

    .get("/records", ({ query }) => RecordsService.list(context, query), {
      query: recordQuerySchema,
    })

    .get("/records/:id", ({ params }) => RecordsService.get(context, params.id))

    .post("/records/:id/retry", ({ params }) =>
      RecordsService.retry(context, params.id),
    );
