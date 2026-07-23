"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from "recharts";
import { Activity, ArrowUpRight, CircleHelp, Radar, ShieldAlert, Users } from "lucide-react";
import { formatCompactUsd, type AnalyticsBreakdownItem, type PublicAnalyticsView } from "@genesis-sentinel/shared";
import { getPublicAnalytics } from "@/lib/api";
import { shortAddress } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORY_COLORS = ["#f0483e", "#ff8a3d", "#f5a623", "#6ea8ff", "#a78bda"];
const COVERAGE_COLORS = ["#b4f11f", "#6ea8ff", "#37d67a", "#f5a623", "#a78bda"];

const DEFINITIONS: Record<string, string> = {
  tokens: "Distinct token addresses with at least one completed or partially completed scan.",
  scans: "Every completed or partially completed scan, including repeat scans of the same token.",
  users:
    "Distinct website visitors measured with a one-way HMAC identifier. Raw IP addresses are never stored.",
  risk: "Distinct tokens whose latest report is rated High or Critical.",
  liquidity: "Sum of the latest USD liquidity values recorded across discovered pools.",
  honeypots:
    "Distinct tokens whose latest executed simulation returned isHoneypot=true. Route quotes alone do not count.",
  taxes: "Distinct tokens whose latest measured buy, sell, or transfer tax exceeds 5%.",
  dangerousLiquidity:
    "Tokens with less than $1,000 recorded liquidity or less than 80% LP burned or locked.",
  concentration:
    "Tokens whose latest holder snapshot places at least 35% of supply in the top ten non-pool holders.",
  controls:
    "Tokens with findings for minting, blacklist, pause, tax, trading, proxy, upgrade, or whitelist controls.",
  coverage: "Number of analyzed tokens for which each evidence source returned usable data."
};

export function AnalyticsDashboard() {
  const query = useQuery({
    queryKey: ["public-analytics"],
    queryFn: getPublicAnalytics,
    staleTime: 60_000
  });

  if (query.isLoading) return <AnalyticsSkeleton />;
  if (!query.data) {
    return (
      <main className="mx-auto max-w-[1360px] px-5 py-16 sm:px-7">
        <p className="font-display text-2xl font-semibold">
          Analytics are temporarily unavailable.
        </p>
        <p className="mt-2 text-muted">
          Scan data is unaffected. Please try this page again shortly.
        </p>
      </main>
    );
  }

  return <Dashboard data={query.data} />;
}

