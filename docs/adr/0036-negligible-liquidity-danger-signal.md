# ADR 0036: Negligible-Liquidity Danger Signal

## Status

Accepted. Responds to a live `$uhood` scan the user flagged as actively dangerous: a token whose
liquidity had been drained down to $0.18 was displaying "LP locked / burned: Yes" in green and a
neutral (not red) liquidity tone, while the user held a transaction proving the pool had just been
emptied by a huge sell. Also corrects a factual error from ADR 0034: the launchpad transaction
that ADR analyzed is **Noxa Launchpad** (a third-party launchpad also used by `$CASHCAT`, hence
the shared factory address), not GenesisPad's own registry-tracked launch flow.

## Context and root cause

**Liquidity health silently fell back to neutral whenever market cap was unavailable — even for
a pool holding $0.18.** `$uhood`'s live data: `totalLiquidityUsd: 0.175`, no `marketCapUsd`
(DexScreener has nothing to price once a pool is this dead — there's no trading activity left).
`mapLiquidity`'s old logic only called `liquidityHealthTier` when `quoteSidePctOfMarketCap` was
non-null, which itself required `marketCapUsd`. No market cap meant `healthTier` stayed `null`,
which `healthTierTone(null)` renders as `"info"` (neutral gray/white) — not the glaring red flag a
$0.18 pool actually is. The health-tier bracket system (ADR from the market-cap-aware liquidity
work) is a *ratio* check and genuinely needs a market cap to rank "low/medium/healthy" — but an
*absolute*-dollar catastrophe like $0.18 doesn't need a ratio to be obviously bad.

**"LP locked / burned: Yes" read as a safety signal on an actually-worthless pool.** Burning the
LP token only prevents someone from calling `removeLiquidity()` — it does nothing to stop the
reserves themselves being emptied through an ordinary (if enormous) sell, which is exactly what
the user's supplied transaction shows: the token's own `deployerAddress`-adjacent wallet swapped a
huge amount of tokens through the pool's Uniswap V2 router, draining nearly all of the WETH side.
`$uhood`'s LP has been 100% burned since deployment (`lpBurnedOrLockedPct: 100`) — genuinely true
— but showing that fact in green next to a pool that's down to a few cents is misleading: it reads
as "your liquidity is protected" when the actual liquidity is already gone.

**The submitted drain transaction was investigated and found to be an ordinary large sell, not a
wallet-draining exploit.** The trace shows a standard Uniswap V2
`swapExactTokensForETHSupportingFeeOnTransferTokens` call: the token's `transferFrom` moves tokens
from the transaction's own signer (using that signer's own router approval, the same approval any
DEX trade requires) into the pair, followed by a normal `swap`/WETH-`withdraw`/ETH-forward
sequence. Nothing in this specific transaction demonstrates the contract moving *other* holders'
approved tokens without their consent. `$uhood`'s source is unverified
(`sourceVerified: false`, `SOURCE_CODE_UNAVAILABLE`), so Sentinel genuinely cannot rule out a
hidden force-transfer function elsewhere in the bytecode — but that's already reflected honestly
via the HIGH risk score and the `SOURCE_CODE_UNAVAILABLE`/`ABI_UNAVAILABLE` unable-to-assess
reasons; no new finding was fabricated from a transaction that doesn't actually prove it.

**Buy/sell simulation `outcome: PASSED` reflects route availability, not liquidity sufficiency.**
`canBuy`/`canSell` are derived purely from whether a route-quote simulation returned without
error — a pool with $0.18 in it still mathematically returns a quote for a tiny trade, so
`outcome: PASSED`. This remains a factually accurate, useful signal (a *failed* route is a strong
honeypot indicator) and was left unchanged; the fix here ensures the adjacent Liquidity figure
makes the real danger unmistakable rather than changing what "Can I buy?" measures.

## Decision

- `apps/web/src/lib/adapt.ts`: `liquidityHealthTier` now takes `totalUsd` directly and checks it
  against a new `NEGLIGIBLE_LIQUIDITY_USD` floor (**$250**) *before* requiring a market-cap ratio
  — below that floor, `healthTier` is unconditionally `"low"` regardless of whether
  `quoteSidePctOfMarketCap` could be computed. `mapLiquidity` now calls this whenever `totalUsd`
  is known at all, not only when the ratio was computable.
- `apps/web/src/components/quick-answers.tsx`: `lpLockedAnswer` now also takes `totalUsd`. When
  the pool is locked/burned *and* liquidity is below the same negligible floor, the answer's tone
  flips from green to red and gains a detail line: "But pool liquidity is negligible now — burning
  the LP token doesn't stop reserves being sold out." `NEGLIGIBLE_LIQUIDITY_USD` is exported from
  `adapt.ts` and imported here rather than duplicated.
- ADR 0034 and the corresponding code comments (`scan-worker.ts`, `blockscout.ts`,
  `blockscout.test.ts`) corrected: the reference launch transaction is Noxa Launchpad's, not
  GenesisPad's. The underlying fix was already protocol-agnostic (derived from the raw
  transaction's `from`/`to` shape, never gated on GenesisPad specifically) — only the
  documentation was wrong.

## Consequences

- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean.
  New regression test in `apps/web/src/lib/adapt.test.ts` reproduces `$uhood`'s exact numbers
  ($0.175 total liquidity, no market cap, 100% LP burned) and asserts `healthTier: "low"`.
- The $250 floor is a judgment call, not derived from a cited source like the market-cap-aware
  brackets (ADR before this one) — chosen because there is no realistic token for which a
  double-digit-or-less dollar pool is a meaningful trading venue.
- The homepage and token page both pick up this fix automatically (same shared `QuickAnswers`/
  `LiquidityCard` components, per ADR 0035).
- Did not change `canBuy`/`canSell` semantics — they remain a route-availability signal, distinct
  from liquidity sufficiency, which is now unambiguously flagged by the adjacent Liquidity answer.
- Did not fabricate a new "malicious transfer" finding — the submitted transaction is a normal
  large sell using the signer's own approval, not evidence of an arbitrary-transfer exploit; the
  legitimate unknown (unverified source) is already reflected in the existing HIGH risk score and
  `DATA_UNAVAILABLE` reasons.
