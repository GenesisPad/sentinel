# Genesis Sentinel — Web Frontend

Scanner-first token-security frontend. Next.js 16 (App Router) · React 19 · TypeScript · Tailwind
CSS v4 · shadcn/ui + Radix · Lucide · Motion · TanStack Query · Zustand · Zod · viem · Recharts.

The homepage **is** the scanner — a user pastes a contract address or token URL and scans inline
(no wallet, no login, no marketing funnel). The compact homepage result and the dedicated
`/token/:chainId/:address` page render from the **same canonical `ScanReport`**.

---

## Dynamic token route

The canonical token report route is already present at `src/app/token/[chainId]/[address]/page.tsx` with matching `loading.tsx`.

## Setup

```bash
npm install          # or pnpm / bun
cp .env.example .env.local
npm run dev
```

`.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=https://api.genesis-sentinel.example/v1
NEXT_PUBLIC_USE_FIXTURES=true      # true = local fixtures; false = hit the real API
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

With `NEXT_PUBLIC_USE_FIXTURES=true` the app is fully clickable against in-repo fixtures
(`src/lib/fixtures.ts`) — scan any valid EVM address (try `0x83ab1c92E6F4E6b1A7C4D5f6083Ab45ef1A2b3C4`).
Set it to `false` and point `NEXT_PUBLIC_API_BASE_URL` at the backend to go live. Fixtures are the
**only** place fake data lives — matches the "no fake results outside fixtures" rule.

## Architecture

- **Server components by default.** Client components (`"use client"`) only where interaction /
  animation / polling / local state is required: the scanner orchestrator, inputs, progress,
  accordions, share menu, report view.
- **TanStack Query** owns all scan data: submission, stage polling, report fetch, caching, retries
  (`src/hooks/use-scan.ts`, `use-token-report.ts`, `use-recent-scans.ts`).
- **Zustand** holds only lightweight UI state (selected chain, active scan id, trader/technical
  view, expanded findings) — `src/store/ui-store.ts`.
- **Zod** validates every API payload at the boundary (`src/lib/schemas.ts`); `src/lib/api.ts` parses
  responses through those schemas and throws typed `ApiError`s (specific codes, never a generic
  "something went wrong").
- **viem** validates/normalizes addresses and powers URL parsing (`src/lib/validate.ts`).
- The homepage moves through the required lifecycle: `idle → validating → ready → submitting →
  queued → scanning → partial/completed/failed` (`ScanState` in `src/lib/types.ts`).

## API contract (wire these)

```
POST /v1/scans                      -> ScanJob      create/resolve a scan
GET  /v1/scans/:scanId              -> ScanJob      poll stages/status (polling fallback)
GET  /v1/scans/:scanId/report       -> ScanReport   completed report for a job
GET  /v1/scans/:scanId/events       -> SSE          live stage events (preferred; helper provided)
GET  /v1/tokens/:chainId/:address   -> ScanReport   canonical report (SSR'd token page)
GET  /v1/scans/recent               -> RecentScan[] public detections
```

**Scan progress is derived from backend stages, never a random percentage** — `%` = resolved stages
÷ total. Stage statuses are backend-authoritative: `pending | running | passed | warning |
inconclusive | failed | skipped | unsupported`. `scanEventsUrl()` in `src/lib/api.ts` returns the SSE
endpoint; `useScan` currently polls — swap in an `EventSource` subscription there for live events.

## Risk Score model (higher = greater risk)

Defined once in `src/lib/risk.ts`:
```
 0-19   Low Risk
20-39   Moderate Risk
40-59   Elevated Risk
60-79   High Risk
80-100  Critical Risk
(null) Unable to Assess
```
`RiskBadge` always renders an explicit label; never render a naked numeric score. `ScoreGauge` runs the gradient **green->amber->red** (0 is minimal detected risk, 100 is maximum detected risk) and animates once from 0 to the real score (snaps under reduced motion; accessible `role="meter"` value is correct immediately). Any numeric score must be labeled `Risk Score: x/100` and accompanied by the direction copy: "Higher score means greater risk."

## Frontend states covered

1. Empty homepage · 2. Address pasted / chain detected · 3. Scan in progress (stage list + security
graph) · 4. Successful result · 5. Invalid address · 6. Unsupported chain/URL · 7. API failure
(typed messages in `error-boundary.tsx`) · 8. Partial result (banner + what failed) · 9. Previously
scanned / cached (labeled with time + block, "Run fresh scan") · 10. Mobile result view (stacked
grids, chain selector drops below input, full-width scan button).

## Key files

```
src/lib/            types, schemas (zod), chains, risk, validate (viem), api, fixtures
src/hooks/          use-scan, use-token-report, use-recent-scans, use-reduced-motion
src/store/          ui-store (zustand)
src/components/ui/  button, card, badge, input, skeleton, separator, accordion, tooltip
src/components/     scanner-hero (orchestrator), contract-input, chain-selector, scan-progress,
                    security-graph, result-summary, token-report-view, finding-card, findings-list,
                    risk-badge, score-gauge, token-header, trading-simulation, liquidity-card,
                    holder-concentration, contract-controls, scan-metadata, share-menu,
                    recent-detections, what-we-check, api-callout, site-header, site-footer,
                    empty-state, error-boundary, result-skeleton
src/app/            layout, page (home), providers, error, not-found, globals.css (Tailwind v4 theme),
                    token/[chainId]/[address]/{page,loading}, explore, api, docs
```

## Design system

Near-black `#08090a`, charcoal surfaces `#101311`/`#0c0e0c`, borders `#1c211c`/`#2c3128`, white text,
metallic grays `#8b938a`/`#6b736a`. **Lemon-green** primary `#b4f11f`. Status: green `#37d67a`, amber
`#f5a623`, orange `#ff8a3d`, red `#f0483e`. No blue/purple as primary UI accent (only tiny chain dots
+ a subtle info tone). Fonts: Space Grotesk (display), Manrope (UI), JetBrains Mono (addresses/code).
All tokens live in `@theme` in `src/app/globals.css`; use them as Tailwind classes
(`bg-surface`, `text-muted`, `text-primary`, etc.).

## Accessibility & motion

Semantic landmarks, skip link, `role="status"`/`aria-live` on validation + stage changes,
`role="meter"` on score/holder bars, accessible Radix accordions, visible focus rings, non-color
status (icons + labels next to every color). Full `prefers-reduced-motion` support: globals.css
neutralizes animations/transitions; `usePrefersReducedMotion` + Motion's `useReducedMotion` disable
the pulse ring, score-count, and layout transitions while preserving all status info.

## Performance

Scanner is interactive before secondary sections; the public token page is server-rendered with
SEO metadata + canonical URL (`generateMetadata`); reports cached via Query `staleTime`; security
graph is lightweight CSS/SVG (no 3D bundle). Recharts is included in deps for future chart-heavy
sections but the current graphs are dependency-free SVG — import it dynamically where you add charts.

## Notes / TODO for the implementing developer

- Swap `useScan` polling for the SSE stream via `scanEventsUrl()` when the backend is ready.
- shadcn is configured (`components.json`); the primitives here are hand-written in the shadcn style —
  run `npx shadcn@latest add <component>` to pull more as needed.
- `explore`, `api`, `docs` are placeholder routes so nav resolves — build out or remove.
- No wallet/auth/payments were added (per spec).
