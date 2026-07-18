# Genesis Sentinel

Genesis Sentinel is a token-security intelligence platform for dangerous or malicious EVM token detection. The project is in early implementation: the monorepo foundation, durable evidence schema, Robinhood Chain adapter, scan orchestration, first evidence-backed detectors, and minimal API/web/Telegram interfaces are present.

This product must never claim a token is safe. Reports should use language such as "no critical risks detected", "low detected risk", "unable to assess", or "simulation inconclusive".

## Workspace

- `apps/web`: Next.js App Router public scanner shell.
- `apps/api`: Fastify REST API shell with health/readiness and scan creation contract.
- `apps/worker`: Background worker process shell.
- `packages/config`: Environment validation.
- `packages/observability`: Pino logger and redaction defaults.
- `packages/shared`: Shared health, scan, finding, evidence, risk, and service contracts.
- `packages/database`: Prisma schema, scan repository, and PostgreSQL readiness helper.
- `packages/queue`: Redis readiness helper.
- `packages/security-engine`: Detector interface and detector result contracts.
- `packages/chain-adapters`: Provider-neutral chain adapter interfaces and viem-backed EVM adapter.

Robinhood Chain is the first configured chain. Its public RPC is useful for development but should not be treated as production-grade high-throughput infrastructure.

## Local Setup

```bash
pnpm install
pnpm dev
```

Start dependencies:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

Copy `.env.example` to `.env` and set values for your environment. RPC keys and bot tokens must never be committed.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Stage Status

Completed:

- Stage 0 discovery for an empty local repository.
- Stage 1 monorepo foundation.
- Stage 2 domain contracts and initial evidence-oriented Prisma schema.
- Stage 3 chain adapter foundation.
- Stage 4 scan orchestration foundation.
- Stage 5 first evidence-backed detectors.
- Stage 6 minimal interfaces over persisted scan results.
- Stage 7 detector-finding risk scoring.
- Stage 8 simulation foundation with explicit unsupported simulation records.
- Stage 9 liquidity discovery foundation with explicit unsupported market discovery.
- Stage 10 holder analysis foundation with explicit unsupported holder snapshots.
- Stage 11 production deployment hardening for private alpha.
- Stage 12 Telegram bot command workflow foundation.

Not yet implemented:

- Full production scoring across simulations, liquidity, holders, and source evidence.
- Provider-neutral source, liquidity, holder, and market integrations beyond Robinhood Chain.
- Broader trade simulation coverage beyond the current Robinhood Chain route/fork paths.
- Public production scanner result completeness.
- Public Telegram launch polish and moderation controls.

Stage 7 note: detector findings can now produce a persisted risk assessment and category scores. Scoring is based only on implemented detector findings; scans without findings remain `UNABLE_TO_ASSESS` rather than being treated as broadly low risk.

Stage 8 note: scans now persist unsupported BUY, SELL, and TRANSFER simulation intents when no isolated simulation runner is configured. These records make missing simulation evidence visible without claiming trade safety, buyability, sellability, or tax behavior.

Stage 9 note: Robinhood Chain scans can discover Uniswap V2/V3/V4 pools from configured on-chain sources. Empty or unsupported liquidity results still must not imply LP safety or depth.

Stage 10 note: Robinhood Chain scans can build holder concentration snapshots from Blockscout holder data. Empty or unsupported holder results still must not imply distributed ownership.

Stage 11 note: the repo now includes container definitions for the API, worker, and web apps, production runtime knobs for API rate limits and worker concurrency, a production compose template, smoke checks, and a deployment-readiness checklist. This supports private alpha deployment, not broad public production.

Stage 12 note: the Telegram bot now supports scan submission, progress lookup, result summaries, pasted contract addresses, optional webhook secret validation, and in-process per-chat/per-user scan submission limits. It still needs live deployment setup, BotFather command registration, shared abuse counters for multi-instance public deployments, abuse monitoring, and user-facing polish before public launch.