function Dashboard({ data }: { data: PublicAnalyticsView }) {
  const total = Math.max(1, data.totals.tokensAnalyzed);
  return (
    <main className="mx-auto max-w-[1360px] px-5 pb-24 pt-10 sm:px-7 sm:pt-14">
      <header className="flex flex-col gap-5 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary">
            <Activity className="size-3.5" aria-hidden /> Live network pulse
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            What Sentinel is seeing
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Aggregate evidence from Robinhood Chain token scans. Every number comes from persisted
            reports, not estimated outcomes.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-faint">
          <span className="size-2 rounded-full bg-pass motion-safe:animate-pulse" aria-hidden />
          Updated {new Date(data.generatedAt).toLocaleString()}
        </div>
      </header>

      <section
        className="grid border-b border-border sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Primary metrics"
      >
        <PrimaryMetric
          label="Tokens analyzed"
          value={formatNumber(data.totals.tokensAnalyzed)}
          detail={`${formatNumber(data.totals.uniqueContracts)} unique contracts`}
          help={DEFINITIONS.tokens}
          icon={Radar}
        />
        <PrimaryMetric
          label="Scans completed"
          value={formatNumber(data.totals.scansCompleted)}
          help={DEFINITIONS.scans}
          icon={Activity}
        />
        <PrimaryMetric
          label="High-risk tokens"
          value={formatNumber(data.totals.highRiskTokens)}
          help={DEFINITIONS.risk}
          icon={ShieldAlert}
          danger
        />
        <PrimaryMetric
          label="Unique users"
          value={formatNumber(data.totals.uniqueUsers)}
          detail={`${formatNumber(data.totals.totalVisits)} visits`}
          help={DEFINITIONS.users}
          icon={Users}
        />
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Scan activity">
        <PeriodMetric label="Last 24 hours" value={data.activity.last24Hours} />
        <PeriodMetric
          label="Last 7 days"
          value={data.activity.last7Days}
          growth={data.activity.sevenDayGrowthPct}
        />
        <PeriodMetric
          label="Last 30 days"
          value={data.activity.last30Days}
          growth={data.activity.thirtyDayGrowthPct}
        />
        <PeriodMetric label="Daily average" value={data.activity.averagePerDay} suffix=" scans" />
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,.4),0_8px_24px_-8px_rgba(0,0,0,.5)] sm:p-6">
        <SectionHeading
          title="Scan velocity"
          subtitle="Completed scans per day, trailing 30 days"
        />
        <div className="mt-5 h-[290px] w-full sm:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.activity.daily}
              margin={{ top: 8, right: 8, left: -24, bottom: 0 }}
            >
              <defs>
                <linearGradient id="scan-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b4f11f" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#b4f11f" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c211c" strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                stroke="#7a827a"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                fontSize={11}
              />
              <YAxis
                allowDecimals={false}
                stroke="#7a827a"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <ChartTooltip content={<ScanTooltip />} cursor={{ stroke: "#2c3128" }} />
              <Area
                type="monotone"
                dataKey="scans"
                stroke="#b4f11f"
                strokeWidth={2.5}
                fill="url(#scan-fill)"
                activeDot={{ r: 5, fill: "#b4f11f", stroke: "#0c0e0c", strokeWidth: 3 }}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <ChartPanel
          title="Risk signals by category"
          subtitle={`${formatNumber(data.totals.riskSignals)} findings across latest token reports`}
          help="A token can contribute more than one finding."
        >
          <div className="grid items-center gap-5 sm:grid-cols-[220px_1fr]">
            <div className="relative h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.riskCategories}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={3}
                    stroke="none"
                    animationDuration={700}
                  >
                    {data.riskCategories.map((item, index) => (
                      <Cell key={item.key} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<BreakdownTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-bold">
                  {formatNumber(data.totals.riskSignals)}
                </span>
                <span className="text-[11px] text-faint">signals</span>
              </div>
            </div>
            <Legend items={data.riskCategories} colors={CATEGORY_COLORS} />
          </div>
        </ChartPanel>

        <ChartPanel
          title="Detection coverage"
          subtitle="Evidence returned by analysis layer"
          help={DEFINITIONS.coverage}
        >
          <div className="flex flex-col gap-4 py-2">
            {data.coverage.map((item, index) => {
              const pct = Math.round((item.count / total) * 100);
              return (
                <div key={item.key}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-semibold text-secondary">{item.label}</span>
                    <span className="font-mono text-xs text-muted">
                      {item.count} / {data.totals.tokensAnalyzed} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-deep">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        backgroundColor: COVERAGE_COLORS[index % COVERAGE_COLORS.length]
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ChartPanel>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <ChartPanel title="Most frequent risks" subtitle="Top detector findings in latest reports">
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.frequentRisks}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke="#1c211c" strokeDasharray="3 5" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  stroke="#7a827a"
                  fontSize={11}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  tickLine={false}
                  axisLine={false}
                  stroke="#c4cabf"
                  fontSize={11}
                  tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                />
                <ChartTooltip content={<BreakdownTooltip />} cursor={{ fill: "#0c0e0c" }} />
                <Bar dataKey="count" fill="#ff8a3d" radius={[0, 5, 5, 0]} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <SectionHeading title="Risk watch" subtitle="Evidence-backed indicators" />
          <div className="mt-5 divide-y divide-border">
            <RiskRow label="Honeypots" value={data.totals.honeypots} help={DEFINITIONS.honeypots} />
            <RiskRow
              label="Tax above 5%"
              value={data.totals.highTaxTokens}
              help={DEFINITIONS.taxes}
            />
            <RiskRow
              label="Dangerous liquidity"
              value={data.totals.dangerousLiquidityTokens}
              help={DEFINITIONS.dangerousLiquidity}
            />
            <RiskRow
              label="Concentrated holders"
              value={data.totals.concentratedHolderTokens}
              help={DEFINITIONS.concentration}
            />
            <RiskRow
              label="Privileged controls"
              value={data.totals.privilegedControlTokens}
              help={DEFINITIONS.controls}
            />
          </div>
          <div className="mt-6 rounded-xl border border-border bg-surface-deep p-4">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
              Analyzed liquidity
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-foreground">
              {formatUsd(data.totals.analyzedLiquidityUsd)}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-faint">{DEFINITIONS.liquidity}</p>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <SectionHeading title="Trending tokens" subtitle="Most scanned during the last 30 days" />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[10px] font-extrabold uppercase tracking-[0.1em] text-faint">
                <th className="pb-3">Token</th>
                <th className="pb-3">Contract</th>
                <th className="pb-3 text-right">Scans</th>
                <th className="pb-3 text-right">Last analyzed</th>
              </tr>
            </thead>
            <tbody>
              {data.trendingTokens.map((token) => (
                <tr
                  key={`${token.chainId}:${token.address}`}
                  className="group border-b border-border/70 last:border-0"
                >
                  <td className="py-4">
                    <Link
                      href={`/token/robinhood/${token.address}`}
                      className="inline-flex items-center gap-1.5 font-bold text-foreground transition-colors hover:text-primary"
                    >
                      {token.symbol || token.name || "Unknown token"}
                      <ArrowUpRight
                        className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </Link>
                    {token.name && token.symbol ? (
                      <div className="mt-0.5 text-xs text-faint">{token.name}</div>
                    ) : null}
                  </td>
                  <td className="py-4 font-mono text-xs text-muted">
                    {shortAddress(token.address)}
                  </td>
                  <td className="py-4 text-right font-mono font-bold">{token.scans}</td>
                  <td className="py-4 text-right text-xs text-muted">
                    {new Date(token.lastScannedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-faint">
        Metrics reflect persisted Genesis Sentinel data and may change when tokens are rescanned.
        Counts describe detected evidence, not guarantees of safety or malicious intent.
      </p>
    </main>
  );
}

function PrimaryMetric({
  label,
  value,
  detail,
  help,
  icon: Icon,
  danger = false
}: {
  label: string;
  value: string;
  detail?: string;
  help: string;
  icon: typeof Activity;
  danger?: boolean;
}) {
  return (
    <div className="group relative px-0 py-6 transition-colors sm:px-5 lg:border-r lg:border-border lg:first:pl-0 lg:last:border-0">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">
        <Icon className="size-4" style={{ color: danger ? "#f0483e" : "#b4f11f" }} aria-hidden />
        {label}
        <Help text={help} />
      </div>
      <div
        className="mt-2 font-mono text-3xl font-bold tracking-tight transition-transform duration-200 group-hover:-translate-y-0.5"
        style={{ color: danger ? "#f0483e" : "#f4f6f4" }}
      >
        {value}
      </div>
      {detail ? <div className="mt-1 text-xs text-faint">{detail}</div> : null}
    </div>
  );
}

function PeriodMetric({
  label,
  value,
  growth,
  suffix = ""
}: {
  label: string;
  value: number;
  growth?: number | null;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-deep px-4 py-3.5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-mono text-xl font-bold">
          {formatNumber(value)}
          {suffix}
        </span>
        {growth != null ? (
          <span
            className={
              growth >= 0 ? "text-xs font-bold text-pass" : "text-xs font-bold text-danger"
            }
          >
            {growth >= 0 ? "+" : ""}
            {growth}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  help,
  children
}: {
  title: string;
  subtitle: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,.4),0_8px_24px_-8px_rgba(0,0,0,.5)] sm:p-6">
      <SectionHeading title={title} subtitle={subtitle} help={help} />
      {children}
    </div>
  );
}
function SectionHeading({
  title,
  subtitle,
  help
}: {
  title: string;
  subtitle: string;
  help?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {help ? <Help text={help} /> : null}
      </div>
      <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
    </div>
  );
}
function Help({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label="Metric definition"
        className="text-faint transition-colors hover:text-foreground"
      >
        <CircleHelp className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}
function RiskRow({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary">
        {label}
        <Help text={help} />
      </span>
      <span className="font-mono text-lg font-bold text-danger">{formatNumber(value)}</span>
    </div>
  );
}
function Legend({ items, colors }: { items: AnalyticsBreakdownItem[]; colors: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, index) => (
        <div key={item.key} className="flex items-center justify-between gap-4 text-sm">
          <span className="inline-flex items-center gap-2 text-secondary">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            {item.label}
          </span>
          <span className="font-mono font-bold">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function ScanTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border-strong bg-surface-deep px-3 py-2 shadow-xl">
      <div className="text-xs text-faint">
        {label
          ? new Date(`${label}T00:00:00`).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric"
            })
          : ""}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold text-primary">
        {payload[0]?.value ?? 0} scans
      </div>
    </div>
  );
}
function BreakdownTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { label?: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="max-w-[240px] rounded-lg border border-border-strong bg-surface-deep px-3 py-2 shadow-xl">
      <div className="text-xs text-secondary">{item?.payload?.label ?? item?.name}</div>
      <div className="mt-0.5 font-mono text-sm font-bold text-foreground">
        {formatNumber(item?.value ?? 0)}
      </div>
    </div>
  );
}
function AnalyticsSkeleton() {
  return (
    <main className="mx-auto max-w-[1360px] px-5 py-14 sm:px-7">
      <Skeleton className="h-12 w-80 max-w-full" />
      <Skeleton className="mt-4 h-5 w-[520px] max-w-full" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-8 h-[360px]" />
    </main>
  );
}
function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}
function formatUsd(value: number) {
  return formatCompactUsd(value) ?? "—";
}
function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}
