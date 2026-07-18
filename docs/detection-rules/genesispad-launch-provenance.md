# GenesisPad Launch Provenance

- Detector ID: `genesispad-launch-provenance`
- Version: `0.1.0`
- Finding code: `GENESISPAD_CONFIRMED_LAUNCH` (`INFO`)
- Evidence: `GenesisLaunchRegistry.isRegistered()`/`getLaunch()` on-chain reads (`FUNCTION` evidence type).

Confirms whether a token was launched via GenesisPad's current direct-Uniswap-V3 launch flow
by reading the on-chain `GenesisLaunchRegistry` contract — never inferred from a website label,
token metadata, or name/symbol pattern. GenesisPad's older bonding-curve launcher
(`GenesisPad.sol`/`GenesisLauncher.sol`) is intentionally not queried; only the current
direct-V3 model is recognized.

Contract address (Robinhood Chain, chain id 4663):
`0xAEeF0D03CC8E9FF7879C86Ce07b70f06084b3069`, verified against
`C:\Projects\genesispad\contracts\deployments\robinhood\direct-v3-stack.json`
(`"sourceOfTruth": true`, `"launchModel": "DIRECT_UNISWAP_V3"`).

When `isRegistered(token)` is true, `getLaunch(token)` returns a `LaunchRecord` including the
launch's pool, position manager, locker, position token id, and a `permanentlyLocked` flag. The
detector surfaces this as an `INFO`-severity, `REPUTATION_RISK`-category finding — provenance
information, not a risk signal by itself. `permanentlyLocked` reflects the registry's own
record (set when GenesisPad's `GenesisV3PositionLocker` accepts and permanently holds the
launch's Uniswap V3 position NFT — see `docs/architecture/liquidity.md`), so for GenesisPad
launches specifically this is real, registry-confirmed evidence of an unwithdrawable V3
position — solving, for this specific case, part of the "V3 position ownership" gap noted
in ADR 0020 without needing to guess a generic `NonfungiblePositionManager` address.

When the registry has no record for the token, this reports `PASSED`/
`GENESISPAD_LAUNCH_NOT_FOUND` with no finding — absence of a GenesisPad record does not imply
anything about the token's origin or risk; it only means this specific provenance check found
nothing.

Known limitations:

- Only recognizes GenesisPad's current direct-V3 launch model; a token launched under the
  retired bonding-curve model is not detected here.
- `verified` (Etherscan/Blockscout source-verification status as separately tracked by
  GenesisPad's own off-chain reporter) is surfaced as evidence but not scored.
- Does not attempt to enumerate or verify non-GenesisPad V3 positions; this detector's V3
  evidence is scoped strictly to tokens that went through GenesisPad's own launch registry.
