-- Milestone 8: API key scopes/per-key rate limits, and usage-kind classification so the usage
-- model (cached lookups, fresh scans, deep simulations, provider-heavy scans, failed requests,
-- rate-limit events) is queryable, not just a raw request count.
CREATE TYPE "ApiUsageKind" AS ENUM (
  'CACHED_LOOKUP',
  'FRESH_SCAN',
  'DEEP_SIMULATION',
  'PROVIDER_HEAVY',
  'FAILED_REQUEST',
  'RATE_LIMIT_EVENT'
);

ALTER TABLE "APIKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY['scan:read']::TEXT[];
ALTER TABLE "APIKey" ADD COLUMN "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "APIUsage" ADD COLUMN "kind" "ApiUsageKind" NOT NULL DEFAULT 'CACHED_LOOKUP';

CREATE INDEX "APIUsage_kind_createdAt_idx" ON "APIUsage" ("kind", "createdAt");
