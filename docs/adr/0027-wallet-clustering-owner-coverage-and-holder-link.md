# ADR 0027: Wallet Clustering Owner Coverage and Holder-Analysis Connection

## Status

Accepted. Follow-up to ADR 0025 (wallet-clustering edges) and ADR 0022 (holder concentration
upgrade), prompted by two gaps identified after those slices shipped: clustering only ever
traced the deployer wallet, and the resulting edges were never connected to holder
concentration.

## Context

ADR 0025's `FUNDED_BY`/`TRANSFERRED_SUPPLY_TO` lookups were hardcoded to the deployer address
only. A token whose active, non-renounced owner is a different address than the original
deployer (a common pattern — ownership transferred post-deploy) got zero funding/supply tracing
on that owner wallet. Separately, if ownership was later renounced, the previous owner's
identity and history were dropped entirely, even though a previous owner is at least as relevant
as a current one — renouncing ownership doesn't erase what that wallet did while it held control.

Independently, holder concentration (`packages/providers/src/blockscout.ts`) had no awareness of
wallet-clustering edges at all: a `TRANSFERRED_SUPPLY_TO` recipient was counted as an
independent, unrelated holder in `top1Pct`/`top10Pct`, even when Milestone 6 had direct evidence
it was deployer-controlled — understating real single-actor concentration for tokens that split
supply across nominally separate wallets.

## Decision

**Owner and previous-owner coverage** (`packages/providers/src/wallet-clustering.ts`,
`apps/worker/src/scan-worker.ts`):

- Generalized `findSupplyTransfersFromDeployer`/`SupplyTransferScanInput` to
  `findSupplyTransfersFrom`/`fromAddress` + `roleLabel`, and added `roleLabel` to
  `findFundingWallet`, so both lookups work for any tracked wallet, not only the deployer.
  Evidence text now names the role ("This token's deployer transferred...", "...the current
  owner's transaction history...") so it stays accurate regardless of which wallet was traced.
- Added `findPreviousOwnerFromRenouncement` and a new `WalletClusteringProvider.findPreviousOwner`
  method: scans `OwnershipTransferred(previousOwner, newOwner)` logs for the transaction whose
  `newOwner` is a burn/zero address, returning that log's `previousOwner`. Added
  `PREVIOUSLY_OWNED_BY` to `RelatedWalletEdgeType` (`packages/shared/src/index.ts`).
- Rewrote `buildRelatedWalletEdges` in `apps/worker/src/scan-worker.ts`: it now builds a deduped
  set of "tracked wallets" — the deployer (always), the current owner (only when active, i.e.
  not renounced), and a recovered previous owner (only looked up when the current owner is
  renounced) — and runs the funding/supply-transfer lookups against every one of them, not just
  the deployer. Renouncing ownership no longer removes a wallet from tracking; it only changes
  which specific edge type (`OWNED_BY` vs `PREVIOUSLY_OWNED_BY`) represents it.

**Holder-analysis connection** (`packages/providers/src/types.ts`,
`packages/providers/src/blockscout.ts`, `apps/worker/src/scan-worker.ts`):

- Added `HolderProviderContext.relatedWalletAddresses` and `HolderConcentration.relatedWalletPct`.
- `apps/worker/src/scan-worker.ts`'s `relatedWalletAddressesForHolders` helper passes every
  wallet-clustering edge address into holder analysis, excluding `DEPLOYED_BY`/`OWNED_BY`
  addresses (already reported via `deployerPct`/`ownerPct`) — so `relatedWalletPct` is strictly
  additive information (previous owner, funding sources, supply recipients, shared-bytecode
  redeployments), never double-counting.
- `discoverBlockscoutHolderConcentration` labels matching rows `RELATED_WALLET` and reports
  their combined balance as `relatedWalletPct`, alongside (never merged into) the existing
  raw/adjusted top-N figures — a related wallet still counts normally toward `top1Pct`/`top10Pct`
  (it really does hold that balance); `relatedWalletPct` only flags that the holding is evidenced
  as connected. Added `RELATED_WALLET_BALANCE_HIGH` to `suspiciousFlags` when `relatedWalletPct >= 5`.

## Consequences

- `WalletClusteringProvider`'s interface changed (`findSupplyTransfers` input field renamed
  `deployerAddress` → `fromAddress` plus new `roleLabel`; `findFundingWallet` input gained
  `roleLabel`; new `findPreviousOwner` method) — the one concrete implementation
  (`createBlockscoutWalletClusteringProvider`) and its test suite
  (`packages/providers/src/wallet-clustering.test.ts`, now 8 tests, up from 5) were updated.
- No detector, Prisma schema, or persisted-shape change was needed — `relatedWalletPct` rides
  the existing `HolderSnapshot.concentration` JSON column, and `PREVIOUSLY_OWNED_BY` rides the
  existing `RelatedWalletEdge` evidence structure already consumed by `deployerHistoryDetector`.
- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean
  across all 19 workspace packages after this change.
- Deferred, not attempted: tracing funding/supply-transfer history transitively through
  discovered related wallets (e.g. tracing who funded a `TRANSFERRED_SUPPLY_TO` recipient) —
  each lookup here is still one hop from a directly-known wallet (deployer/current owner/
  previous owner), not a multi-hop graph walk, to keep the bounded-lookup guarantees intact.
