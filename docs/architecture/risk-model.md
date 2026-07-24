# Risk Model

> Milestone 7 completes this document. Scoring is deterministic (no LLM, no randomness),
> explainable (every score persists its finding-level contributions), and versioned
> (`scoringVersion` changes whenever the weighting model changes; historical assessments are
> never rewritten).

Risk scores use a 0 to 100 scale:

- `0`: minimal detected risk
- `100`: maximum detected risk

Risk levels:

- `LOW`
- `MODERATE`
- `ELEVATED`
- `HIGH`
- `CRITICAL`
- `UNABLE_TO_ASSESS`

Initial categories:

- `CONTRACT_CONTROL`
- `TRADING_SAFETY`
- `LIQUIDITY_SAFETY`
- `DISTRIBUTION_RISK`
- `REPUTATION_RISK`

Genesis Sentinel must not describe tokens as safe. Scanner output should describe detected risk, missing evidence, failed checks, and confidence.

Score semantics:

- Scores are integers from 0 through 100.
- Scores represent detected risk, not absolute truth.
- `UNABLE_TO_ASSESS` is a risk level, not a numeric score shortcut. It should be used when evidence quality is too low for a reliable category or overall assessment.
- Category scores must carry confidence independently from the overall score.
- Scoring changes must use a new `scoringVersion` and retain historical results.
- A `RiskAssessment` is always persisted, even when no detector findings exist for a scan — as an explicit `level: "UNABLE_TO_ASSESS"`, `score: null` row carrying `unableToAssessReasons`, not the absence of a row. Public interfaces (web/API/Telegram) read this persisted row rather than inferring `UNABLE_TO_ASSESS` from a missing record.
- A low score means low detected risk from implemented detectors only. It is not a safety guarantee and does not cover unimplemented simulations, liquidity checks, holder analysis, or source verification.

Canonical score bands:

- `0-19`: `LOW`
- `20-39`: `MODERATE`
- `40-59`: `ELEVATED`
- `60-79`: `HIGH`
- `80-100`: `CRITICAL`

Scoring version history:

- `0.1.0-finding-weighted` — initial per-finding severity/confidence weighting, max-of-category
  overall score.
- `0.4.0-context-aware-clone-and-distribution-risk` (current) — canonical EIP-1167 clone
  `DELEGATECALL` and shared bytecode are informational rather than standalone risk evidence;
  measured supply distributions below 20% aggregate with no recipient at or above 5% are `LOW`
  rather than `MEDIUM`.
- `0.3.0-renounced-owner-control-neutralization` — owner-dependent control-surface
  findings are excluded when ownership is verifiably renounced, unless separate evidence shows
  a surviving proxy admin, role, hidden recovery path, obfuscated authority, or external gate.
- `0.2.0-category-weighted-with-gap-reasons` (Milestone 7) — same weighting and
  aggregation, plus: a `RiskAssessment` is always persisted, even when no findings exist (as an
  explicit `UNABLE_TO_ASSESS`/`score: null` result rather than no row at all); per-finding
  `findingContributions` are persisted alongside the aggregate so the score is reconstructible;
  `unableToAssessReasons` are collected from every detector check with outcome `UNSUPPORTED`,
  `DATA_UNAVAILABLE`, `INCONCLUSIVE`, or `FAILED` and persisted whether or not a numeric score
  was also produced, since one category can have real findings while another has missing
  evidence at the same time.

Finding weights (unchanged since `0.1.0-finding-weighted`):

- `INFO`: 5
- `LOW`: 15
- `MEDIUM`: 35
- `HIGH`: 60
- `CRITICAL`: 85

Confidence adjusts weights:

- `LOW`: 0.75x
- `MEDIUM`: 1x
- `HIGH`: 1.15x

Within a category, finding weights sum and are capped at 100. The overall score is the **maximum**
category score, never a sum across categories — this is the deliberate mechanism that keeps
scoring bounded: a token with findings in several categories does not get progressively pushed
toward 100 just for having more categories triggered, and a single severe finding cannot be
diluted by averaging it against many minor ones.

