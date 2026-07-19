import { Check, HelpCircle, X } from "lucide-react";
import type { TradeSimulation } from "@/lib/types";
import { bpsToPct } from "@/lib/utils";

const STATUS = {
  passed: { hex: "#37d67a", Icon: Check },
  failed: { hex: "#f0483e", Icon: X },
  inconclusive: { hex: "#f5a623", Icon: HelpCircle },
} as const;

export function TradingSimulation({ sim }: { sim: TradeSimulation }) {
  const stats = [
    sim.buyTaxBps != null ? { label: "Buy Tax", value: bpsToPct(sim.buyTaxBps), hex: "#f4f6f4" } : null,
    sim.sellTaxBps != null ? { label: "Sell Tax", value: bpsToPct(sim.sellTaxBps), hex: "#f5a623" } : null,
    sim.transferTaxBps != null ? { label: "Transfer Tax", value: bpsToPct(sim.transferTaxBps), hex: "#f4f6f4" } : null,
    sim.maxSellTaxBps != null ? { label: "Max Sell Tax", value: bpsToPct(sim.maxSellTaxBps), hex: "#f0483e" } : null,
    sim.maxWalletBps != null ? { label: "Max Wallet", value: bpsToPct(sim.maxWalletBps), hex: "#f4f6f4" } : null,
  ].filter((stat): stat is { label: string; value: string; hex: string } => stat !== null);
  const visibleResults = sim.results.filter((r) => r.status !== "inconclusive" || r.detail);

  // What investors actually need is a direct Honeypot Yes/No answer, not "Buy simulation:
  // Passed" — the pass/fail rows still carry useful supporting detail, so they stay, but the
  // honeypot verdict leads.
  const capabilityLabel: Record<(typeof visibleResults)[number]["label"], string> = {
    "Buy simulation": "Can buy",
    "Sell simulation": "Can sell",
    "Transfer simulation": "Can transfer",
  };

  return (
    <div className="flex flex-col gap-4">
      {sim.isHoneypot != null ? (
        <div
          className="rounded-lg px-3.5 py-2.5 text-sm font-bold"
          style={
            sim.isHoneypot
              ? { color: "#f0483e", background: "rgba(240,72,62,0.1)", border: "1px solid rgba(240,72,62,0.35)" }
              : { color: "#37d67a", background: "rgba(55,214,122,0.1)", border: "1px solid rgba(55,214,122,0.3)" }
          }
        >
          {sim.isHoneypot ? "Honeypot: Yes" : "Honeypot: No"}
        </div>
      ) : null}

      {visibleResults.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visibleResults.map((r) => {
            const s = STATUS[r.status];
            const label = capabilityLabel[r.label] ?? r.label;
            const verdict = r.status === "passed" ? "Yes" : r.status === "failed" ? "No" : "Unclear";
            return (
              <div
                key={r.label}
                className="flex items-center justify-between rounded-lg border border-border bg-surface-deep px-3.5 py-2.5"
              >
                <span className="text-sm font-semibold text-secondary">{label}</span>
                <span className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: s.hex }}>
                  <s.Icon className="size-4" aria-hidden />
                  {verdict}
                  {r.detail ? <span className="font-medium text-muted">· {r.detail}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface-deep px-2 py-2.5 text-center">
              <div className="text-[11px] text-muted">{s.label}</div>
              <div className="font-display text-lg font-bold" style={{ color: s.hex }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sim.isHoneypot == null && visibleResults.length === 0 && stats.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-deep px-4 py-3 text-sm text-muted">
          Live trade simulation has not returned a measurable result for this scan.
        </div>
      ) : null}
    </div>
  );
}
