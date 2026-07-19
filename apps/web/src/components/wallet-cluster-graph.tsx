import type { WalletClusterEdge, WalletClusterEdgeType } from "@/lib/types";
import { shortAddress } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

const EDGE_STYLE: Record<WalletClusterEdgeType, { label: string; hex: string }> = {
  DEPLOYED_BY: { label: "Deployer", hex: "#b4f11f" },
  OWNED_BY: { label: "Current owner", hex: "#6ea8ff" },
  PREVIOUSLY_OWNED_BY: { label: "Previous owner", hex: "#a78bda" },
  FUNDED_BY: { label: "Funded by", hex: "#f5a623" },
  TRANSFERRED_SUPPLY_TO: { label: "Received supply", hex: "#f0483e" },
  SHARED_BYTECODE: { label: "Shared bytecode", hex: "#e893c8" },
};

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 118;
const NODE_R = 15;
const CENTER_R = 24;

/**
 * Radial "bubble map" of real, evidenced wallet-relationship edges (Milestone 6) — the token
 * at the center, one satellite bubble per connected wallet, colored and labeled by the specific
 * on-chain evidence that connects it (never a guess from timing coincidence). Node count varies
 * per scan, so positions are computed at render time rather than fixed like the stage graph.
 */
export function WalletClusterGraph({
  tokenSymbol,
  tokenAddress,
  edges,
}: {
  tokenSymbol?: string | null;
  tokenAddress: string;
  edges: WalletClusterEdge[];
}) {
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

  return (
    <div className="flex flex-col gap-4">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto h-auto w-full max-w-[420px]"
        role="img"
        aria-label="Wallet clustering graph"
      >
        {nodes.map(({ edge, x, y }) => (
          <line
            key={`line-${edge.address}-${edge.type}`}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke={EDGE_STYLE[edge.type].hex}
            strokeOpacity={0.45}
            strokeWidth={1.5}
          />
        ))}

        <circle cx={CENTER} cy={CENTER} r={CENTER_R} fill="#0e1a06" stroke="#b4f11f" strokeWidth={2} />
        <text
          x={CENTER}
          y={CENTER + 4}
          textAnchor="middle"
          className="font-display"
          fontSize={11}
          fontWeight={700}
          fill="#f4f6f4"
        >
          {(tokenSymbol ?? shortAddress(tokenAddress)).slice(0, 8)}
        </text>

        {nodes.map(({ edge, x, y }) => (
          <g key={`node-${edge.address}-${edge.type}`}>
            <title>{`${EDGE_STYLE[edge.type].label}: ${edge.evidence}`}</title>
            <circle
              cx={x}
              cy={y}
              r={NODE_R}
              fill="#12160f"
              stroke={EDGE_STYLE[edge.type].hex}
              strokeWidth={2}
            />
            <text
              x={x}
              y={y + (y > CENTER ? NODE_R + 14 : -NODE_R - 8)}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill="#c7cdc4"
              className="font-mono"
            >
              {shortAddress(edge.address)}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
        {usedTypes.map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: EDGE_STYLE[type].hex }} aria-hidden />
            {EDGE_STYLE[type].label}
          </span>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {edges.map((edge) => (
          <li
            key={`${edge.type}-${edge.address}`}
            className="rounded-lg border border-border bg-surface-deep px-3.5 py-2.5 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: EDGE_STYLE[edge.type].hex }}>
                <span className="size-2 rounded-full" style={{ backgroundColor: EDGE_STYLE[edge.type].hex }} aria-hidden />
                {EDGE_STYLE[edge.type].label}
              </span>
              <span className="font-mono text-xs text-muted">{shortAddress(edge.address)}</span>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-muted">{edge.evidence}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
