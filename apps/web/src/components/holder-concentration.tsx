import type { HolderInfo } from "@/lib/types";

export function HolderConcentration({ holders }: { holders: HolderInfo }) {
  const rows = [
    { label: "Top 1 holder", pct: holders.top1Pct, grad: "linear-gradient(90deg,#8a5a2b,#c07a2e)" },
    { label: "Top 5 holders", pct: holders.top5Pct, grad: "linear-gradient(90deg,#c07a2e,#f5a623)" },
    { label: "Top 10 holders", pct: holders.top10Pct, grad: "linear-gradient(90deg,#f5a623,#f0483e)" },
  ].filter((row): row is { label: string; pct: number; grad: string } => row.pct != null);
  return (
    <div className="flex flex-col gap-3.5">
      {holders.holderCount !== undefined ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-deep px-3.5 py-2.5 text-sm">
          <span className="font-semibold text-secondary">Known holders</span>
          <span className="font-bold text-foreground">{holders.holderCount.toLocaleString()}</span>
        </div>
      ) : null}
      {holders.devClusterWalletCount !== undefined && holders.devClusterWalletCount > 0 ? (
        <div className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-secondary">Dev cluster</span>
            <span className="font-bold text-foreground">
              {holders.devClusterPct != null ? `${holders.devClusterPct.toFixed(2)}%` : "Unknown"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {holders.devClusterWalletCount} linked wallet{holders.devClusterWalletCount === 1 ? "" : "s"}
            {holders.devClusterUnknownHoldingWalletCount
              ? `; ${holders.devClusterUnknownHoldingWalletCount} outside the tracked holder snapshot`
              : ""}
          </p>
        </div>
      ) : null}
      {rows.length > 0 ? rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-secondary">{r.label}</span>
            <span className="font-bold text-foreground">{r.pct}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-md bg-border"
            role="meter"
            aria-valuenow={r.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={r.label}
          >
            <div className="h-full rounded-md" style={{ width: `${Math.min(100, r.pct)}%`, background: r.grad }} />
          </div>
        </div>
      )) : (
        <div className="rounded-xl border border-border bg-surface-deep px-4 py-3 text-sm text-muted">
          Holder concentration was not returned by the configured chain sources for this scan.
        </div>
      )}
      {holders.clusteredWithDeployer ? (
        <p className="text-xs text-warn">
          {holders.clusteredWithDeployer} of the top holders are clustered with the deployer.
        </p>
      ) : null}
    </div>
  );
}
