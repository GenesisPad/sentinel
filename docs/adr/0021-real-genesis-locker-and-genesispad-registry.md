# ADR 0021: Real Genesis Locker and GenesisPad Launch Registry Integration

## Status

Accepted.

## Context

ADR 0020 introduced the `LockerProvider` abstraction with only an `UNSUPPORTED` implementation,
because Genesis Locker's contract addresses and ABI were not available in the Sentinel
repository at the time. The user directed that the sibling `genesispad` project on this local
machine be inspected for the real, verified contract data, and explicitly excluded NoXa and
GenesisPad's older bonding-curve/graduation model from this scope ("no more bonding curve").

Verified sources (all local sibling repos to `C:\Projects\genesispad\sentinel`):

- `C:\Projects\genesispad\genesis-locker\contracts\deployments\robinhood.json` and
  `C:\Projects\genesispad\contracts\deployments\robinhood\production-stack.json` both list the
  same Genesis Locker address — `0x0372a1AE860CDc9357ac6bc8e9F97856b37B80Ed`.
- `C:\Projects\genesispad\genesis-locker\contracts\contracts\GenesisLocker.sol` and
  `GenesisLockerV2.sol` — identical `Lock` struct and `getTokenLocks`/`getLock` view-function
  interface, read directly to determine real lock status (no ABI file needed to be trusted
  blindly — the interface was read from the actual contract source).
- `C:\Projects\genesispad\contracts\deployments\robinhood\direct-v3-stack.json` — marked
  `"sourceOfTruth": true`, `"launchModel": "DIRECT_UNISWAP_V3"` — gives the current
  `genesisLaunchRegistry` address (`0xAEeF0D03CC8E9FF7879C86Ce07b70f06084b3069`), confirming
  GenesisPad has moved off the bonding-curve model entirely for new launches.
- `C:\Projects\genesispad\contracts\src\GenesisLaunchRegistry.sol` — the `LaunchRecord` struct
  and `isRegistered`/`getLaunch` interface, read directly for the ABI shape.

## Decision

Implemented two real providers in `packages/providers/src/`:

1. **`createGenesisLockerProvider`** (`genesis-locker.ts`) — a real `LockerProvider`
   implementation. Calls `getTokenLocks(lpTokenAddress)`, then `getLock(lockId)` for each
   returned id, sums `amount - withdrawnAmount` across all locks, and reports `LOCKED` with the
   real remaining amount and expiry (or no expiry if any lock is `isPermanent`), or `UNKNOWN`
   when no lock records exist or all have been fully withdrawn. `LockerProvider.getLockStatus`'s
   signature changed to take an `adapter: ChainAdapter` parameter (needed for the on-chain
   calls); its only caller (`robinhood-liquidity.ts`'s `discoverUniswapV2Pool`) and the
   `createUnsupportedLockerProvider` fallback were both updated.
2. **`createGenesisPadLaunchProvider`** (`genesispad-registry.ts`) — reads
   `GenesisLaunchRegistry.isRegistered(token)`/`getLaunch(token)` and returns launch
   provenance (`pool`, `positionManager`, `locker`, `positionTokenId`, `permanentlyLocked`,
   `verified`, `launchTimestamp`) or `null` if not a registered GenesisPad launch. Added as a
   new, optional `launchpad` field on `ProviderSet` (optional because it's a GenesisPad-specific
   concept, not a generic per-chain one like the other five provider types).

Added `genesispadLaunchDetector` (`packages/security-engine/src/index.ts`) — an `INFO`-severity,
`REPUTATION_RISK`-category finding when a launch is confirmed, naming the real
`permanentlyLocked` status from the registry. Wired into `apps/worker/src/scan-worker.ts`'s
`ANALYZING_CONTRACT` stage alongside the other detectors added this session.

`registry.ts` now wires both real providers for Robinhood Chain, replacing the
`createUnsupportedLockerProvider()` placeholder from ADR 0020.

## Consequences

- For GenesisPad-launched tokens specifically, V3 position-level lock evidence is now real and
  available (via the registry's `permanentlyLocked` field, tied to a specific
  `positionManager`/`positionTokenId` the registry itself recorded) — without needing to guess a
  generic `NonfungiblePositionManager` address, which remains unverified for arbitrary
  (non-GenesisPad) V3 pools.
- NoXa pool discovery and GenesisPad's bonding-curve/graduation model remain explicitly out of
  scope per direct user instruction, not attempted.
- `LockerProvider.getLockStatus` is now a breaking interface change from ADR 0020 (added
  `adapter` param) — both call sites in this repo were updated; no other consumers exist yet.
- Contract addresses were sourced from local sibling-repo deployment manifests, not from
  Sentinel's own deployment records or a public registry the scanner itself verifies at
  runtime. If Genesis Locker or the launch registry are ever redeployed, these hardcoded
  addresses in `registry.ts` need a manual update, the same maintenance model already used for
  Robinhood's Uniswap V2/V3/V4 factory addresses.
