"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScan,
  getExistingTokenReport,
  getScan,
  getScanReport,
  type ApiError,
  type CreateScanArgs,
} from "@/lib/api";
import type { ScanJob, ScanReport, ScanState } from "@/lib/types";
import { useUiStore } from "@/store/ui-store";

const TERMINAL = new Set(["completed", "partial", "failed"]);

/**
 * Owns the full scan lifecycle: submit → poll stages → fetch canonical report.
 * Progress is derived from backend stages only — never a random percentage.
 */
export function useScan() {
  const queryClient = useQueryClient();
  const setActiveScan = useUiStore((s) => s.setActiveScan);
  const activeScanId = useUiStore((s) => s.activeScanId);
  const [pollTick, setPollTick] = useState(0);
  const tickRef = useRef(0);

  const submit = useMutation({
    // "Scan Token" means "show me this token's current state" — for a token that's already
    // been scanned, that's the latest persisted result, not a brand-new scan pinned behind the
    // same stale idempotency key every subsequent visit would otherwise resolve to. Only an
    // explicit `fresh: true` (the Rerun button) forces a genuinely new scan.
    mutationFn: async (args: CreateScanArgs) => {
      if (!args.fresh) {
        const existing = await getExistingTokenReport(args.chainId ?? "robinhood", args.address);
        if (existing) return { kind: "existing" as const, report: existing };
      }
      return { kind: "job" as const, job: await createScan(args) };
    },
    onSuccess: (result) => {
      tickRef.current = 0;
      setPollTick(0);
      if (result.kind === "existing") {
        const { report } = result;
        setActiveScan(report.scanId);
        queryClient.setQueryData(["scan", report.scanId], {
          scanId: report.scanId,
          status: report.status,
          stages: report.stages,
          token: report.token,
        });
        queryClient.setQueryData(["scan-report", report.scanId], report);
      } else {
        setActiveScan(result.job.scanId);
        queryClient.setQueryData(["scan", result.job.scanId], result.job);
      }
    },
  });

  const job = useQuery<ScanJob, ApiError>({
    queryKey: ["scan", activeScanId],
    queryFn: () => getScan(activeScanId as string, tickRef.current),
    enabled: !!activeScanId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      return 900; // polling fallback cadence
    },
    retry: (count, err) => err.code === "network_error" && count < 3,
  });

  // advance fixture tick each poll while running (no-op against a real backend)
  useEffect(() => {
    if (!activeScanId) return;
    const status = job.data?.status;
    if (status && TERMINAL.has(status)) return;
    const t = setInterval(() => {
      tickRef.current += 1;
      setPollTick((n) => n + 1);
    }, 900);
    return () => clearInterval(t);
  }, [activeScanId, job.data?.status]);

  const isTerminal = !!job.data && TERMINAL.has(job.data.status);

  const report = useQuery<ScanReport, ApiError>({
    queryKey: ["scan-report", activeScanId],
    queryFn: () => getScanReport(activeScanId as string),
    enabled: !!activeScanId && isTerminal && job.data?.status !== "failed",
    staleTime: 60_000,
  });

  const scanState: ScanState = deriveState(submit.isPending, job.data, report.data, job.error);

  const start = useCallback(
    (args: CreateScanArgs) => submit.mutate(args),
    [submit],
  );

  const reset = useCallback(() => {
    setActiveScan(null);
    setPollTick(0);
    tickRef.current = 0;
    submit.reset();
  }, [setActiveScan, submit]);

  return {
    start,
    reset,
    scanState,
    job: job.data,
    report: report.data,
    error: submit.error ?? job.error ?? report.error ?? null,
    isSubmitting: submit.isPending,
    pollTick,
  };
}

function deriveState(
  submitting: boolean,
  job: ScanJob | undefined,
  report: ScanReport | undefined,
  jobError: ApiError | null,
): ScanState {
  if (submitting) return "submitting";
  if (jobError) return "failed";
  if (!job) return "idle";
  if (job.status === "failed") return "failed";
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "scanning";
  if (job.status === "partial") return "partial";
  if (job.status === "completed") return report ? "completed" : "scanning";
  return "idle";
}
