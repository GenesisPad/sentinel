# ADR 0031: Milestone 8 — API Product (First Slice)

## Status

Accepted. Covers a first, real slice of Milestone 8's public/developer API surface: the
remaining required endpoints, SSE scan-progress events, and a genuine API-key authentication
and usage-accounting system. Not the full spec — see Consequences for what's deferred.

## Context

Before this slice, the API had `POST /v1/scans`, `GET /v1/scans/:scanId`,
`GET /v1/scans/:scanId/result`, `GET /v1/tokens/:chainId/:address`,
`GET /v1/tokens/:chainId/:address/findings`, `GET /v1/risk/:chainId/:address`, `/health`,
`/ready` — missing `GET /v1/scans/:scanId/events` (SSE) and the `/liquidity`, `/holders`,
`/deployer`, `/simulations` token sub-resources. There was no authentication at all: the
`APIKey`/`APIUsage` Prisma models existed (added in an earlier session as groundwork) but no
code created, validated, or logged against them.

## Decision

**Missing endpoints.** Added `GET /v1/tokens/:chainId/:address/{liquidity,holders,deployer,
simulations}`, each slicing the same `getLatestScanResult` result the base token endpoint
already uses (no new repository method needed for three of the four; `/deployer` additionally
calls the existing `getDeployerHistory`). `GET /v1/scans/:scanId/events` streams Server-Sent
Events derived from the scan's `ScanState` transitions — `scan.queued`, `scan.started`,
`scan.stage.started`/`scan.stage.completed` per state transition, and one of `scan.completed`/
`scan.partial`/`scan.failed` at the terminal state. `scan.stage.inconclusive` is defined (spec
requires the type to exist) but never emitted — there is no persisted per-check "inconclusive"
signal at the scan-state granularity to attach it to honestly. Polling (`GET /v1/scans/:scanId`,
already used by the web client) remains a complete fallback.

**API-key authentication.** New `packages/database/src/index.ts` `ApiKeyRepository`
(`createApiKey`, `getApiKeyByHash`, `touchApiKeyLastUsed`, `revokeApiKey`, `recordApiUsage`,
`recordAuditEvent`), mirroring the existing `TelegramTrackingRepository` factory pattern rather
than folding onto `ScanRepository`. Key format: `gs_live_<8 hex><8 hex identifier>_<48 hex
secret>` (`apps/api/src/auth.ts`) — the prefix is safe to log/display, the secret is never
stored, only its SHA-256 hash is (`APIKey.keyHash`, unique-indexed for O(1) lookup). `POST
/v1/api-keys` returns the plaintext key exactly once, in the creation response; it is not
recoverable afterward by any means. `DELETE /v1/api-keys/me` self-revokes using the presented
key — there is no separate account/ownership model yet to authorize revoking a *different* key,
so self-revocation is the only revocation path.

`APIKey` gained `scopes String[] @default(["scan:read"])` and `rateLimitPerMinute Int @default(60)`
(migration `20260719010000_api_key_scopes_and_usage_kind`). Scopes are actually enforced, not
just stored: `POST /v1/scans` requires `scan:write` on any *presented* key (anonymous requests
are still allowed — scopes only gate authenticated requests). An `onRequest` hook
(`apps/api/src/app.ts`) resolves a presented key on every request; an unknown, disabled, or
revoked key is rejected with 401 outright rather than silently falling back to anonymous.

**Rate limits.** `apps/api/src/rate-limiter.ts` is a generic in-memory sliding-window limiter
(same design as the existing `createTelegramScanLimiter`, generalized). `POST /v1/scans` checks
it per-request: authenticated requests use the key's `rateLimitPerMinute`; anonymous requests
share a stricter fixed limit (`ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE = 10`/min, keyed by IP) —
this is the actual "anonymous scan limit" the spec asks for, distinct from the pre-existing
global `@fastify/rate-limit` plugin (which is a blunt per-IP limit across all routes, not
scan-specific or key-aware). In-memory by design, matching the Telegram limiter's precedent:
cheap, no new infra, resets on restart.

**Usage accounting.** `APIUsage` gained an `ApiUsageKind` enum (`CACHED_LOOKUP`, `FRESH_SCAN`,
`DEEP_SIMULATION`, `PROVIDER_HEAVY`, `FAILED_REQUEST`, `RATE_LIMIT_EVENT`) matching the spec's
required categories. An `onResponse` hook classifies and logs every request: `RATE_LIMIT_EVENT`
for 429s, `FAILED_REQUEST` for other 4xx/5xx, `FRESH_SCAN`/`CACHED_LOOKUP` for `POST /v1/scans`
based on whether a new scan was actually created (202) or an existing one resolved (200),
`DEEP_SIMULATION` for the `/simulations` sub-resource, and `CACHED_LOOKUP` as the default for
everything else. `PROVIDER_HEAVY` classification is defined but not yet attached to any specific
route — see Consequences.

**Request IDs and audit logging.** Every response gets an `x-request-id` header set from
Fastify's own per-request `request.id`. API-key lifecycle events (`api_key.created`,
`api_key.revoked`) are recorded via a new `recordAuditEvent` method reusing the existing generic
`SecurityEvent` table rather than introducing a dedicated audit-log model.

**OpenAPI.** `@fastify/swagger`/`@fastify/swagger-ui` were already registered but no route
carried a `schema` block, so the generated document had paths but no real descriptions or
examples. Added a full `schema` (description, tags, per-status response shapes with
`additionalProperties: true`, and the four required example scenarios — completed/high-risk,
completed/low-risk, partial, unable-to-assess) to `GET /v1/risk/:chainId/:address` as a worked
example of the pattern. Discovered and fixed a real bug in the process: an initial version of
this schema declared `type: "object"` with no `properties` and no `additionalProperties`, which
made Fastify's response serializer silently strip every field down to `{}` — caught by the
existing test for this endpoint failing. `additionalProperties: true` is required on any
response schema attached to an endpoint whose full shape isn't exhaustively declared, or the
schema silently corrupts real responses.

## Consequences

- `ScanRepository` gained no new methods for this milestone (the sub-resource endpoints reuse
  `getLatestScanResult`); a new, separate `ApiKeyRepository` was added instead of extending
  `ScanRepository`, since key management is a distinct concern.
- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean
  across all 19 workspace packages. `apps/api` test suite grew from 18 to 22 tests, covering key
  creation (plaintext returned once, hash never leaked), auth acceptance/rejection, revocation,
  rate limiting, and the four new sub-resource endpoints.
- No SSE-specific test exists — matches the project's existing precedent for hard-to-unit-test
  streaming/async code (`fork-simulator.ts`'s live-fork path has none either) rather than a new
  gap introduced here.
- Deferred, not attempted in this slice:
  - Exhaustive OpenAPI `schema` blocks (with examples) for every endpoint — only
    `GET /v1/risk/:chainId/:address` got the full treatment, as a correct, working pattern to
    extend later.
  - A real account/ownership model for API keys — `DELETE /v1/api-keys/me` (self-revoke only) is
    the entire "revocation" surface; there's no way to list or revoke a key you don't currently
    hold.
  - `PROVIDER_HEAVY` usage classification is defined but not wired to any specific route (no
    endpoint was judged to cleanly qualify yet without deeper worker-side instrumentation).
  - Durable/distributed rate limiting — the in-memory limiter resets on every deploy/restart,
    same known tradeoff as the pre-existing Telegram limiter.
  - Payment/billing — explicitly out of scope per the spec itself ("prepare the data model so
    billing can be added later," not build it now); `APIUsage.units` exists for exactly this.
