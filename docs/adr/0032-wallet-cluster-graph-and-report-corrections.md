# ADR 0032: Wallet Cluster Graph, DexScreener Enrichment, and Report Corrections

## Status

Accepted. Responds to a second batch of user-reported issues from a live `$GEN` scan
(screenshots): a misleading "Controller" address on a source-code finding, a buy simulation
shown as "Failed" simultaneously with "No honeypot behavior detected," a missing homepage rerun
button, a "Why this rating?" section the user wants removed, and several explicitly requested
additions — a wallet-clustering bubble graph, a token avatar, a DexScreener paid-status badge,
and a liquidity health indicator in Quick Answers.

## Context and root causes

**`SOURCE_ARBITRARY_EXTERNAL_CALL` on `$GEN` showed "Controller: 0xb846…dc9c" — the token's own
address.** `createSourceEvidence` (`packages/security-engine/src/index.ts`) sets
`evidence.address = context.address` for every finding, including source-code-pattern matches
that have no real controlling address — it's the address being scanned, not a controller. The
underlying finding is a true positive (a real `.call{value: share}("")` in `GenesisToken.sol`'s
tax-distribution code), but labeling the token's own address as its "Controller" fabricated a
relationship that doesn't exist. Fixed by only setting `controller` in the web layer's
`mapFinding` when the evidence address differs from the scanned token's own address.

**Buy simulation showed "Failed" next to "No honeypot behavior detected."** `buyOutcome`/
`sellOutcome` derivation (`apps/worker/src/scan-worker.ts`) let a stale, unrelated static-call
revert override a *successful* fork simulation result — the fork is real trade execution against
forked state and is authoritative when it ran; the static call is only a cheap pre-check.
Fixed by making the fork result strictly authoritative for both the outcome and the attached
`revertReason` whenever a fork result exists.

**The homepage's own "Scan Token" flow was still pinned to the first-ever scan for an
address**, independent of ADR 0030's token-page fix. `useScan`'s `submit` mutation called
`createScan` directly with a deterministic idempotency key, never going through the "latest scan
for this token" lookup ADR 0030 added. Fixed by having `submit` call `getExistingTokenReport`
first (same helper the token page now uses) and only create a new scan when no report exists or
`fresh` is explicitly requested.

**Wallet-clustering evidence (ADR 0027) was computed but never surfaced visually.** The data —
`RelatedWalletEdge`s with type, address, confidence, and a human-readable evidence sentence — was
already present in `ScanResultView.detectorChecks` via the `WALLET_CLUSTERING_EDGES_FOUND` check,
but nothing on the frontend parsed or rendered it beyond a single aggregate count
(`clusteredWithDeployer`).

**DexScreener had more usable, real data than was being shown.** The token avatar and 24h volume
were already fetched/available but never rendered. "Dex paid" status required a new call:
DexScreener's `orders/v1/{chainId}/{tokenAddress}` endpoint (undocumented but verified live)
returns `{orders: [{type, status}], boosts: []}`; a token is considered dex-paid when any order
has `type === "tokenProfile"` and `status === "approved"`. DexScreener's public API
(https://docs.dexscreener.com/api/reference) was checked and confirmed to have **no all-time-high
price endpoint** — ATH was not implemented, rather than approximated or guessed.

## Decision

- `apps/web/src/lib/adapt.ts`: `mapFinding` now takes the scanned token's address and only
  populates `controller` when evidence address differs from it.
- `apps/worker/src/scan-worker.ts`: fork result is authoritative for `buyOutcome`/`sellOutcome`
  and `revertReason` whenever present; static-call outcome/revert reason is only used as a
  fallback when no fork ran.
- `apps/web/src/hooks/use-scan.ts`: `submit` mutation checks `getExistingTokenReport` before
  creating a new scan, matching the token page's ADR 0030 behavior.
- New `apps/web/src/components/wallet-cluster-graph.tsx`: hand-built SVG radial bubble map (no
  external graph library, consistent with the existing `security-graph.tsx` pattern) — token at
  the center, one satellite node per wallet-cluster edge, colored/labeled by edge type
  (`DEPLOYED_BY`, `OWNED_BY`, `PREVIOUSLY_OWNED_BY`, `FUNDED_BY`, `TRANSFERRED_SUPPLY_TO`,
  `SHARED_BYTECODE`), with a legend and full evidence list. `extractWalletCluster` in `adapt.ts`
  parses `WalletClusterEdge[]` out of the existing `WALLET_CLUSTERING_EDGES_FOUND` check evidence
  with full runtime type-guarding — malformed/unknown edge types are dropped, never guessed.
  Rendered in both Trader and Technical views on the token report.
- `packages/providers/src/dexscreener.ts`: `getMarketProfile` now also calls
  `orders/v1/{chainId}/{address}` to derive `dexPaid: boolean | null` (`null` when the lookup
  fails — never defaults to a guess). Threaded through `MarketProfile` →
  `collectTokenProfile`/`recordTokenProfile` → `Token.dexPaid` (new nullable column,
  migration `20260719020000_token_dex_paid`) → `TokenProfileView.dexPaid` → `TokenMeta.dexPaid`.
- `apps/web/src/components/token-header.tsx`: renders `token.iconUrl` (DexScreener avatar) via a
  plain `<img>` with `onError` fallback to the existing placeholder triangle — avoids allowlisting
  arbitrary third-party image domains in `next/image`. Added "Dex · Paid"/"Dex · Not Paid" badges.
- `apps/web/src/components/quick-answers.tsx`: Liquidity answer now shows a health-tier detail
  line (`low`/`medium`/`healthy`, from quote-side USD as a percentage of market cap — `<10%` low,
  `10–20%` medium, `>20%` healthy) alongside the existing USD figure; added a "24h volume" answer
  entry using data that already existed but was never displayed.
- `apps/web/src/components/trading-simulation.tsx`: leads with a direct "Honeypot: Yes"/
  "Honeypot: No" banner instead of "buy/sell simulation: passed/failed" as the primary signal;
  "Buy simulation"/"Sell simulation" rows renamed "Can buy"/"Can sell" with Yes/No/Unclear
  verdicts instead of Passed/Failed/Inconclusive jargon.
- `apps/web/src/components/result-summary.tsx`: removed the "Why this rating?" section entirely;
  added a "Rerun scan" button and a "View Full Report" link to the top identity card (previously
  only available lower on the page or, for rerun, inside a cache-hit-only banner).
- ATH was investigated and confirmed unavailable from DexScreener's public API — not implemented,
  to avoid fabricating a value with no real source.

## Consequences

- `Token` gained a nullable `dexPaid` column; existing rows read as `null` (unknown) until
  rescanned — never rendered as a false "Not Paid".
- `ScanReport` gained a `walletCluster: WalletClusterEdge[]` field; no new backend endpoint was
  needed since the underlying edge data was already present in `detectorChecks` evidence.
- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean
  across all workspace packages.
- DexScreener ATH remains unavailable; if a future data source (e.g. an on-chain price-history
  indexer) is added, this should get its own ADR rather than being bolted onto this one.
