# Deployer and Bytecode History

- Detector ID: `deployer-history`
- Version: `0.1.0`
- Finding codes: `DEPLOYER_PRIOR_SCAN_HISTORY` (`INFO`/`MEDIUM`/`HIGH`), `BYTECODE_REUSED_ACROSS_SCANS` (`INFO`)
- Evidence: Sentinel's own persisted scan history (`EXTERNAL_SOURCE`/`BYTECODE` evidence types).

Builds deployer and wallet intelligence entirely from **Sentinel's own prior scan history** —
never an external reputation service, "known scammer" list, or heuristic guess. Two independent
lookups, both querying `packages/database`:

- `getDeployerHistory(chainId, deployerAddress, excludeAddress)` — every other token on this
  chain whose `Token.deployerAddress` matches this scan's deployer, with each one's most recent
  completed scan's risk level/score and count of `HIGH`/`CRITICAL` findings.
- `getBytecodeReuse(chainId, bytecodeHash, excludeAddress)` — every other contract on this chain
  whose persisted `Contract.bytecodeHash` (SHA-256 of runtime bytecode, computed by
  `hashBytecode`, exported from `@genesis-sentinel/database`) exactly matches this one's.

Findings describe only what was observed, in the observed terms — e.g. "This deployer address
previously created 5 other token(s) scanned by Sentinel. 3 of those scans recorded a HIGH or
CRITICAL severity finding." Severity scales with the ratio of prior high/critical outcomes
(`HIGH` at 3+, `MEDIUM` at 1-2, `INFO` at 0) but is never framed as a verdict — the
recommendation text explicitly says to review the linked prior scans rather than trust the
summary alone, per the project rule against labeling a wallet malicious solely for having
deployed multiple contracts.

Bytecode reuse is reported neutrally: identical bytecode can mean a shared, audited template
(e.g. a launchpad's standard token contract) or a cloned scam factory — the informational finding says so and
points at the other addresses for manual comparison.

When no deployer address is known for this scan, the detector reports
`DEPLOYER_HISTORY_UNAVAILABLE`/`DATA_UNAVAILABLE`, never a passing check.

Known limitations:

- Only searches the same chain (`chainId`) — a deployer active across multiple chains is not
  correlated.
- "Previous tokens" only counts tokens with a `COMPLETED`/`PARTIALLY_COMPLETED` scan that has a
  persisted risk assessment; queued/failed scans are excluded.
- Does not implement funding-wallet tracing, shared fee/liquidity-receiver wallet correlation,
  or the `FUNDED_BY`/`OWNED_BY`/`SHARED_FEE_RECIPIENT`/`SHARED_LIQUIDITY_RECIPIENT`/
  `TRANSFERRED_SUPPLY_TO`/`SAME_FACTORY_CREATOR`/`SENTINEL_INFERRED_RELATION` edge types from
  the Milestone 6 spec — deferred, not attempted this slice.
- Does not track whether a prior token "later lost more than 90% of liquidity" (the spec's
  example) — that would require time-series liquidity snapshots this codebase does not persist
  yet; only the point-in-time risk assessment from each prior token's most recent scan is used.
