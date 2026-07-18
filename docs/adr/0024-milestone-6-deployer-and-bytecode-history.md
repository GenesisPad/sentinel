# ADR 0024: Milestone 6 (Partial) — Deployer and Bytecode History from Sentinel's Own Scans

## Status

Accepted. Milestone 6 describes a large deployer/wallet intelligence surface including
funding-wallet tracing, multiple relationship edge types, and cross-token clustering. This ADR
covers a first slice: deployer scan history and bytecode reuse, both built entirely from
Sentinel's own persisted data.

## Context

The spec explicitly prefers "an internal reputation model based primarily on Sentinel's own
evidence" over external reputation services, and explicitly forbids labeling a wallet malicious
solely for redeploying contracts or being fresh. Genesis Sentinel already persists `Token`
(with `deployerAddress`) and `Contract` (with a SHA-256 `bytecodeHash`) per chain/address, plus
a full `RiskAssessment`/`Finding` history per scan — everything needed to answer "has Sentinel
seen this deployer or this exact bytecode before, and what did it find" without any external
data source.

## Decision

Added two query methods to `ScanRepository` (`packages/database/src/index.ts`):

- `getDeployerHistory(chainId, deployerAddress, excludeAddress)` — finds other `Token` rows on
  the same chain sharing `deployerAddress`, joins each to its most recent
  `COMPLETED`/`PARTIALLY_COMPLETED` scan's `RiskAssessment` and count of `HIGH`/`CRITICAL`
  `Finding` rows.
- `getBytecodeReuse(chainId, bytecodeHash, excludeAddress)` — finds other `Contract` rows on the
  same chain sharing the exact `bytecodeHash`.

Added indexes for both lookup columns (`Token.deployerAddress`, `Contract.bytecodeHash`) —
migration `20260718010000_deployer_bytecode_indexes`. Exported `hashBytecode` (previously a
private `hashHex` helper) so the worker can compute the identical hash `recordContractObservation`
persists, without re-deriving the algorithm.

Added `deployerHistoryDetector` (`packages/security-engine/src/index.ts`) consuming the
resolved `DeployerHistoryView`/`BytecodeReuseView` (new types in `packages/shared`). Findings
describe exact counts and outcomes, never a "known scammer" verdict, per the project's explicit
language rule. Wired into `apps/worker/src/scan-worker.ts`'s `ANALYZING_CONTRACT` stage.

## Consequences

- `ScanRepository`'s interface gained two required methods; all existing test doubles
  implementing it (`apps/worker/src/scan-worker.test.ts`, `apps/api/src/app.test.ts`) needed
  stub implementations added.
- No dedicated unit test exists for the two new Prisma-backed repository methods themselves —
  consistent with this file's existing precedent (no other `ScanRepository` method has a
  dedicated test; only pure mapping helpers like `toScanResultView` are unit-tested). Verifying
  the query logic against live data remains a production-smoke/manual-verification concern, same
  as the rest of this repository's Prisma-backed methods.
- Deferred, not attempted: funding-wallet tracing, shared fee/liquidity-receiver wallet
  correlation, all named relationship edge types (`FUNDED_BY`, `OWNED_BY`,
  `SHARED_FEE_RECIPIENT`, `SHARED_LIQUIDITY_RECIPIENT`, `TRANSFERRED_SUPPLY_TO`,
  `SAME_FACTORY_CREATOR`, `SENTINEL_INFERRED_RELATION`), and tracking whether a prior token
  later lost significant liquidity (no time-series liquidity snapshots are persisted).
