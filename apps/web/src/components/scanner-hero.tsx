"use client";
import { motion, useReducedMotion } from "motion/react";
import { useScan } from "@/hooks/use-scan";
import { useUiStore } from "@/store/ui-store";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { ContractInput, type SubmitPayload } from "@/components/contract-input";
import { ScanProgress } from "@/components/scan-progress";
import { ResultSummary } from "@/components/result-summary";
import { ResultSkeleton } from "@/components/result-skeleton";
import { ScanError } from "@/components/error-boundary";
import { WhatWeCheck } from "@/components/what-we-check";
import { RecentDetections } from "@/components/recent-detections";
import { ApiCallout } from "@/components/api-callout";

export function ScannerHero() {
  const reduced = useReducedMotion();
  const selectedChain = useUiStore((s) => s.selectedChain);
  const { start, reset, scanState, job, report, error, isSubmitting } = useScan();

  const scanning = ["submitting", "queued", "scanning"].includes(scanState);
  const hasResult = scanState === "completed" || scanState === "partial";
  const failed = scanState === "failed";
  const isHome = scanState === "idle";

  function handleSubmit(p: SubmitPayload) {
    start({ address: p.address, chainId: p.chainId ?? (selectedChain === "auto" ? undefined : selectedChain) });
  }

  function handleFreshScan() {
    if (!report) return;
    start({ address: report.token.address, chainId: report.token.chainId, fresh: true });
  }

  const transition = reduced ? { duration: 0 } : { duration: 0.34, ease: [0.2, 0.7, 0.2, 1] as const };

  return (
    <div className="mx-auto max-w-[1360px] px-5 pb-16 sm:px-7">
      {/* hero copy */}
      <motion.div layout className="text-center" transition={transition}>
        {isHome ? (
          <div className="pt-11 pb-2">
            <h1 className="font-display text-[clamp(2.4rem,6vw,4.5rem)] font-bold leading-[1.02] tracking-[-0.02em]">
              Know what you&rsquo;re <span className="text-primary">buying.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted">
              Scan any token for dangerous contract permissions, honeypot behavior, liquidity risks, and suspicious wallets.
            </p>
          </div>
        ) : (
          <div className="pt-6 pb-1">
            <h1 className="font-display text-2xl font-bold tracking-[-0.01em]">
              Know what you&rsquo;re <span className="text-primary">buying.</span>
            </h1>
          </div>
        )}
      </motion.div>

      {/* scanner input — always pinned at top */}
      <div className="mx-auto mt-6 max-w-3xl">
        <ContractInput onSubmit={handleSubmit} busy={isSubmitting || scanning} />
      </div>

      {/* supported chains */}
      {(isHome || scanning) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <span className="text-sm font-semibold text-muted">Supported chains</span>
          {SUPPORTED_CHAINS.map((c) => {
            const active = selectedChain === c.id || (selectedChain === "auto" && c.id === "robinhood");
            return (
              <span
                key={c.id}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
                style={
                  active
                    ? { background: "rgba(180,241,31,0.1)", borderColor: "rgba(180,241,31,0.4)", color: "#b4f11f" }
                    : { background: "#101311", borderColor: "#23271f", color: "#c4cabf" }
                }
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                {c.label}
              </span>
            );
          })}
        </div>
      )}

      {/* dynamic region */}
      <div className="mt-8">
        {scanning && job ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
            <ScanProgress job={job} />
          </motion.div>
        ) : null}

        {scanning && !job ? <ResultSkeleton /> : null}

        {failed ? <ScanError error={error} onRetry={reset} /> : null}

        {hasResult && report ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
            <ResultSummary report={report} onFresh={handleFreshScan} freshBusy={isSubmitting || scanning} />
          </motion.div>
        ) : null}
      </div>

      {/* homepage supporting content */}
      {isHome ? (
        <div className="mt-11 flex flex-col gap-5">
          <WhatWeCheck />
          <div className="grid min-w-0 gap-5 [&>*]:min-w-0 lg:grid-cols-[1.35fr_1fr]">
            <RecentDetections />
            <ApiCallout />
          </div>
        </div>
      ) : null}
    </div>
  );
}
