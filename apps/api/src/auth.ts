import { createHash, randomBytes } from "node:crypto";

const keyPrefixTag = "gs_live";

export interface GeneratedApiKey {
  /** Full plaintext key — returned to the caller exactly once, at creation time. Never
   * persisted; only `hash` is stored. */
  plaintext: string;
  /** Visible portion, safe to log/display alongside the key's name for identification. */
  prefix: string;
  hash: string;
}

/**
 * Generates a new API key: `gs_live_<8 hex chars>_<48 hex chars>`. The prefix (tag + random
 * identifier) is safe to store and display; the secret portion is never stored — only its
 * SHA-256 hash is, so a database compromise cannot recover usable keys.
 */
export function generateApiKey(): GeneratedApiKey {
  const identifier = randomBytes(4).toString("hex");
  const prefix = `${keyPrefixTag}_${identifier}`;
  const secret = randomBytes(24).toString("hex");
  const plaintext = `${prefix}_${secret}`;

  return {
    plaintext,
    prefix,
    hash: hashApiKey(plaintext)
  };
}

export function hashApiKey(plaintextKey: string): string {
  return createHash("sha256").update(plaintextKey).digest("hex");
}

/** Reads `Authorization: Bearer <key>` or `X-API-Key: <key>` — never anything else. */
export function extractApiKey(headers: Record<string, unknown>): string | null {
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }

  const apiKeyHeader = headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  return null;
}
