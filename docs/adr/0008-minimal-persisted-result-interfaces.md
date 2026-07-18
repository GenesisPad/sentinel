# ADR 0008: Minimal Persisted Result Interfaces

## Status

Accepted.

## Context

Stage 6 requires the public web scanner, Telegram `/scan`, and developer API to use identical scanner data. Stage 5 already persists detector results, findings, and evidence, but there was no public read model for those records.

The product must not invent a risk score or claim safety when scoring has not run.

## Decision

Expose a shared persisted result view from `packages/database`:

- `ScanResultView`
- `SecurityFindingView`
- `FindingEvidenceView`
- `RiskSnapshot`

The API exposes:

- `GET /v1/scans/:scanId/result`
- `GET /v1/tokens/:chainId/:address/findings`
- `GET /v1/risk/:chainId/:address`

Web result pages and Telegram scan submission use the same scan API contracts and application service. If a persisted `RiskAssessment` is absent, the risk snapshot returns `UNABLE_TO_ASSESS`, `score: null`, low confidence, and a message directing users to findings and evidence.

## Consequences

- Public interfaces now read from durable scan data rather than mocked UI state.
- Missing scoring is explicit and machine-readable.
- Later scoring can populate `RiskAssessment` without changing the Stage 6 interface shape.
- Telegram submission shares idempotency and queue behavior with REST scan creation.
