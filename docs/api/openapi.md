# API Foundation

The API uses REST with OpenAPI.

Planned routes:

```http
POST /v1/scans
GET  /v1/scans/:scanId
GET  /v1/scans/:scanId/result
GET  /v1/tokens/:chainId/:address
GET  /v1/tokens/:chainId/:address/findings
GET  /v1/risk/:chainId/:address
GET  /health
GET  /ready
POST /telegram/webhook
```

Implemented routes:

- `GET /health`
- `GET /ready`
- `POST /v1/scans`
- `GET /v1/scans/:scanId`
- `GET /v1/scans/:scanId/result`
- `GET /v1/tokens/:chainId/:address/findings`
- `GET /v1/risk/:chainId/:address`
- `POST /telegram/webhook`

`GET /v1/scans/:scanId/result` returns persisted scan progress, findings, evidence, liquidity summary, holder summary, simulation records, and a risk snapshot. If scoring has not run, the risk snapshot returns `UNABLE_TO_ASSESS` and `score: null` rather than inventing a score.

`GET /v1/risk/:chainId/:address` returns the latest persisted risk snapshot for a token address. This endpoint is intentionally conservative: it reports persisted scores when available, otherwise it reports `UNABLE_TO_ASSESS`.

`GET /v1/tokens/:chainId/:address` remains planned.

`POST /telegram/webhook` accepts Telegram bot updates when `TELEGRAM_BOT_TOKEN` is configured. If `TELEGRAM_WEBHOOK_SECRET` is set, requests must include the matching `x-telegram-bot-api-secret-token` header.
