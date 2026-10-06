import type { accountSchema } from "@server/modules/accounts/model";

export type AccountInput = typeof accountSchema.static;
