# Genesis Sentinel Current Implementation Audit

Date: 2026-07-18
Repo: `GenesisPad/sentinel`
Branch audited: `main`

## Executive Summary

Milestone 0 found the repo in a deployable but semantically inconsistent state. The production/deployment path had already been moved to `GenesisPad/sentinel`, CI was present, and auto-deploy was configured through the `Deploy to Contabo` workflow after successful `CI` runs on `main`.

The biggest product correctness issue was risk-score direction. Backend scoring used a risk-oriented score, while the web app inverted it into a "Safety Score" and several UI/docs/tests described higher scores as safer. This audit corrected the product contract to canonical `Risk Score`: `0` means minimal detected risk, `100` means maximum detected risk, and higher score means greater risk.

## Memo Bank State

Memo Bank project used: `Genesis-Sentinel`.

Relevant project memory confirmed existing production context, prior stages, Robinhood Chain deployment details, and a conflicting prior fix that mapped no findings to score `0` / `LOW`. A new Milestone 0 checkpoint was stored on 2026-07-18 before code correction. No credentials were copied into Memo Bank.

## Git And Deployment State

- Working repo: `C:\Projects\genesispad\sentinel`
- GitHub repo: `https://github.com/GenesisPad/sentinel`
- Branch: `main`
- Auto-deploy: present via `.github/workflows/deploy-contabo.yml`
- Deploy trigger: successful `CI` workflow on `main`, plus manual `workflow_dispatch`
- CI trigger: pull requests and pushes to `main`

The deploy workflow builds API, worker, and web, runs Prisma deploy, restarts PM2 services, validates local API/web readiness, and refreshes Nginx for `sentinel.genesispad.app`.

Milestone 0 also added public Nginx proxy locations for `/health` and `/ready` so production smoke checks can verify API health through the public domain after the next deployment.

## Risk Score Findings And Corrections

Canonical model now enforced:

- `0-19`: `LOW`
- `20-39`: `MODERATE`
- `40-59`: `ELEVATED`
- `60-79`: `HIGH`
- `80-100`: `CRITICAL`
- No numeric score: `UNABLE_TO_ASSESS`

Corrected:

- Shared risk levels and `riskLevelForScore` live in `packages/shared/src/index.ts`.
- `packages/security-engine/src/index.ts` no longer persists a low-risk score when no findings exist.
- Prisma now supports `ELEVATED` and `UNABLE_TO_ASSESS`; legacy `UNABLE_TO_VERIFY` remains in the enum only so old rows can be read safely.
- Database result projection maps absent assessments and legacy unable-to-verify values to public `UNABLE_TO_ASSESS`.
- Web app uses `riskScore` directly and no longer inverts backend risk into safety.
- Web labels now use `Risk Score`, `Detected risk`, and "Higher score means greater risk."
- Telegram result summaries label numeric output as `Risk Score: x/100` and include the direction note.
- Tests were updated to assert canonical risk-score direction and no numeric score for unable-to-assess scans.

## Routes And Stale Documentation

Verified active route:

- `apps/web/src/app/token/[chainId]/[address]/page.tsx`
- `apps/web/src/app/token/[chainId]/[address]/loading.tsx`

No active sanitized `-chainId-` / `-address-` route remains. `apps/web/README.md` was stale and still instructed developers to rename route folders; it has been corrected.

Stale capability docs were also corrected where they still claimed liquidity, holders, and simulation paths were only unsupported foundations.

## Fixture And Placeholder Paths

Fixture paths:

- `apps/web/src/lib/fixtures.ts`
- `NEXT_PUBLIC_USE_FIXTURES` in `apps/web/src/lib/api.ts`
- `apps/web/.env.example`

Correction:

- `apps/web/src/lib/api.ts` now throws in production if `NEXT_PUBLIC_USE_FIXTURES=true`.
- Fixture scores were updated to canonical risk-score direction.

Placeholder or intentionally incomplete UI/API surfaces:

- Web recent detections still degrade to fixtures or empty data because the API does not expose recent scans yet.
- `scanEventsUrl()` remains `null`; the web app polls rather than using SSE.
- Web nav placeholder routes still exist for `explore`, `api`, and `docs`.

## Detector And Provider Coverage

Implemented evidence coverage in current repo:

- Contract bytecode existence.
- ERC-20 metadata retrieval.
- On-chain `owner()` status detection.
- Bytecode selector-pattern detectors for ownership, proxy/upgrade, mint, pause, blacklist, max transaction/wallet, trading toggle, and fee/whitelist controls.
- Verified source-code risk-pattern detector.
- Robinhood Chain Blockscout token profile and source fetch.
- Robinhood Chain Uniswap V2/V3/V4 liquidity discovery.
- Robinhood Chain holder concentration snapshots from Blockscout holder data.
- Robinhood Chain route/fork simulation paths where configured, with unsupported simulation records otherwise.

Remaining provider gaps:

- No provider-neutral explorer abstraction for Etherscan-compatible APIs, Sourcify, Blockscout, or fallback source providers.
- Robinhood Chain is the only fully wired public chain.
- Scoring still primarily uses persisted detector findings and does not yet combine simulation, liquidity, holder, and source evidence into a mature production risk model.

## Out Of Scope Existing Hooks

Telegram already contains `/track`, `/tracked`, and `/untrack` watchlist-style commands. Milestone 0 did not expand monitoring, alerts, webhooks, scheduled rescans, or watchlists. Existing hooks are documented as existing behavior, not as completed monitoring scope.

## Files Corrected In Milestone 0

- `packages/shared/src/index.ts`
- `packages/security-engine/src/index.ts`
- `packages/security-engine/src/index.test.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260718000100_canonical_risk_score_semantics/migration.sql`
- `packages/database/src/index.ts`
- `packages/database/src/index.test.ts`
- `apps/api/src/telegram.ts`
- `apps/api/src/telegram.test.ts`
- `apps/api/src/app.test.ts`
- `apps/web/src/lib/risk.ts`
- `apps/web/src/lib/types.ts`
- `apps/web/src/lib/schemas.ts`
- `apps/web/src/lib/adapt.ts`
- `apps/web/src/lib/adapt.test.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/fixtures.ts`
- `apps/web/src/components/score-gauge.tsx`
- `apps/web/src/components/result-summary.tsx`
- `apps/web/src/components/token-report-view.tsx`
- `apps/web/src/components/share-menu.tsx`
- `apps/web/src/components/site-footer.tsx`
- `apps/web/src/app/token/[chainId]/[address]/page.tsx`
- `apps/web/public/favicon.ico`
- `.github/workflows/deploy-contabo.yml`
- `apps/web/README.md`
- `README.md`
- `docs/api/openapi.md`
- `docs/architecture/risk-model.md`
- `docs/architecture/scan-lifecycle.md`
- `docs/architecture/system-overview.md`
- ADR docs referencing unable-to-assess semantics

## Recommended Next Work

- Add provider-neutral source/explorer interfaces before broadening chains.
- Add explicit score contributions for simulation, liquidity, holders, and source evidence rather than folding them into vague overall language.
- Build an API endpoint for recent scans if the web recent-detections surface should become live.
- Decide whether Telegram watchlist commands should be hidden during phases that exclude monitoring/watchlists.
