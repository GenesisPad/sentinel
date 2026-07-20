"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Braces,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FileJson,
  KeyRound,
  Link as LinkIcon,
  Radar,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Method = "GET" | "POST" | "DELETE";

interface EndpointDoc {
  id: string;
  label: string;
  method: Method;
  path: string;
  group: "Scan lifecycle" | "Partner integration" | "Token slices" | "Risk and auth";
  summary: string;
  useWhen: string;
  auth: string;
  sample: string;
  response: string;
}

const BASE_URL = "https://sentinel.genesispad.app";
const EXAMPLE_ADDRESS = "0x1111111111111111111111111111111111111111";
const EXAMPLE_SCAN_ID = `4663:${EXAMPLE_ADDRESS}:web-demo`;
const PUBLIC_READ_AUTH =
  "No API key required. Anonymous requests use public limits; partner keys only raise limits. Invalid presented keys are rejected.";

const ENDPOINTS: EndpointDoc[] = [
  {
    id: "security-summary",
    label: "Security Summary",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}/security-summary",
    group: "Partner integration",
    summary: "Plain-language Yes, No, and Unknown signals for DexScreener, DexTools, wallets, and bots.",
    useWhen: "Use this as the primary partner endpoint. It includes Honeypot, obfuscated address, cooldown, dev cluster, and fullAnalysisUrl.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}/security-summary`,
    response: `{
  "product": "Genesis Sentinel",
  "chainId": 4663,
  "address": "${EXAMPLE_ADDRESS}",
  "fullAnalysisUrl": "${BASE_URL}/token/4663/${EXAMPLE_ADDRESS}",
  "risk": { "level": "HIGH", "score": 68, "status": "AVAILABLE" },
  "devCluster": {
    "walletCount": 3,
    "knownHoldingPct": 14.82,
    "unknownHoldingWalletCount": 1,
    "wallets": [
      {
        "address": "0x2222...",
        "role": "DEPLOYED_BY",
        "holdingPct": 1.2,
        "confidence": "HIGH"
      }
    ]
  },
  "signals": [
    { "id": "honeypot", "label": "Honeypot", "answer": "NO" },
    { "id": "obfuscated_address", "label": "Hidden or obfuscated addresses", "answer": "NO" },
    { "id": "trading_cooldown", "label": "Trading cooldown", "answer": "YES" },
    { "id": "dev_cluster", "label": "Dev cluster", "answer": "YES", "value": "14.82% across 3 linked wallet(s)" }
  ]
}`
  },
  {
    id: "create-scan",
    label: "Create Or Resolve Scan",
    method: "POST",
    path: "/v1/scans",
    group: "Scan lifecycle",
    summary: "Queues a fresh scan or resolves an existing scan for the same idempotency key.",
    useWhen: "Use when your integration needs Genesis Sentinel to scan a token that has no current result.",
    auth: "No API key required. Anonymous requests use the public scan-write limit. If a key is presented for scan creation, it must include scan:write.",
    sample: `curl -X POST ${BASE_URL}/v1/scans \\
  -H "content-type: application/json" \\
  -H "idempotency-key: partner:4663:${EXAMPLE_ADDRESS}" \\
  -d '{"chainId":4663,"address":"${EXAMPLE_ADDRESS}"}'`,
    response: `{
  "scanId": "${EXAMPLE_SCAN_ID}",
  "chainId": 4663,
  "address": "${EXAMPLE_ADDRESS}",
  "state": "QUEUED",
  "scannerVersion": "0.1.0-foundation"
}`
  },
  {
    id: "scan-status",
    label: "Scan Status",
    method: "GET",
    path: "/v1/scans/{scanId}",
    group: "Scan lifecycle",
    summary: "Polls scan lifecycle state while a scan is running.",
    useWhen: "Use after POST /v1/scans until state is COMPLETED, PARTIALLY_COMPLETED, or FAILED.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/scans/${encodeURIComponent(EXAMPLE_SCAN_ID)}`,
    response: `{
  "scanId": "${EXAMPLE_SCAN_ID}",
  "state": "ANALYZING_CONTRACT",
  "message": "Scan state is ANALYZING_CONTRACT."
}`
  },
  {
    id: "scan-result",
    label: "Scan Result",
    method: "GET",
    path: "/v1/scans/{scanId}/result",
    group: "Scan lifecycle",
    summary: "Returns the persisted scan result by scan ID.",
    useWhen: "Use for your own detailed report UI when you already have a scan ID.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/scans/${encodeURIComponent(EXAMPLE_SCAN_ID)}/result`,
    response: `{
  "scan": { "state": "COMPLETED" },
  "token": { "chainId": 4663, "address": "${EXAMPLE_ADDRESS}" },
  "findings": [],
  "detectorChecks": [],
  "simulations": [],
  "risk": { "status": "AVAILABLE", "score": 32 }
}`
  },
  {
    id: "latest-token",
    label: "Latest Token Report",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}",
    group: "Token slices",
    summary: "Returns the latest persisted scan result for a token.",
    useWhen: "Use when you want the full machine-readable report for the latest scan.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}`,
    response: `{
  "token": { "address": "${EXAMPLE_ADDRESS}", "deployerAddress": "0x2222..." },
  "liquidity": { "status": "AVAILABLE", "pools": [] },
  "holders": { "status": "AVAILABLE", "snapshots": [] },
  "risk": { "level": "HIGH", "score": 68 }
}`
  },
  {
    id: "risk",
    label: "Risk Snapshot",
    method: "GET",
    path: "/v1/risk/{chainId}/{address}",
    group: "Risk and auth",
    summary: "Canonical persisted risk level, score, confidence, and finding counts.",
    useWhen: "Use for fast badges when you do not need individual signals.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/risk/4663/${EXAMPLE_ADDRESS}`,
    response: `{
  "status": "AVAILABLE",
  "level": "HIGH",
  "score": 68,
  "confidence": "HIGH",
  "message": "Persisted risk assessment is available for this scan."
}`
  },
  {
    id: "deployer",
    label: "Deployer History",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}/deployer",
    group: "Token slices",
    summary: "Resolved deployer plus prior tokens scanned by Genesis Sentinel.",
    useWhen: "Use when you want creator context separate from the main summary.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}/deployer`,
    response: `{
  "deployerAddress": "0x2222...",
  "history": {
    "previousTokenCount": 4,
    "previousHighOrCriticalCount": 1,
    "entries": []
  }
}`
  },
  {
    id: "holders",
    label: "Holders",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}/holders",
    group: "Token slices",
    summary: "Holder concentration and top-holder snapshot data.",
    useWhen: "Use for custom holder tables or cluster visualizations.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}/holders`,
    response: `{
  "status": "AVAILABLE",
  "snapshots": [
    {
      "holderCount": 1200,
      "concentration": { "top1Pct": 8.4, "top10Pct": 31.2 },
      "topHolders": { "holders": [] }
    }
  ]
}`
  },
  {
    id: "liquidity",
    label: "Liquidity",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}/liquidity",
    group: "Token slices",
    summary: "Discovered pools, liquidity values, and LP burn or lock evidence.",
    useWhen: "Use when your UI already has risk signals but needs pool detail.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}/liquidity`,
    response: `{
  "status": "AVAILABLE",
  "pools": [
    {
      "dex": "Uniswap V2",
      "poolAddress": "0x3333...",
      "liquidityData": { "totalLiquidityUsd": 250000 }
    }
  ]
}`
  },
  {
    id: "findings",
    label: "Findings",
    method: "GET",
    path: "/v1/tokens/{chainId}/{address}/findings",
    group: "Token slices",
    summary: "All persisted security findings for the token, most serious first.",
    useWhen: "Use for evidence drawers, expanded technical views, or audit export.",
    auth: PUBLIC_READ_AUTH,
    sample: `curl ${BASE_URL}/v1/tokens/4663/${EXAMPLE_ADDRESS}/findings`,
    response: `{
  "chainId": 4663,
  "address": "${EXAMPLE_ADDRESS}",
  "findings": [
    {
      "code": "SOURCE_OBFUSCATED_ADDRESS",
      "severity": "HIGH",
      "description": "Verified source code appears to reconstruct or mask address constants."
    }
  ]
}`
  },
  {
    id: "api-key",
    label: "Create API Key",
    method: "POST",
    path: "/v1/api-keys",
    group: "Risk and auth",
    summary: "Creates an API key and returns the plaintext key exactly once.",
    useWhen: "Public callers can create read keys. Admins can generate partner keys with custom limits using X-Admin-Secret.",
    auth: "Unauthenticated for default scan:read keys. Custom scopes or limits require X-Admin-Secret.",
    sample: `curl -X POST ${BASE_URL}/v1/api-keys \\
  -H "content-type: application/json" \\
  -H "x-admin-secret: $GENESIS_SENTINEL_ADMIN_SECRET" \\
  -d '{"name":"dexscreener-production-read","scopes":["scan:read"],"rateLimitPerMinute":5000}'`,
    response: `{
  "id": "key-...",
  "prefix": "gs_live_ab12cd34",
  "key": "gs_live_ab12cd34_...",
  "scopes": ["scan:read"],
  "rateLimitPerMinute": 5000
}`
  }
];

