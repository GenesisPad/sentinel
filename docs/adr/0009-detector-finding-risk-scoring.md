# ADR 0009: Detector-Finding Risk Scoring

## Status

Accepted.

## Context

Stage 6 exposed persisted scan findings through API, web, and Telegram, but risk snapshots remained `UNABLE_TO_ASSESS` because no scoring engine persisted `RiskAssessment` records.

The current scanner has only bytecode, metadata, and selector-surface detectors. It does not yet have simulations, liquidity discovery, holder analysis, source verification, role storage reads, or explorer evidence.

## Decision

Stage 7 introduces scoring version `0.1.0-finding-weighted`.

The scorer consumes only persisted detector findings. It assigns weights by severity, adjusts by confidence, caps category scores at 100, and sets the overall score to the highest category score.

If there are no findings to score, the scorer returns no assessment. The worker records `SCORING` as `SKIPPED`, and public interfaces continue to report `UNABLE_TO_ASSESS` with `score: null`.

## Consequences

- Interfaces can show real persisted scores when detector findings exist.
- Absence of findings from the limited detector set is not treated as broad safety.
- Future simulation, liquidity, holder, and source-evidence scoring can use a new `scoringVersion`.
- Historical risk assessments remain tied to the scoring semantics that produced them.
