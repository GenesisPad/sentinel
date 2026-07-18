# ADR 0028: Scope Source-Code Risk Scanning to the Deployed Contract's Own Files

## Status

Accepted. Fixes a confirmed false-positive bug reported directly against a production scan.

## Context

A user reported that `$TRSG` (Robinhood Chain, `0x524a5be4fd55cd7a09f9b270a304b11daf67ae44`) was
scored `CRITICAL` with findings claiming ownership-recovery, admin-forced-transfer,
mint/supply-control, and arbitrary-external-call risk. The actual deployed contract
(`GenesisTokenV3`, source and bytecode both verified by the user in the report) has no owner, no
mint, no pause, no blacklist, and no admin recovery path of any kind — it mints a fixed supply
once in its constructor and has zero privileged functions afterward.

Investigation (`sourceCodeRiskDetector` in `packages/security-engine/src/index.ts`) found the
real cause: Blockscout's verified-source API for this address returns the *entire compilation
project's* source files — 84 files total, including sibling contracts from the same GenesisPad
monorepo submission (`GenesisPad.sol`, the *legacy* `GenesisToken.sol` bonding-curve template,
`GenesisLaunchFactory.sol`, various mocks) and third-party interfaces (`IUniswapV3Factory.sol`,
`IUniswapV3PoolActions.sol`) — not just the one file (`src/GenesisTokenV3.sol`) that is actually
this address's deployed bytecode. `matchSourceRule` scanned every one of those 84 files
unconditionally. Each of the 5 findings on this token traced back to a match in one of the
*unrelated* files — e.g. `SOURCE_OWNERSHIP_RECOVERY_SURFACE` matched `function setOwner(address
_owner) external;` inside Uniswap's own `IUniswapV3Factory` interface declaration, which
`GenesisTokenV3.sol` doesn't even import.

This is a systemic risk for any GenesisPad-launched token, not just this one: any project that
submits its whole `src/` directory for verification (a common Foundry/Hardhat pattern) will have
every sibling contract's risky-sounding code attributed to every other contract deployed from
that same project.

## Decision

Added `relevantSourceFilesFor(sourceFiles, contractName)` in
`packages/security-engine/src/index.ts`, called before `matchSourceRule` in
`sourceCodeRiskDetector.run`. It:

1. Finds the file declaring `contract|abstract contract|library|interface <contractName>`
   (using the `contractName` the explorer already reports — both `blockscout.ts` and
   `sourcify.ts` populate this field).
2. Walks that file's real `import` statements (parsing both `import "path"` and `import {X}
   from "path"` forms, resolving relative paths against the importing file's directory,
   matching absolute/package-style imports directly against filenames) to build the file's true
   transitive dependency closure via BFS.
3. Scans only that closure — the deployed contract's own code plus what it actually imports —
   instead of every file returned by the explorer.

When `contractName` is missing, or no file declares it, the function falls back to scanning
every file (the previous behavior) rather than guessing: under-scoping produces false positives
(this bug), but over-scoping — silently excluding a file that genuinely is part of the contract
— could hide a real finding, which is worse. The fallback keeps that trade-off resolved toward
"never worse than before," not toward maximal precision at the cost of missed evidence.

Added a regression test in `packages/security-engine/src/index.test.ts` reproducing the exact
failure shape: a clean token file importing a real OpenZeppelin dependency, bundled alongside an
unrelated Uniswap interface exposing `setOwner` and an unrelated legacy contract exposing
`forceTransfer` — asserting zero findings, where the pre-fix code would have produced two.

## Consequences

- `sourceCodeRiskDetector`'s findings will change for any already-scanned token whose verified
  source bundle included unrelated sibling files matching a risk pattern — a rescan is needed to
  pick up the corrected result; no backfill of past scans was performed (consistent with this
  project's practice of never rewriting historical `RiskAssessment` rows).
- No change to `sourceRiskRules`, detector IDs, finding codes, or the `ContractSourceDetectorInput`
  shape — this is purely a scoping fix to which files get matched, not a new capability.
- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean
  across all 19 workspace packages; security-engine suite now 53 tests (up from 52).
- Deferred, not attempted: fixing the unrelated 80-file cap in `blockscout.ts`'s
  `extractSourceFiles` (silently drops files beyond the 80th) — out of scope for this fix and
  not implicated in the reported bug, since the relevant file here was well within that limit.
