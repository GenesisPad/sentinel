import { Check, Circle, ShieldAlert, X } from "lucide-react";
import type { ScanReport } from "@/lib/types";
import { bpsToPct, formatUsd } from "@/lib/utils";

type Tone = "good" | "bad" | "warn" | "info";

interface Answer {
  question: string;
  value: string;
  tone: Tone;
  detail?: string;
}

const TONE_STYLE: Record<Tone, { hex: string; Icon: typeof Check }> = {
  good: { hex: "#37d67a", Icon: Check },
  bad: { hex: "#f0483e", Icon: X },
  warn: { hex: "#f5a623", Icon: ShieldAlert },
  info: { hex: "#c4cabf", Icon: Circle },
};

/** The investor decision strip only renders answers backed by real backend values. */
export function QuickAnswers({ report }: { report: ScanReport }) {
  const answers = buildAnswers(report);

  if (answers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-deep px-4 py-3 text-sm text-muted">
        No investor summary fields were proven for this scan yet. The raw findings below still show the evidence that was collected.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {answers.map((a) => {
        const { hex, Icon } = TONE_STYLE[a.tone];
        return (
          <div key={a.question} className="rounded-xl border border-border bg-surface-deep px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{a.question}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-bold" style={{ color: hex }}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{a.value}</span>
            </div>
            {a.detail ? <div className="mt-0.5 text-[11px] text-faint">{a.detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function buildAnswers(report: ScanReport): Answer[] {
  const { simulation, liquidity, controls, token, holders } = report;

  return compact([
    boolAnswer("Can I buy?", simulation.canBuy),
    boolAnswer("Can I sell?", simulation.canSell),
    honeypotAnswer(simulation.isHoneypot),
    simulation.buyTaxBps != null || simulation.sellTaxBps != null
      ? {
          question: "Buy / sell tax",
          value: `${bpsToPct(simulation.buyTaxBps)} / ${bpsToPct(simulation.sellTaxBps)}`,
          tone: taxTone(simulation.sellTaxBps),
        }
      : null,
    liquidity.totalUsd != null
      ? {
          question: "Liquidity",
          value: formatUsd(liquidity.totalUsd),
          tone: healthTierTone(liquidity.healthTier),
          detail: liquidity.healthTier
            ? `${HEALTH_TIER_LABEL[liquidity.healthTier]}${
                liquidity.quoteSidePctOfMarketCap != null
                  ? ` (${liquidity.quoteSidePctOfMarketCap.toFixed(1)}% of mcap)`
                  : ""
              }`
            : undefined,
        }
      : null,
    lpLockedAnswer(liquidity.locked, liquidity.burnedPct),
    ownerAnswer(controls.ownershipRenounced),
    holders.top10Pct != null
      ? { question: "Top 10 holders", value: `${holders.top10Pct.toFixed(1)}%`, tone: concentrationTone(holders.top10Pct) }
      : null,
    token.marketCapUsd
      ? { question: "Market cap", value: formatUsd(Number(token.marketCapUsd)), tone: "info" }
      : null,
    token.volume24hUsd
      ? { question: "24h volume", value: formatUsd(Number(token.volume24hUsd)), tone: "info" }
      : null,
    token.createdAt ? { question: "Token age", value: timeAgoLabel(token.createdAt), tone: "info" } : null,
  ]);
}

function boolAnswer(question: string, value: boolean | null): Answer | null {
  if (value == null) return null;
  return value ? { question, value: "Yes", tone: "good" } : { question, value: "No", tone: "bad" };
}

function honeypotAnswer(isHoneypot: boolean | null): Answer | null {
  if (isHoneypot == null) return null;
  return isHoneypot
    ? { question: "Honeypot?", value: "Detected", tone: "bad" }
    : { question: "Honeypot?", value: "Not detected", tone: "good" };
}

function lpLockedAnswer(locked: boolean | null, burnedPct: number | undefined): Answer | null {
  const suffix = burnedPct != null ? ` (${burnedPct.toFixed(1)}%)` : "";
  if (locked == null) return null;
  return locked
    ? { question: "LP locked / burned", value: `Yes${suffix}`, tone: "good" }
    : { question: "LP locked / burned", value: `No${suffix}`, tone: "bad" };
}

function ownerAnswer(ownershipRenounced: boolean | null): Answer | null {
  if (ownershipRenounced == null) return null;
  return ownershipRenounced
    ? { question: "Owner", value: "Renounced", tone: "good" }
    : { question: "Owner", value: "Active", tone: "warn" };
}

const HEALTH_TIER_LABEL: Record<"low" | "medium" | "healthy", string> = {
  low: "Low",
  medium: "Medium",
  healthy: "Healthy",
};

function healthTierTone(tier: "low" | "medium" | "healthy" | null | undefined): Tone {
  if (tier === "healthy") return "good";
  if (tier === "medium") return "warn";
  if (tier === "low") return "bad";
  return "info";
}

function taxTone(sellTaxBps?: number): Tone {
  if (sellTaxBps == null) return "info";
  if (sellTaxBps >= 2000) return "bad";
  if (sellTaxBps >= 500) return "warn";
  return "good";
}

function concentrationTone(top10Pct: number | null): Tone {
  if (top10Pct == null) return "info";
  if (top10Pct >= 60) return "bad";
  if (top10Pct >= 35) return "warn";
  return "good";
}

function timeAgoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Recorded";
  const days = Math.floor(Math.max(0, Date.now() - then) / 86_400_000);
  if (days < 1) return "<1 day";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}
