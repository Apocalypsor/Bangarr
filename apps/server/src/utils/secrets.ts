import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class SecretVault {
  constructor(private key: Uint8Array) {
    if (key.length !== 32) throw new Error("加密密钥必须为 32 字节");
  }

  seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);

    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
  }

  open(value: string): string {
    if (!value.startsWith("v1:")) throw new Error("无法识别加密格式");

    const payload = Buffer.from(value.slice(3), "base64");

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      payload.subarray(0, 12),
    );

    decipher.setAuthTag(payload.subarray(12, 28));

    return Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}

export const loadVault = (directory: string): SecretVault => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const path = join(directory, "secret.key");

  try {
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }

  return new SecretVault(readFileSync(path));
};

export const tokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const randomToken = () => randomBytes(32).toString("base64url");
