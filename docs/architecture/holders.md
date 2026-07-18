# Holder Analysis Foundation

Stage 10 defines the holder-analysis boundary without pretending Genesis Sentinel has a live holder index.

## Current Behavior

- The worker records `ANALYZING_HOLDERS` for each scan.
- The stage is marked `SKIPPED` with sanitized metadata when no holder source is configured.
- Public scan results include a `holders` summary.
- Persisted `HolderSnapshot` rows are mapped into results when they exist.

An empty holder summary means holder analysis is unsupported for that scan. It does not mean the token has healthy distribution, no whale risk, no contract-controlled holders, or low concentration.

Holder retrieval now lives behind the `HolderProvider` interface in
`@genesis-sentinel/providers` (`packages/providers/src/blockscout.ts`) rather than in
`apps/worker/src/scan-worker.ts` directly — see `docs/architecture/providers.md`.

## Milestone 4: raw vs. adjusted concentration, top20, locker classification

`HolderConcentration` now reports **both** views, never merged:

- `top1Pct`/`top5Pct`/`top10Pct`/`top20Pct` — "adjusted" concentration, excluding known burn,
  liquidity-pool, and any-contract addresses, so it reflects wallet-only distribution.
- `rawConcentration.{top1Pct,top5Pct,top10Pct,top20Pct}` — the same top-N math over every
  returned holder row, infrastructure included — what a naive "top holders" list would show.

Known non-user holder classification (the `labels` array on each `EnrichedHolder`) now
includes `LOCKER` in addition to the existing `DEPLOYER`/`OWNER`/`BURN`/`LIQUIDITY_POOL`/
`CONTRACT`/`EOA`. Robinhood Chain's registry (`packages/providers/src/registry.ts`) passes the
real, verified Genesis Locker contract address
(`0x0372a1AE860CDc9357ac6bc8e9F97856b37B80Ed`) to
`createBlockscoutHolderProvider`'s `knownLockerAddresses` option — a large balance sitting in
Genesis Locker is real, checkable evidence of a vesting/team lock, not an unexplained large
wallet, and `lockerPct` reports it as its own bucket (distinct from `burnedPct`).

Still not implemented (deferred, tracked, not silently dropped): vesting-contract, bridge,
centralized-exchange, treasury, router, and staking-contract classification (no verified
address lists exist in this codebase for any of these categories — fabricating one would be
worse than leaving holders unlabeled; such wallets remain generically labeled `CONTRACT`, which
is already excluded from wallet-only concentration via `excludedContractPct`); fresh-wallet
concentration.

## Milestone 6 connection: related-wallet clustering feeds concentration

`HolderProviderContext.relatedWalletAddresses` (populated by
`apps/worker/src/scan-worker.ts`'s `buildRelatedWalletEdges`, see ADR 0025/0027) passes every
Milestone 6 wallet-clustering edge address into holder analysis, **excluding** the
deployer/owner addresses themselves (already covered by `deployerPct`/`ownerPct`). Matching
holder rows get a `RELATED_WALLET` label, and their combined balance is reported as
`relatedWalletPct` — a real signal that a token's top holders include a previous owner, a
funding source, a supply recipient, or a shared-bytecode redeployment the deployer/owner is
connected to, rather than genuinely independent wallets. `relatedWalletPct` is additive
information alongside the existing raw/adjusted top-N figures, never merged into them — a
related wallet is still counted as an ordinary holder in `top1Pct`/`top10Pct` (it really does
hold that balance), `relatedWalletPct` just flags that the holding is evidenced as connected.
`RELATED_WALLET_BALANCE_HIGH` joins `suspiciousFlags` when `relatedWalletPct >= 5`.

## Future Sources

Holder snapshots should come from one of these bounded sources:

- A chain-specific holder index.
- A bounded `Transfer` log scanner with explicit block and time limits.
- A cached third-party snapshot source with source metadata and freshness timestamps.

## Production Requirements

Before holder concentration can affect scoring, snapshots need:

- Block number and freshness metadata.
- Top holder balances and percentages.
- Known burn, pool, treasury, bridge, and exchange labels.
- Contract-wallet and owner-controlled holder signals where available.
- Clear failure modes for incomplete history, pruned RPCs, or rate-limited sources.
