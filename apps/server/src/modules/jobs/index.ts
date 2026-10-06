import { jobsQuerySchema } from "@server/modules/jobs/model";
import { JobsService } from "@server/modules/jobs/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const jobsRoutes = (context: AppContext) =>
  new Elysia({ name: "jobs.controller" })

    .use(sessionGuard(context))

    .get("/jobs", ({ query }) => JobsService.page(context, query), {
      query: jobsQuerySchema,
    })

    .post("/jobs/:id/retry", ({ params }) =>
      JobsService.retry(context, params.id),
    )

    .post("/jobs/:id/cancel", ({ params }) => {
      JobsService.cancel(context, params.id);
      return { ok: true };
    });
