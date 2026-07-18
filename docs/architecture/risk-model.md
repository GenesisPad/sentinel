# Risk Model

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

Stage 7 computes the first persisted risk assessments from implemented detector findings only.

Score semantics:

- Scores are integers from 0 through 100.
- Scores represent detected risk, not absolute truth.
- `UNABLE_TO_ASSESS` is a risk level, not a numeric score shortcut. It should be used when evidence quality is too low for a reliable category or overall assessment.
- Category scores must carry confidence independently from the overall score.
- Scoring changes must use a new `scoringVersion` and retain historical results.
- If no detector findings are available to score, no `RiskAssessment` is persisted and public interfaces report `UNABLE_TO_ASSESS` with `score: null`.
- A low score means low detected risk from implemented detectors only. It is not a safety guarantee and does not cover unimplemented simulations, liquidity checks, holder analysis, or source verification.

Canonical score bands:

- `0-19`: `LOW`
- `20-39`: `MODERATE`
- `40-59`: `ELEVATED`
- `60-79`: `HIGH`
- `80-100`: `CRITICAL`

Stage 7 scoring version:

- `0.1.0-finding-weighted`

Stage 7 finding weights:

- `INFO`: 5
- `LOW`: 15
- `MEDIUM`: 35
- `HIGH`: 60
- `CRITICAL`: 85

Confidence adjusts weights:

- `LOW`: 0.75x
- `MEDIUM`: 1x
- `HIGH`: 1.15x

The overall score is the maximum category score from persisted findings. Category scores are capped at 100.

Finding requirements:

- Stable finding code.
- Detector ID and detector version.
- Severity, category, and confidence.
- Plain-language description.
- Technical explanation.
- Evidence records sufficient to reproduce the finding.
- Recommendation where appropriate.