## What the score does and does not account for

The categories that must inform scoring per the project spec — severity, confidence,
exploitability, current controller status, active-vs-dormant capability, simulation evidence,
liquidity ownership, holder concentration, and deployer history — are accounted for **at the
detector layer, not the scorer**. Detectors read real on-chain/explorer state and decide whether
a capability is currently exploitable (e.g. `liveTradingStateDetector` reads live contract state
rather than only static bytecode; `ownershipStatusDetector` only raises a finding when an owner
address is active, not when it resolves to a burn address) before a finding — and its
category/severity/confidence — is ever produced. The scorer's job is strictly downstream: it
aggregates whatever findings and evidence-gap checks already exist, deterministically. This
separation is why the scorer never needs special-cased logic for "is this specific finding code
mitigated by that other specific finding code" — categories are independent, and a finding that
was never raised (because the detector determined the capability isn't currently exploitable)
contributes nothing, while a finding that was raised remains until its underlying condition
changes.

### Worked examples

- **A standard owner-controlled mint does not automatically equal a honeypot.** An active,
  non-renounced owner with a `mint()` selector produces a single `CONTRACT_CONTROL` finding
  (e.g. severity `HIGH`, confidence `MEDIUM` from static bytecode detection alone) — one category,
  capped contribution. That alone lands in the `HIGH` band from that one finding, not
  automatically `CRITICAL`; it takes multiple independent high-severity findings, or corroborating
  live-state/simulation evidence raising confidence, to reach `CRITICAL`.
- **Renounced ownership does not erase proxy-admin risk.** `OWNERSHIP_RENOUNCED` produces no
  finding (nothing to score) but a separately-detected EIP-1967 proxy admin slot still being set
  produces its own `CONTRACT_CONTROL` finding regardless of the ownership check's outcome — they
  are independent detectors evaluating independent evidence, so one passing does not delete the
  other's finding.
- **Locked liquidity does not remove tax risk.** A locked-liquidity check passing produces no
  `LIQUIDITY_SAFETY` finding, but a measured high sell tax is a `TRADING_SAFETY` finding from a
  different category entirely. The overall score is the max across categories, so a clean
  `LIQUIDITY_SAFETY` category never dilutes or cancels a risky `TRADING_SAFETY` category.
- **Sellability does not remove blacklist risk.** A passed sell-simulation check does not itself
  produce a finding; a detected blacklist-style selector still produces its own finding
  independent of whether a specific address was able to sell in one simulated attempt.
- **Missing simulation does not imply safety.** When trade simulation is `UNSUPPORTED` for a
  chain/pool combination, that check contributes an `unableToAssessReasons` entry (e.g.
  `trade-simulation/SELL_SIMULATION: UNSUPPORTED`) — it never contributes a passing/low-risk
  signal, and it does not suppress or lower any other category's real findings.

Golden tests for all five scenarios above live in
`packages/security-engine/src/index.test.ts` under `describe("risk scoring")`, asserting against
the actual `scoreFindings` implementation rather than the prose above.

Finding requirements:

- Stable finding code.
- Detector ID and detector version.
- Severity, category, and confidence.
- Plain-language description.
- Technical explanation.
- Evidence records sufficient to reproduce the finding.
- Recommendation where appropriate.

## Persisted fields (Milestone 7)

`RiskAssessment` (one row per scan, `packages/database/prisma/schema.prisma`):

- `score` (nullable — null only when `level` is `UNABLE_TO_ASSESS`)
- `level`, `confidence`, `scannerVersion`, `scoringVersion`, `explanation`
- `contributions` (JSON array of `{ code, category, severity, confidence, weight }`, one per
  finding that fed the score)
- `unableToAssessReasons` (string array; empty when no evidence gaps were found)
- `categoryScores` (child rows: `category`, `score`, `confidence`, `explanation`)

The web app, public API, and Telegram bot all read this same persisted row through
`ScanRepository.getScanResult`/`getRiskSnapshot` (`RiskSnapshot` in `packages/shared`) — none of
them recompute a score locally, so "the canonical assessment" has exactly one implementation.
