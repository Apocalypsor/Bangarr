import { accountSchema } from "@server/modules/accounts/model";
import { AccountService } from "@server/modules/accounts/service";
import { sessionGuard } from "@server/plugins/auth";
import type { AppContext } from "@server/types";
import { Elysia } from "elysia";

export const accountRoutes = (context: AppContext) =>
  new Elysia({ name: "accounts.controller" })

    .use(sessionGuard(context))

    .get("/accounts", () => AccountService.list(context))

    .post("/accounts", ({ body }) => AccountService.save(context, body), {
      body: accountSchema,
    })

    .put(
      "/accounts/:id",
      ({ params, body }) => AccountService.save(context, body, params.id),
      { body: accountSchema },
    )

    .delete("/accounts/:id", ({ params }) =>
      AccountService.delete(context, params.id),
    );
