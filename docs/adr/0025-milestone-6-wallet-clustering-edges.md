# ADR 0025: Milestone 6 (Continued) — Wallet Clustering Relationship Edges

## Status

Accepted. Extends ADR 0024's deployer/bytecode history slice with real relationship edges
between a token's key wallets, closing the "wallet clustering" gap the previous slice deferred.

## Context

ADR 0024 explicitly deferred all named relationship edge types. The spec asks for wallet
clustering so a scan can surface, with evidence, whether a token's deployer/owner/bytecode is
connected to other addresses Sentinel has reason to know about. As with every other milestone
this project, an edge is only ever emitted when a concrete on-chain or explorer observation
backs it — never inferred from coincidence (e.g. two wallets transacting near the same time is
explicitly not sufficient evidence on its own).

The spec also asks for classification of wallets into categories like vesting, bridge,
exchange, treasury, router, or staking contract. No verified address list exists for any of
these categories for Robinhood Chain, and Blockscout does not return this classification. Per
the project's no-fabrication rule, these remain generically labeled `CONTRACT` rather than
guessed — this labeling was already implemented prior to this slice
(`packages/providers/src/blockscout.ts`'s holder-labeling logic) and is already used to exclude
contract-held balance from the wallet-only concentration figures
(`HolderConcentration.excludedContractPct` and the `distributionRows` filter in the same file).
This ADR does not change that part of the system; it only adds the edges below.

## Decision

Added `RelatedWalletEdge`/`RelatedWalletEdgeType` to `packages/shared/src/index.ts` — a
discriminated evidence record (`type`, `address`, `confidence`, `evidence`, `source`, optional
`firstObservedBlock`) covering five edge types: `FUNDED_BY`, `DEPLOYED_BY`, `OWNED_BY`,
`SHARED_BYTECODE`, `TRANSFERRED_SUPPLY_TO`.

Added `packages/providers/src/wallet-clustering.ts` defining a `WalletClusteringProvider`
interface and a Blockscout-backed implementation:

- `findSupplyTransfersFromDeployer` — scans ERC20 `Transfer` logs from the deployer address
  within a caller-supplied block range and reports recipients receiving at least 1% of total
  supply (or any nonzero amount when total supply is unknown) as `TRANSFERRED_SUPPLY_TO` edges.
  Bounded strictly by the supplied block range.
- `findFundingWallet` — walks up to 5 pages (bounded, configurable) of a Blockscout address's
  inbound-transaction history looking for native-value transfers, and reports the sender of the
  one found deepest in that window as a best-effort `FUNDED_BY` edge. The edge's `evidence` text
  states explicitly that this is not guaranteed to be the address's true first-ever funding
  transaction, only the earliest one found within the bounded page window — the caveat lives in
  the evidence string itself, not just a doc comment, so it survives into any surfaced output.

Wired `walletClustering?: WalletClusteringProvider` into `ProviderSet`
(`packages/providers/src/types.ts`) as optional, following the same pattern as `launchpad` —
chains without a supporting explorer simply omit it. Registered for Robinhood Chain in
`packages/providers/src/registry.ts`.

Extended `deployerHistoryDetector` (`packages/security-engine/src/index.ts`) to accept
`relatedWalletEdges: RelatedWalletEdge[]` and emit a `WALLET_CLUSTERING_EDGES_FOUND` (evidence
listing every edge) or `WALLET_CLUSTERING_EDGES_ABSENT` (passed) check, plus per-edge findings:
`SUPPLY_TRANSFERRED_TO_WALLET` (severity `MEDIUM`, category `DISTRIBUTION_RISK`) for
`TRANSFERRED_SUPPLY_TO` edges, and `DEPLOYER_FUNDED_BY_WALLET` (severity `INFO`, category
`REPUTATION_RISK`) for `FUNDED_BY` edges — informational, not a risk verdict, since a funding
relationship alone proves nothing adverse.

Added `buildRelatedWalletEdges()` in `apps/worker/src/scan-worker.ts`'s `ANALYZING_CONTRACT`
stage, assembling `DEPLOYED_BY`/`OWNED_BY` (from the token profile and on-chain owner read
already collected earlier in the scan) and `SHARED_BYTECODE` (from the existing
`BytecodeReuseView`) directly from data the scan already has, plus `FUNDED_BY` and
`TRANSFERRED_SUPPLY_TO` via `providers?.walletClustering` when the chain has one wired. Burn/zero
addresses are excluded from `OWNED_BY` so renounced ownership doesn't produce a meaningless edge.

## Consequences

- `deployerHistoryDetector`'s input grew a required field; all five existing calls in
  `packages/security-engine/src/index.test.ts` were updated, plus three new tests covering the
  absent case, a `TRANSFERRED_SUPPLY_TO` finding, and a `FUNDED_BY` finding (suite: 47 tests).
- `packages/providers/src/wallet-clustering.test.ts` added (5 tests) covering both above/below
  the supply-percent threshold, a log-fetch failure returning `[]`, and the funding-wallet
  lookup's null and found cases.
- No new detector ID was added to the worker's foundation-detector list — `deployer-history`
  already ran; this slice only changes its input — so no existing exact-match test needed
  updating.
- Deferred, not attempted: cross-token clustering beyond bytecode/deployer reuse (e.g. shared
  liquidity or fee recipients across otherwise-unrelated tokens), and any address-category
  classification (bridge/exchange/treasury/router/staking/vesting) — no verified source of that
  classification exists for Robinhood Chain today, so those wallets remain labeled `CONTRACT`.
