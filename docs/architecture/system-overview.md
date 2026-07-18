# Genesis Sentinel System Overview

Genesis Sentinel is a monorepo with three deployable applications and focused internal packages. The implementation avoids mock scanner conclusions and exposes only persisted scan progress, evidence-backed detector findings, and explicit missing-score states.

## Applications

- `apps/web`: Public scanner UI. It accepts a Robinhood Chain contract address, submits to the API, and displays persisted scan results.
- `apps/api`: Fastify service. It owns REST endpoints, OpenAPI registration, request validation, rate-limit hooks, and the Telegram bot boundary.
- `apps/worker`: Background process. It consumes scan jobs, gathers chain evidence, and runs detector packages.

## Packages

- `packages/config`: Validates runtime environment variables with Zod.
- `packages/observability`: Creates Pino loggers with default secret redaction.
- `packages/shared`: Shared service, health, scan lifecycle, finding, evidence, and risk contracts.
- `packages/database`: Prisma schema, scan repository, and PostgreSQL readiness checks.
- `packages/queue`: Redis readiness checks.
- `packages/security-engine`: Detector interface and detector result contracts.
- `packages/chain-adapters`: Provider-neutral chain adapter interfaces and a viem-backed EVM adapter.

Robinhood Chain is configured first. Additional EVM chains should be added as chain configuration and adapter instances rather than by changing detector contracts.

## Data Flow

1. Web, API clients, or Telegram users submit a scan request.
2. API validates the request and creates an idempotent scan job.
3. Worker resolves chain context, gathers evidence, runs detectors, persists findings, and computes risk.
4. All interfaces read the same persisted scan result and evidence.

Stage 6 adds minimal interfaces over the persisted scan result: web result pages, REST result/finding/risk endpoints, and Telegram `/scan`. Stage 7 adds detector-finding scoring. Stage 8 adds simulation records and Robinhood Chain route/fork simulation paths where supported. Stage 9 adds Robinhood Chain Uniswap V2/V3/V4 liquidity discovery. Stage 10 adds Robinhood Chain holder concentration snapshots. Stage 11 adds deployment hardening for private alpha. Quick risk responses return persisted assessments when detector findings were scored and otherwise return `UNABLE_TO_ASSESS` with `score: null`.

## Security Posture

- Environment variables are validated before service startup.
- Logs redact common credential fields.
- Public users cannot provide arbitrary RPC URLs.
- Readiness checks verify PostgreSQL and Redis reachability without exposing credentials.
- API responses avoid stack traces and raw internal errors.
- API rate limits and worker concurrency are configurable by environment.

## Remaining Implementation Targets

- Full production scoring across simulations, liquidity, holders, and source evidence.
- Provider-neutral source, liquidity, holder, and market integrations beyond Robinhood Chain.
- Broader trade and transfer simulation coverage beyond current Robinhood Chain route/fork paths.
