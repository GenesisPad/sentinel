"use client";
import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ChainId } from "@/lib/chains";
import { CHAINS } from "@/lib/chains";
import type { DevClusterInfo, WalletClusterEdge, WalletClusterEdgeType } from "@/lib/types";
import { shortAddress } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";

const EDGE_STYLE: Record<WalletClusterEdgeType, { label: string; hex: string }> = {
  DEPLOYED_BY: { label: "Deployer", hex: "#b4f11f" },
  OWNED_BY: { label: "Current owner", hex: "#6ea8ff" },
  PREVIOUSLY_OWNED_BY: { label: "Previous owner", hex: "#a78bda" },
  FUNDED_BY: { label: "Funded by", hex: "#f5a623" },
  TRANSFERRED_SUPPLY_TO: { label: "Received supply", hex: "#f0483e" },
  SHARED_BYTECODE: { label: "Shared bytecode", hex: "#e893c8" },
};

const SIZE = 340;
const CENTER = SIZE / 2;
const RADIUS = 122;
const NODE_R = 16;
const CENTER_R = 26;

function explorerAddressUrl(chainId: ChainId, address: string): string {
  return `${CHAINS[chainId].explorerUrl}/address/${address}`;
}

/**
 * Radial "bubble map" of real, evidenced wallet-relationship edges (Milestone 6) — the token
 * at the center, one glowing satellite bubble per connected wallet, colored and labeled by the
 * specific on-chain evidence that connects it (never a guess from timing coincidence). Node
 * count varies per scan, so positions are computed at render time rather than fixed like the
 * stage graph. Each address links out to the chain's block explorer.
 */
