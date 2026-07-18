import { riskFromScore, type RiskLevel } from "@/lib/risk";
import { cn } from "@/lib/utils";

/**
 * Reusable risk badge. Always renders an explicit label
 * ("Critical Risk" / "High Risk" / "Moderate Risk" / "Low Risk" / "Unable to Assess").
 */
export function RiskBadge({
  score,
  size = "md",
  className,
}: {
  score: number | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const risk = riskFromScore(score);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-lg font-extrabold uppercase tracking-wide",
        size === "sm" && "px-2.5 py-1 text-xs",
        size === "md" && "px-3 py-1.5 text-xs",
        size === "lg" && "px-4 py-2 text-sm",
        className,
      )}
      style={{
        color: risk.hex,
        backgroundColor: hexToRgba(risk.hex, 0.14),
        border: `1px solid ${hexToRgba(risk.hex, 0.4)}`,
      }}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: risk.hex }} />
      {risk.label}
    </span>
  );
}

export function riskLevelLabel(level: RiskLevel): string {
  const scoreByLevel: Record<RiskLevel, number | null> = {
    low: 10,
    moderate: 30,
    elevated: 50,
    high: 70,
    critical: 90,
    unknown: null
  };
  return riskFromScore(scoreByLevel[level]).label;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