const GROUPS = ["Partner integration", "Scan lifecycle", "Token slices", "Risk and auth"] as const;

const SIGNALS = [
  ["honeypot", "Honeypot"],
  ["can_block_wallets", "Can block wallets"],
  ["hidden_owner_controls", "Hidden owner/admin controls"],
  ["obfuscated_address", "Hidden or obfuscated addresses"],
  ["suspicious_functions", "Suspicious functions"],
  ["proxy_contract", "Proxy contract"],
  ["can_create_more_tokens", "Can create more tokens"],
  ["can_pause_transfers", "Can pause transfers"],
  ["trading_cooldown", "Trading cooldown"],
  ["has_whitelist", "Whitelist or exempt wallets"],
  ["ownership_renounced", "Ownership renounced"],
  ["creator_address", "Creator address"],
  ["dev_cluster", "Dev cluster"]
] as const;

export function DeveloperDocs() {
  const [activeId, setActiveId] = useState("security-summary");
  const [copied, setCopied] = useState<string | null>(null);
  const active = ENDPOINTS.find((endpoint) => endpoint.id === activeId) ?? ENDPOINTS[0];
  const endpointsByGroup = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        endpoints: ENDPOINTS.filter((endpoint) => endpoint.group === group)
      })),
    []
  );

  async function copy(value: string, id: string) {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1200);
  }

  return (
    <main className="mx-auto max-w-[1360px] px-5 pb-16 pt-8 sm:px-7">
      <section className="grid gap-8 border-b border-border pb-9 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-primary">
            <ShieldCheck className="size-3.5" aria-hidden />
            Genesis Sentinel API
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">
            Token security data for DEX screens, wallets, bots, and internal review.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-secondary">
            Start with the security summary endpoint. It returns regular-person labels, stable IDs,
            direct evidence codes, dev-cluster holdings, and a full-analysis URL for partner buttons.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a
              href="#endpoint-explorer"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-transform duration-150 motion-safe:hover:-translate-y-0.5"
            >
              <Radar className="size-4" aria-hidden />
              Explore endpoints
            </a>
            <a
              href="/token/robinhood/0x1111111111111111111111111111111111111111"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-bold text-foreground transition-colors hover:border-muted"
            >
              <ExternalLink className="size-4" aria-hidden />
              Example full analysis
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-deep p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Clock3 className="size-4 text-primary" aria-hidden />
            Rate limits
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <RateFact label="Global default" value="120/min" />
            <RateFact label="Anonymous scans" value="10/min" />
            <RateFact label="API-key scans" value="60/min" />
            <RateFact label="Window" value="60 sec" />
          </dl>
          <p className="mt-4 text-sm leading-6 text-muted">
            `429` responses include `retry-after` and `retryAfterSeconds`. Public traffic stays
            conservative. Admin-issued partner keys can carry higher read limits without giving
            anonymous callers the same capacity.
          </p>
        </div>
      </section>

      <section className="grid gap-6 border-b border-border py-9 lg:grid-cols-4">
        <GuideStep icon={FileJson} title="1. Read summary" text="Request the latest plain-language token verdict." />
        <GuideStep icon={LinkIcon} title="2. Attach button" text="Use `fullAnalysisUrl` for View full analysis." />
        <GuideStep icon={UsersRound} title="3. Show cluster" text="Display dev cluster percent and wallet count." />
        <GuideStep icon={Activity} title="4. Refresh safely" text="Queue scans only when your cache is stale or missing." />
      </section>

      <section className="grid gap-6 border-b border-border py-9 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h2 className="font-display text-2xl font-bold">Recommended Partner Setup</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            DexScreener does not need to create an account or send a key to start. Public
            endpoints work anonymously under public limits. An admin-issued read key is only for
            sustained production volume, and a separate write key is only needed if the partner
            will queue missing scans.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <PartnerRule title="Public first" text="No key required for `security-summary`, risk, token slices, or scan polling." />
            <PartnerRule title="Read key" text="Optional high-limit `scan:read` key for sustained production traffic." />
            <PartnerRule title="Write key" text="Optional, lower limit, `scan:write`, used only for `POST /v1/scans`." />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface-deep p-5">
          <div className="text-sm font-bold text-foreground">Admin create example</div>
          <pre className="mt-3 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 text-secondary">
            <code>{`curl -X POST ${BASE_URL}/v1/api-keys \\
  -H "content-type: application/json" \\
  -H "x-admin-secret: $GENESIS_SENTINEL_ADMIN_SECRET" \\
  -d '{"name":"dexscreener-production-read","scopes":["scan:read"],"rateLimitPerMinute":5000}'`}</code>
          </pre>
        </div>
      </section>

      <section id="endpoint-explorer" className="grid gap-7 py-9 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-5 lg:self-start">
          <h2 className="font-display text-2xl font-bold">Endpoint Explorer</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Pick an endpoint to see when to use it, auth rules, cURL, and response shape.
          </p>
          <div className="mt-5 flex flex-col gap-5">
            {endpointsByGroup.map(({ group, endpoints }) => (
              <div key={group}>
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">{group}</div>
                <div className="flex flex-col gap-1.5">
                  {endpoints.map((endpoint) => (
                    <button
                      key={endpoint.id}
                      type="button"
                      onClick={() => setActiveId(endpoint.id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        active.id === endpoint.id
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border bg-surface-deep text-secondary hover:border-border-strong hover:text-foreground"
                      )}
                    >
                      <span className="font-semibold">{endpoint.label}</span>
                      <MethodBadge method={endpoint.method} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="rounded-xl border border-border bg-surface-deep">
            <div className="border-b border-border p-5">
              <div className="flex flex-wrap items-center gap-3">
                <MethodBadge method={active.method} />
                <code className="break-all font-mono text-sm text-primary">{active.path}</code>
              </div>
              <h3 className="mt-4 font-display text-2xl font-bold">{active.label}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">{active.summary}</p>
            </div>
            <div className="grid gap-0 lg:grid-cols-2">
              <InfoPanel title="When To Use" icon={BadgeCheck} text={active.useWhen} />
              <InfoPanel title="Auth" icon={KeyRound} text={active.auth} />
            </div>
            <CodeBlock
              id={`${active.id}-curl`}
              title="Request"
              code={active.sample}
              copied={copied === `${active.id}-curl`}
              onCopy={() => copy(active.sample, `${active.id}-curl`)}
            />
            <CodeBlock
              id={`${active.id}-response`}
              title="Response Shape"
              code={active.response}
              copied={copied === `${active.id}-response`}
              onCopy={() => copy(active.response, `${active.id}-response`)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 border-t border-border pt-9 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <h2 className="font-display text-2xl font-bold">Security Summary Signals</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Every signal has a stable `id`, a display `label`, an `answer`, confidence, source,
            and evidence codes. Treat `UNKNOWN` as missing or unavailable evidence, not safety.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {SIGNALS.map(([id, label]) => (
              <div key={id} className="rounded-lg border border-border bg-surface-deep px-3.5 py-3">
                <div className="font-semibold text-foreground">{label}</div>
                <code className="mt-1 block font-mono text-xs text-muted">{id}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface-deep p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Braces className="size-4 text-primary" aria-hidden />
            Integration Notes
          </div>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
            <li>Use `answer` for badges: `YES`, `NO`, or `UNKNOWN`.</li>
            <li>Use `severity` for color, not `answer` alone.</li>
            <li>Use `fullAnalysisUrl` for partner buttons.</li>
            <li>Do not convert missing evidence into a safe claim.</li>
            <li>Store `scanId` with your cached result for auditability.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function PartnerRule({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-deep p-4">
      <div className="font-bold text-foreground">{title}</div>
      <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

function RateFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/35 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-bold text-foreground">{value}</dd>
    </div>
  );
}

function GuideStep({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-deep p-4">
      <Icon className="size-5 text-primary" aria-hidden />
      <h3 className="mt-3 font-bold text-foreground">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

function MethodBadge({ method }: { method: Method }) {
  const tone =
    method === "GET"
      ? "border-info/30 bg-info/10 text-info"
      : method === "POST"
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-danger/30 bg-danger/10 text-danger";
  return (
    <span className={cn("rounded-md border px-2 py-1 font-mono text-[11px] font-bold", tone)}>
      {method}
    </span>
  );
}

function InfoPanel({
  title,
  text,
  icon: Icon,
}: {
  title: string;
  text: string;
  icon: LucideIcon;
}) {
  return (
    <div className="border-b border-border p-5 lg:border-r lg:last:border-r-0">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

function CodeBlock({
  id,
  title,
  code,
  copied,
  onCopy,
}: {
  id: string;
  title: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="border-t border-border p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
          <Code2 className="size-4 text-primary" aria-hidden />
          {title}
        </div>
        <Button size="sm" variant="secondary" onClick={onCopy} aria-label={`Copy ${title}`}>
          <Copy className="size-4" aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        id={id}
        className="max-h-[420px] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 text-secondary"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
