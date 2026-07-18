"use client";
import { useEffect, useState } from "react";
import { riskFromScore } from "@/lib/risk";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export function ScoreGauge({
  score,
  className,
  showScale = true,
}: {
  score: number | null;
  className?: string;
  showScale?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const target = score ?? 0;
  const [progress, setProgress] = useState(reduced ? target : 0);
  const risk = riskFromScore(score);

  useEffect(() => {
    if (reduced) {
      setProgress(target);
      return;
    }
    const raf = requestAnimationFrame(() => setProgress(target));
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-4xl font-bold leading-none" style={{ color: risk.hex }}>
          {score ?? "Review findings"}
        </span>
        {score != null ? <span className="text-lg text-muted">/ 100</span> : null}
      </div>

      {score != null ? (
        <>
          <div
            className="relative mt-3 h-2.5 rounded-md"
            style={{ background: "linear-gradient(90deg,#37d67a,#f5c518 30%,#ff8a3d 60%,#f0483e)" }}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            aria-label={`Risk Score ${score} of 100. ${risk.label}. Higher score means greater risk.`}
          >
            <span
              aria-hidden
              className="absolute -top-1.5 size-0 -translate-x-1/2 transition-[left] duration-[900ms] ease-out motion-reduce:transition-none"
              style={{
                left: `${progress}%`,
                borderLeft: "7px solid transparent",
                borderRight: "7px solid transparent",
                borderTop: "10px solid #fff",
              }}
            />
          </div>
          {showScale ? (
            <div className="mt-1.5 flex justify-between text-[11px] text-faint" aria-hidden>
              <span>0 Low</span>
              <span>50 Elevated</span>
              <span>100 Critical</span>
            </div>
          ) : null}
          <p className="mt-1.5 text-xs text-muted">Higher score means greater risk</p>
        </>
      ) : (
        <p className="mt-2 max-w-xl text-sm text-muted">
          A numeric score was not produced for this scan. Use the persisted findings and evidence below.
        </p>
      )}
    </div>
  );
}
