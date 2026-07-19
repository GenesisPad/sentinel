# ADR 0034: Launchpad Creator Detection and False-Positive Fixes

## Status

Accepted. Responds to a user-supplied real launchpad transaction and a live `$CASHCAT` scan the
user flagged as unbelievable: "deployer transferred ~100% of supply to this address" naming an
address that turned out to be the token's own liquidity pool. The user's explicit ask: verify
whether Sentinel has the real deployer/creator for GenesisPad-style launches, generalize creator
detection to other launchpads, and stop generating false/misleading claims.

## Context and root causes

**Any factory-mediated token launch misattributes the real creator.** Verified against a real
`launchToken` transaction the user provided (a raw trace of an actual Robinhood Chain launch,
correction from the user: this is **Noxa Launchpad**, a third-party launchpad — not GenesisPad's
own registry-tracked flow; it's the same launchpad `$CASHCAT` used, hence the shared factory
address below): the transaction's `to` is the launch-factory contract (Blockscout tags it "Launch
Factory" via its Open Labels Initiative metadata), and the factory internally performs the
`CREATE2` that deploys the token. Blockscout's `creator_address_hash` — what `deployerAddress`
was built from — reports whoever directly called `CREATE2`, i.e. the factory, never the person
who actually signed and paid for the transaction. `$CASHCAT`'s live `deployerAddress`
(`0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb`) is exactly this factory address — confirming the
existing ADR 0030 fix (GenesisLaunchRegistry `originalCreator`) either never applied to this scan
or doesn't cover every launch path, and that the problem generalizes beyond one registry lookup.

**"Deployer transferred 100% of supply to this address" named the token's own liquidity pool.**
Cross-referencing `$CASHCAT`'s discovered pools: the address the `SUPPLY_TRANSFERRED_TO_WALLET`
finding called an unknown "wallet" (`0xa70fc67c9f69da90b63a0e4c05d229954574e313`) is its own
highest-liquidity Uniswap V3 pool. A deployer sending nearly all supply to its own pool is exactly
how a DEX launch seeds trading — expected, not a distribution risk — but the wallet-clustering
detector had no way to know an address was a pool, because liquidity discovery ran *after*
wallet-clustering in the scan pipeline.

**Two "control surface" detectors flagged read-only getters and error-parameter names as mutable
risk.** Pulled `$CASHCAT`'s actual verified source (`LaunchToken.sol`) directly from Blockscout:
`maxWalletAmount`/`maxTxAmount` are declared `immutable` (set once in the constructor, no owner,
no setter anywhere in the contract), enforced only for a fixed anti-snipe block window that
permanently expires with no way to reactivate it. Yet two findings fired anyway:
- `SOURCE_TAX_OR_LIMIT_CONTROL`'s source-regex pattern `\b(?:maxWallet|maxTx|...)\b` matched the
  word "maxWallet" — which appeared *only* as a custom error's parameter name
  (`error MaxWalletExceeded(..., uint256 maxWallet)`), completely unrelated to any control
  function.
- `MAX_TRANSACTION_CAPABILITY_SURFACE`'s selector list included `"maxWalletAmount()"` and
  `"maxTransactionAmount()"` — Solidity auto-generates a public getter with exactly that selector
  for *any* `public` state variable, including a permanently immutable one. The detector couldn't
  distinguish "a contract exposes its fixed limit for transparency" from "a privileged role can
  change this limit," because it was matching read accessors, not setters.

Both findings genuinely could not exist without an owner or a setter function — reporting them as
"control surface detected" on an ownerless, immutable contract is exactly the false-FUD risk the
user flagged.

## Decision

- **`packages/providers/src/blockscout.ts`**: `getTokenProfile` now also inspects the creation
  transaction's `from`/`to` records. When `to.is_contract` is true (the deployment called into a
  contract, not a raw EOA-to-nobody `CREATE`) and the tx sender differs from
  `creator_address_hash`, the profile reports `deployerIsLaunchFactory: true` and
  `creationTxSenderAddress` (the real signer). This is protocol-agnostic — derived from the raw
  transaction shape, not a specific registry — so it generalizes to any launchpad using a
  factory-call pattern, not just GenesisPad's.
- **`apps/worker/src/scan-worker.ts`**: `effectiveDeployerAddress` resolution now has two
  correction tiers: (1) GenesisLaunchRegistry's `originalCreator`, the most authoritative source
  for GenesisPad's current direct-V3 model; (2) `creationTxSenderAddress` when
  `deployerIsLaunchFactory` is true and tier 1 didn't resolve. Either correction re-persists the
  token's `deployerAddress`, same as the existing ADR 0030 pattern.
- Liquidity-pool discovery (`providers.liquidity.discoverPools`) now runs *before*
  wallet-clustering instead of after, and its result is reused (not re-fetched) at the
  `DISCOVERING_MARKETS` stage. `buildRelatedWalletEdges` takes a `knownPoolAddresses` set and
  filters `TRANSFERRED_SUPPLY_TO` edges pointing at the token's own discovered pools before they
  ever become a `SUPPLY_TRANSFERRED_TO_WALLET` finding.
- **`packages/security-engine/src/index.ts`**: `SOURCE_TAX_OR_LIMIT_CONTROL`'s source pattern
  dropped the bare `maxWallet|maxTx|maxTransaction` alternatives, keeping only setter-shaped names
  (`setMaxWallet`, `setMaxTx`, `setMaxTransaction`, plus the existing exclusion/whitelist
  patterns). `MAX_TRANSACTION_CAPABILITY_SURFACE`'s selector list dropped the two bare getter
  selectors (`maxWalletAmount()`, `maxTransactionAmount()`), keeping only the setter selectors
  (`setMaxTxAmount(uint256)`, `setMaxWalletAmount(uint256)`).

## Consequences

- No Prisma schema change was required — `creationTxSenderAddress`/`deployerIsLaunchFactory` are
  request-scoped provider fields, not persisted columns; the corrected value still lands in the
  existing `Token.deployerAddress` column via the same re-persist path ADR 0030 established.
- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean.
  New regression tests reproduce the exact real-world scenarios found during this investigation:
  `packages/providers/src/blockscout.test.ts` (launch-factory detection), `apps/worker/src/
  scan-worker.test.ts` (pool-seeding no longer reported as a wallet transfer), and
  `packages/security-engine/src/index.test.ts` (immutable max-wallet/max-tx limits no longer
  flagged as a control surface, both the source-pattern and selector-pattern detectors).
- Existing scans keep whatever deployer address and findings they were scored with — a rescan is
  needed to pick up both the corrected creator and the removed false-positive findings for any
  previously-scanned token.
- Ownership-status reporting itself (`ownershipStatusDetector`, `OWNER_READ_UNAVAILABLE` →
  `UNKNOWN`) was investigated and found to already be correct and honest: `$CASHCAT` genuinely has
  no `owner()`-style function at all (verified by calling `owner()`/`getOwner()`/`_owner()`
  directly against the live contract — all revert), so reporting "unknown" rather than guessing
  renounced/active is the right behavior, not a bug. The false-FUD problem here was specifically
  the two control-surface detectors, not the ownership-status detector.
- Deferred, not attempted: broadening the setter-vs-getter distinction to the *other*
  selector-pattern detectors (`pause-selector-patterns`, `blacklist-selector-patterns`,
  `trading-control-selector-patterns`, `fee-exclusion-selector-patterns`) — this ADR only fixes
  the two detectors with hard, reproduced evidence of a false positive; the others were not
  audited against a real false-positive case and changing them without one risks removing real
  coverage.
