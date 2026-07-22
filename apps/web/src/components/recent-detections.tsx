"use client";
import Link from "next/link";
import { useRecentScans } from "@/hooks/use-recent-scans";
import { CHAINS } from "@/lib/chains";
import { riskFromScore } from "@/lib/risk";
import { shortAddress, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

export function RecentDetections() {
  const { data, isLoading } = useRecentScans();

  return (
    <section className="min-w-0 max-w-full rounded-2xl border border-border bg-surface-deep p-4 sm:p-6">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Recent security detections</h2>
        <Link href="/explore" className="text-sm font-bold text-primary hover:brightness-110">
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No public security detections yet."
          body="Scan a token to begin building the Sentinel network."
        />
      ) : (
        <ul className="flex flex-col">
          {data.map((d) => {
            const risk = riskFromScore(d.riskScore);
            const chain = CHAINS[d.chainId];
            return (
              <li key={`${d.chainId}-${d.address}`}>
                <Link
                  href={`/token/${d.chainId}/${d.address}`}
                  className="flex items-center gap-3.5 border-b border-border/40 py-3 transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span
                    className="w-[72px] shrink-0 rounded-md py-1 text-center text-[10px] font-extrabold uppercase"
                    style={{ color: risk.hex, background: hexToRgba(risk.hex, 0.12), border: `1px solid ${hexToRgba(risk.hex, 0.3)}` }}
                  >
                    {risk.label.replace(" Risk", "")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{d.name}</span>
                  <span className="hidden font-mono text-[13px] text-muted sm:inline">{shortAddress(d.address)}</span>
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: chain.color }} aria-label={chain.label} />
                  <span className="w-14 shrink-0 text-right text-[13px] text-faint">{timeAgo(d.scannedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3.5 text-[13px] text-faint">Real-time detections from tokens scanned across all supported chains.</p>
    </section>
  );
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
