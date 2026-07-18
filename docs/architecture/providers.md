# Provider Abstraction

`@genesis-sentinel/providers` defines chain-neutral interfaces for the five evidence lookups
a scan needs beyond raw RPC access:

- `SourceProvider` — verified contract source retrieval.
- `ExplorerProvider` — token profile (name/symbol/decimals/supply/holder count/deployer/etc.)
  plus a spot USD price lookup.
- `MarketDataProvider` — supplemental market profile (price, market cap, 24h volume, pair
  liquidity) from a DEX aggregator.
- `HolderProvider` — top-holder snapshot and concentration analysis.
- `LiquidityProvider` — on-chain pool discovery across DEX protocols.
- `LockerProvider` — LP-lock verification against a specific third-party locker contract (see
  `docs/architecture/liquidity.md`; distinct from burn-address detection). Robinhood Chain is
  wired to the real, deployed Genesis Locker contract via `createGenesisLockerProvider`.
- `GenesisPadLaunchProvider` (optional `launchpad` field on `ProviderSet`) — confirms whether a
  token was launched via GenesisPad's current direct-Uniswap-V3 flow by reading the on-chain
  `GenesisLaunchRegistry`, never a website label. See
  `docs/detection-rules/genesispad-launch-provenance.md`.

Each interface exposes `supportsChain(chainId)` so callers never branch on vendor name or
adapter identity. `apps/worker/src/scan-worker.ts` looks up one `ProviderSet` per scan via
`getProviderSet(target.chainId)` and falls back to the explicit `UNSUPPORTED`/`UNAVAILABLE`
results from `@genesis-sentinel/security-engine` when no set is registered for a chain — it
never hardcodes a provider vendor or a chain name string.

## Current wiring

Only Robinhood Chain (4663) has a registered `ProviderSet` today, combining:

- `source` — a `createContractSourceChain([sourcify, blockscout])` composite, cached per
  provider. See `docs/architecture/provider-strategy.md` for the full Milestone 1 design
  (the granular `ContractSourceProvider` interface, proxy detection, bytecode-hash caching).
- `createBlockscoutExplorerProvider` / `createBlockscoutHolderProvider` — backed by the
  Robinhood Chain Blockscout instance.
- `createDexScreenerMarketDataProvider` — DexScreener, network slug `robinhood`.
- `createRobinhoodLiquidityProvider` — on-chain Uniswap V2/V3/V4 discovery against the
  Robinhood Chain factory/PoolManager addresses, using the Blockscout explorer provider's
  price lookup for USD valuation, and the wired `LockerProvider` for LP-lock evidence.
- `createGenesisLockerProvider` — real Genesis Locker LP-lock verification (see
  `docs/architecture/liquidity.md`).
- `createGenesisPadLaunchProvider` — real GenesisPad direct-V3 launch-registry lookup.

## Fallback order

**Source verification.** See `docs/architecture/provider-strategy.md` — Sourcify is tried
first, then Blockscout's legacy Etherscan-compatible `getsourcecode` endpoint, first verified
result wins. A chain with no provider support gets an explicit `UNAVAILABLE` `SourceProvider`
result — never fabricated verification.

**Token/market profile.** `collectTokenProfile` in `apps/worker/src/scan-worker.ts` merges
three sources in this precedence: on-chain ERC-20 metadata (name/symbol/decimals only) →
`ExplorerProvider.getTokenProfile` → `MarketDataProvider.getMarketProfile`. Explorer values win
over market-data values because Blockscout observes the chain directly; DexScreener only fills
gaps (e.g. price/market cap when Blockscout has no exchange rate).

**Liquidity.** A chain's `LiquidityProvider` is checked once per scan; if it finds no pools,
worker orchestration calls `describeCoverage()` to record which DEXes and quote tokens were
checked so "no pool found" is distinguishable from "not checked." Future providers (e.g. a
generic Uniswap-compatible factory scanner keyed by chain config instead of hardcoded Robinhood
addresses) should implement the same interface without changing worker orchestration.

**Holders.** Only Blockscout's holder endpoint is wired today. A chain without a `HolderProvider`
in its set gets `createUnsupportedHolderAnalysis()` — empty holder data is always reported as
unavailable, never as low concentration risk.

## Adding a new chain or vendor

1. Implement the relevant provider interface(s) in a new module under
   `packages/providers/src/`.
2. Register the chain's `ProviderSet` in `packages/providers/src/registry.ts`.
3. Worker orchestration needs no changes — it already resolves providers by `chainId` alone.
