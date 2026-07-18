# ADR 0004: Risk Scoring Semantics

## Status

Accepted

## Context

Risk output must be useful without implying certainty or safety. Scanner results can be incomplete, unsupported, inconclusive, or blocked by missing data.

## Decision

Use integer scores from 0 through 100 where higher means greater detected risk. Store category scores and overall score with confidence. Store `scoringVersion` on every risk assessment.

Risk levels:

- `LOW`
- `MODERATE`
- `HIGH`
- `CRITICAL`
- `UNABLE_TO_ASSESS`

`UNABLE_TO_ASSESS` must be available when evidence quality is insufficient. The product must not describe a token as safe.

## Consequences

- Future scoring changes can be versioned without rewriting historical results.
- Confidence is represented separately from severity and score.
- Missing data remains visible instead of being treated as low risk.
