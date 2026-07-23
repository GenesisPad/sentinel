import { ExternalLink, Info } from "lucide-react";
import { buildMarketChartUrl } from "@genesis-sentinel/shared";
import type { LiquidityInfo } from "@/lib/types";
import { formatUsd, shortAddress } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HEALTH_TIER_STYLE = {
  low: { label: "Low", hex: "#f0483e" },
  medium: { label: "Medium", hex: "#f5a623" },
  healthy: { label: "Healthy", hex: "#37d67a" }
} as const;

export function LiquidityCard({ liquidity, technical }: { liquidity: LiquidityInfo; technical?: boolean }) {
  if (liquidity.locked == null && liquidity.totalUsd == null) {
    return (
      <EmptyState
        title="No liquidity pool discovered"
        body="Trading simulation may be unavailable for this token."
      />
    );
  }

  // Only render segments we have real data for — a 0% fallback for deployer-controlled/lock
  // percentages the backend hasn't measured yet would read as a measured fact, not a guess.
  const seg = [
    liquidity.lockedPct != null ? { label: "Locked", pct: liquidity.lockedPct, hex: "#37d67a" } : null,
    liquidity.burnedPct != null ? { label: "Burned", pct: liquidity.burnedPct, hex: "#f5a623" } : null,
  ].filter((s): s is { label: string; pct: number; hex: string } => s !== null);

  return (
    <div className="flex flex-col gap-2.5">
      {seg.length > 0 ? (
        <>
          {seg.map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm text-secondary">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: s.hex }} aria-hidden />
                {s.label}
              </span>
              <span className="text-sm font-bold text-foreground">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
          <div className="mt-1 flex h-2.5 overflow-hidden rounded-md bg-border" aria-hidden>
            {seg.map((s) => (
              <div key={s.label} style={{ width: `${s.pct}%`, backgroundColor: s.hex }} />
            ))}
          </div>
        </>
      ) : null}
      {liquidity.totalUsd != null ? (
        <div className="mt-2 flex justify-between text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            Total liquidity
            <Tooltip>
              <TooltipTrigger
                type="button"
                className="text-faint transition-colors hover:text-foreground focus-visible:outline-none"
                aria-label="How liquidity is measured"
              >
                <Info className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold text-foreground">
                  ETH side: {formatUsd(liquidity.totalUsd / 2)}
                </p>
                <p className="mt-1 leading-relaxed text-muted">
                  Total liquidity is the full pool value (token + paired asset). The paired-asset
                  (ETH/quote) side alone is what actually backs sell orders — liquidity health is
                  measured against that half, not the combined total.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="text-foreground">{formatUsd(liquidity.totalUsd)}</span>
        </div>
      ) : null}
      {liquidity.healthTier ? (
        <div className="flex justify-between text-sm text-muted">
          <span>Liquidity health</span>
          <span className="font-bold" style={{ color: HEALTH_TIER_STYLE[liquidity.healthTier].hex }}>
            {HEALTH_TIER_STYLE[liquidity.healthTier].label}
            {liquidity.quoteSidePctOfMarketCap != null
              ? ` (${liquidity.quoteSidePctOfMarketCap.toFixed(1)}% of market cap)`
              : ""}
          </span>
        </div>
      ) : null}
      {liquidity.locked != null ? (
        <div className="flex justify-between text-sm text-muted">
          <span>Locked / burned</span>
          <span className="font-bold" style={{ color: liquidity.locked ? "#37d67a" : "#f0483e" }}>
            {liquidity.locked ? "Yes" : "No"}
          </span>
        </div>
      ) : null}
      {liquidity.lpOwner ? (
        <div className="flex justify-between text-sm text-muted">
          <span>LP owner</span>
          <span className="font-mono text-secondary">{shortAddress(liquidity.lpOwner)}</span>
        </div>
      ) : null}
      {technical && liquidity.dex ? (
        <div className="flex justify-between text-sm text-muted">
          <span>DEX</span>
          <span className="text-secondary">{liquidity.dex}</span>
        </div>
      ) : null}
      {technical && liquidity.poolAddress ? (
        <div className="flex justify-between text-sm text-muted">
          <span>Pool address</span>
          <span className="font-mono text-secondary">{shortAddress(liquidity.poolAddress)}</span>
        </div>
      ) : null}
      {liquidity.poolAddress ? (
        <a
          href={buildMarketChartUrl(liquidity.poolAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface-deep px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-surface"
        >
          📈 View Chart
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
