# Liquidity Discovery Architecture

Stage 9 introduced the liquidity discovery boundary. Robinhood Chain now executes live, cheap
on-chain discovery across Uniswap V3, V4, and V2 pools.

The discovery code itself now lives behind the `LiquidityProvider` interface in
`@genesis-sentinel/providers` (`packages/providers/src/robinhood-liquidity.ts`) rather than in
`apps/worker/src/scan-worker.ts` directly — see `docs/architecture/providers.md` for the
provider abstraction and how a second chain or DEX would be added.

The worker records `DISCOVERING_MARKETS` as a scan stage. For Robinhood Chain it checks configured
quote tokens against:

- Uniswap V3 factory `getPool(token, quote, fee)` across common fee tiers.
- Uniswap V4 PoolManager `Initialize` logs, then StateView `getSlot0`/`getLiquidity`.
- Uniswap V2 factory `getPair(token, quote)`.

Scan results include a liquidity summary:

- `UNSUPPORTED`: discovery was not executed.
- `AVAILABLE`: persisted liquidity pools exist for the scanned token.
- `NOT_FOUND`: reserved for future live discovery that successfully searched and found no pools.

Discovery still must not interpret missing pool records as proof of no liquidity. It may miss pools
from unconfigured quote tokens, unknown factories, RPC log limits, or non-standard DEX deployments.

V3 and V4 pools are persisted as liquidity evidence but are not treated as V2 reserves for route
quote simulation. V2 pools continue to feed the V2 router/static/fork simulation path. V4 pools do
not have standalone pool contract addresses, so the database stores a deterministic address-shaped
identifier derived from the pool id and persists the real `poolId` plus `poolManagerAddress` inside
`liquidityData`.

## LP ownership classification (Milestone 3)

Uniswap V2 pool discovery (`discoverUniswapV2Pool` in
`packages/providers/src/robinhood-liquidity.ts`) reports two distinct, separately-sourced
signals in `liquidityData` — they are never merged into one claim:

- `lpBurnedOrLockedPct` — verified by summing LP-token balances at known burn/dead addresses
  directly on-chain. This is real, checkable evidence.
- `lockStatus` — the result of a provider-neutral `LockerProvider.getLockStatus()` call (see
  `packages/providers/src/locker.ts`). It is never inferred from the burn percentage or from
  an explorer/website label — per the project rule "do not trust a website label saying
  'locked.'" Robinhood Chain is wired to `createGenesisLockerProvider`
  (`packages/providers/src/genesis-locker.ts`), reading the real, deployed Genesis Locker
  contract (`0x0372a1AE860CDc9357ac6bc8e9F97856b37B80Ed`, verified against
  `C:\Projects\genesispad\genesis-locker\contracts\deployments\robinhood.json` and
  cross-confirmed in `C:\Projects\genesispad\contracts\deployments\robinhood\
  production-stack.json`). It calls `getTokenLocks(lpToken)` then `getLock(lockId)` for each
  record, sums remaining (non-withdrawn) locked amounts, and reports `LOCKED` with the real
  locked amount and expiry (or no expiry if permanent), `UNKNOWN` when no active lock record
  exists for that LP token, or `UNSUPPORTED` for chains with no locker wired.

V3 liquidity positions are NFT-based (Uniswap's `NonfungiblePositionManager`). Generic
per-position ownership for arbitrary V3 pools is still not implemented — Robinhood Chain's
`NonfungiblePositionManager` address has not been verified independent of a specific launch,
and the project rule against fabricating unverified contract addresses applies here the same
as for V4. However, for tokens launched via GenesisPad specifically, real V3 position evidence
*is* available: see `genesispad-launch-provenance` in
`docs/detection-rules/genesispad-launch-provenance.md`, which reads the on-chain
`GenesisLaunchRegistry` — that registry records the exact `positionManager`, `positionTokenId`,
and `permanentlyLocked` status for each GenesisPad launch, so no address needs to be guessed for
that specific, common case. Non-GenesisPad V3 pools remain undetermined for position ownership.

Future liquidity discovery should:

- Prefer bounded on-chain factory/event scanners for known DEX factories on the target chain.
- Use strict block-range and time limits, then cache discovered pools in `LiquidityPool`.
- Pin pool discovery evidence to the scan block where possible.
- Identify DEX, pool address, quote token, and discovery source.
- Persist reserve/liquidity data as evidence with units and block number.
- Add LP ownership and lock checks separately.
- Add V3/V4 quoter-based swap simulation separately instead of reusing V2 constant-product math.
- Feed liquidity findings into a new scoring version rather than changing historical Stage 7 scores.

This is the cheapest credible path because it avoids paid APIs and keeps evidence explainable. It requires known factory addresses and may miss pools from unknown or non-standard DEX deployments until those factories are configured.
