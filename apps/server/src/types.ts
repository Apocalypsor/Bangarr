import type { AppDatabase } from "@server/db/client";
import type { HttpTransport } from "@server/utils/http";
import type { SecretVault } from "@server/utils/secrets";

export interface AppContext {
  database: AppDatabase;
  vault: SecretVault;
  transport?: HttpTransport;
  now?: () => number;
  secureCookies?: boolean;
  publicOrigin?: string;
  clientAddress?: (request: Request) => string;
  shutdownSignal?: AbortSignal;
}