export function WalletClusterGraph({
  chainId,
  tokenSymbol,
  tokenAddress,
  edges,
  devCluster,
}: {
  chainId: ChainId;
  tokenSymbol?: string | null;
  tokenAddress: string;
  edges: WalletClusterEdge[];
  devCluster?: DevClusterInfo;
}) {
  const gradientId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  if (edges.length === 0) {
    return (
      <EmptyState
        title="No connected wallets found"
        body="No on-chain evidence links another wallet to this token's deployer or owner."
      />
    );
  }

  const nodes = edges.map((edge, i) => {
    const angle = (2 * Math.PI * i) / edges.length - Math.PI / 2;
    return {
      edge,
      x: CENTER + RADIUS * Math.cos(angle),
      y: CENTER + RADIUS * Math.sin(angle),
    };
  });
  const usedTypes = [...new Set(edges.map((e) => e.type))];
  const active = hovered != null ? nodes[hovered] : null;

  return (
    <div className="flex flex-col gap-4">
      {devCluster && devCluster.walletCount > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Dev cluster</div>
            <div className="mt-1 text-lg font-extrabold text-foreground">
              {devCluster.knownHoldingPct != null ? `${devCluster.knownHoldingPct.toFixed(2)}%` : "Unknown"}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Linked wallets</div>
            <div className="mt-1 text-lg font-extrabold text-foreground">{devCluster.walletCount}</div>
          </div>
          <div className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Unknown holdings</div>
            <div className="mt-1 text-lg font-extrabold text-foreground">{devCluster.unknownHoldingWalletCount}</div>
          </div>
        </div>
      ) : null}
      <div className="relative mx-auto w-full max-w-[440px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto h-auto w-full"
          role="img"
          aria-label="Wallet clustering graph"
        >
          <defs>
            <radialGradient id={`${gradientId}-center`} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#1c2a0d" />
              <stop offset="100%" stopColor="#0a1104" />
            </radialGradient>
            {nodes.map(({ edge }, i) => (
              <radialGradient key={`grad-${i}`} id={`${gradientId}-node-${i}`} cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor={EDGE_STYLE[edge.type].hex} stopOpacity={0.35} />
                <stop offset="100%" stopColor={EDGE_STYLE[edge.type].hex} stopOpacity={0.05} />
              </radialGradient>
            ))}
            <filter id={`${gradientId}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {nodes.map(({ edge, x, y }, i) => {
            const isActive = hovered === i;
            return (
              <line
                key={`line-${edge.address}-${edge.type}`}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke={EDGE_STYLE[edge.type].hex}
                strokeOpacity={isActive ? 0.9 : 0.32}
                strokeWidth={isActive ? 2 : 1.25}
                strokeDasharray={edge.type === "PREVIOUSLY_OWNED_BY" ? "3 4" : undefined}
                className="transition-[stroke-opacity,stroke-width] duration-300 ease-out"
              />
            );
          })}

          {/* Center: the scanned token itself */}
          <circle cx={CENTER} cy={CENTER} r={CENTER_R + 10} fill={`url(#${gradientId}-center)`} />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={CENTER_R}
            fill="#0e1a06"
            stroke="#b4f11f"
            strokeWidth={2}
            className={reducedMotion ? undefined : "animate-[gs-pulse-ring_3s_ease-out_infinite]"}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
          <circle cx={CENTER} cy={CENTER} r={CENTER_R} fill="none" stroke="#b4f11f" strokeWidth={2} filter={`url(#${gradientId}-glow)`} opacity={0.5} />
          <text
            x={CENTER}
            y={CENTER + 4}
            textAnchor="middle"
            className="font-display select-none"
            fontSize={11}
            fontWeight={700}
            fill="#f4f6f4"
          >
            {(tokenSymbol ?? shortAddress(tokenAddress)).slice(0, 8)}
          </text>

          {nodes.map(({ edge, x, y }, i) => {
            const isActive = hovered === i;
            const hex = EDGE_STYLE[edge.type].hex;
            return (
              <a
                key={`node-${edge.address}-${edge.type}`}
                href={explorerAddressUrl(chainId, edge.address)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${EDGE_STYLE[edge.type].label}: ${shortAddress(edge.address)}. Open on block explorer.`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
                className="cursor-pointer outline-none"
              >
                <title>{`${EDGE_STYLE[edge.type].label}: ${edge.evidence}`}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={NODE_R + 8}
                  fill={`url(#${gradientId}-node-${i})`}
                  className="transition-opacity duration-300"
                  opacity={isActive ? 1 : 0.7}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? NODE_R + 2.5 : NODE_R}
                  fill="#12160f"
                  stroke={hex}
                  strokeWidth={isActive ? 2.5 : 2}
                  filter={isActive ? `url(#${gradientId}-glow)` : undefined}
                  className="transition-[r,stroke-width] duration-200 ease-out"
                  style={{ transformOrigin: `${x}px ${y}px` }}
                />
                <text
                  x={x}
                  y={y + (y > CENTER ? NODE_R + 16 : -NODE_R - 10)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={isActive ? "#f4f6f4" : "#c7cdc4"}
                  className="select-none font-mono transition-colors duration-200"
                >
                  {shortAddress(edge.address)}
                </text>
                {edge.holdingPct != null ? (
                  <text
                    x={x}
                    y={y + (y > CENTER ? NODE_R + 29 : -NODE_R - 22)}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={hex}
                    className="select-none transition-colors duration-200"
                  >
                    {edge.holdingPct.toFixed(1)}%
                  </text>
                ) : null}
              </a>
            );
          })}
        </svg>

        {/* Floating detail card for the hovered node, replacing the terse native title tooltip */}
        <div
          className="pointer-events-none absolute inset-x-2 bottom-1 rounded-lg border border-border-strong bg-surface-deep/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm transition-all duration-200 ease-out"
          style={{
            opacity: active ? 1 : 0,
            transform: active ? "translateY(0)" : "translateY(4px)",
          }}
          aria-hidden={!active}
        >
          {active ? (
            <>
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold" style={{ color: EDGE_STYLE[active.edge.type].hex }}>
                  {EDGE_STYLE[active.edge.type].label}
                </span>
                {active.edge.holdingPct != null ? (
                  <span className="font-mono font-bold text-foreground">
                    {active.edge.holdingPct.toFixed(2)}% of supply
                  </span>
                ) : null}
              </span>
              <p className="mt-0.5 leading-snug text-secondary">{active.edge.evidence}</p>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
        {usedTypes.map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: EDGE_STYLE[type].hex }} aria-hidden />
            {EDGE_STYLE[type].label}
          </span>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {edges.map((edge, i) => (
          <li
            key={`${edge.type}-${edge.address}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5 text-sm transition-colors hover:border-border-strong"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: EDGE_STYLE[edge.type].hex }}>
                <span className="size-2 rounded-full" style={{ backgroundColor: EDGE_STYLE[edge.type].hex }} aria-hidden />
                {EDGE_STYLE[edge.type].label}
                {edge.holdingPct != null ? (
                  <span className="font-mono text-xs font-bold text-foreground">
                    {edge.holdingPct.toFixed(2)}%
                  </span>
                ) : null}
              </span>
              <a
                href={explorerAddressUrl(chainId, edge.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors hover:text-primary"
              >
                {shortAddress(edge.address)}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-muted">{edge.evidence}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
