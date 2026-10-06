import {
  mappingSchema,
  resolveCandidateSchema,
} from "@server/modules/matching/model";
import { MatchingService } from "@server/modules/matching/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const matchingRoutes = (context: AppContext) =>
  new Elysia({ name: "matching.controller" })

    .use(sessionGuard(context))

    .get("/mappings", () => MatchingService.mappings(context))

    .post("/mappings", ({ body }) => MatchingService.save(context, body), {
      body: mappingSchema,
    })

    .put(
      "/mappings/:id",
      ({ body, params }) => MatchingService.save(context, body, params.id),
      { body: mappingSchema },
    )

    .delete("/mappings/:id", ({ params }) =>
      MatchingService.delete(context, params.id),
    )

    .get("/candidates", () => MatchingService.candidates(context))

    .post(
      "/candidates/:id/resolve",
      ({ params, body }) =>
        MatchingService.resolve(
          context,
          params.id,
          body.subjectId,
          body.episodeOffset,
        ),
      {
        body: resolveCandidateSchema,
      },
    );
