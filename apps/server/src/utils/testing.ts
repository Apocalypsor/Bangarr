import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@server/db/client";
import { SecretVault } from "@server/utils/secrets";

export const testContext = () => {
  const directory = mkdtempSync(join(tmpdir(), "bangumi-test-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  const vault = new SecretVault(crypto.getRandomValues(new Uint8Array(32)));

  return {
    directory,
    database,
    vault,
    dispose: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};
