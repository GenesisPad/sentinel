"use client";
import Link from "next/link";
import { AlertTriangle, ChevronRight, RefreshCcw, ShieldAlert } from "lucide-react";
import type { ScanReport } from "@/lib/types";
import { sortFindings } from "@/lib/risk";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TokenHeader } from "@/components/token-header";
import { ScoreGauge } from "@/components/score-gauge";
import { RiskBadge } from "@/components/risk-badge";
import { QuickAnswers } from "@/components/quick-answers";
import { TradingSimulation } from "@/components/trading-simulation";
import { HolderConcentration } from "@/components/holder-concentration";
import { LiquidityCard } from "@/components/liquidity-card";
import { ScanMetadata } from "@/components/scan-metadata";
import { ShareMenu } from "@/components/share-menu";

/** Compact result shown inline on the homepage after a scan completes. */
export function ResultSummary({ report, onFresh, freshBusy = false }: { report: ScanReport; onFresh?: () => void; freshBusy?: boolean }) {
  const tokenPath = `/token/${report.token.chainId}/${report.token.address}`;
  const critical = sortFindings(report.findings).filter((f) => f.severity === "critical");

  return (
    <div className="flex flex-col gap-4">
      {report.status === "partial" && report.incomplete?.length ? (
        <div role="status" className="rounded-xl border border-warn/35 bg-warn/5 p-4 text-sm text-warn">
          <p className="font-bold">Partial scan completed</p>
          <p className="mt-1 text-secondary">
            Some checks could not complete: {report.incomplete.join("; ")}.
          </p>
        </div>
      ) : null}

      {report.cachedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-deep px-4 py-2.5 text-sm">
          <span className="text-muted">
            Showing this token&apos;s last saved scan.{" "}
            <span className="text-foreground">Some details may have changed since then — hit Rerun for the latest.</span>
          </span>
          {onFresh ? (
            <button
              onClick={onFresh}
              disabled={freshBusy}
              className="inline-flex items-center gap-1.5 font-bold text-primary transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
            >
              <RefreshCcw className={freshBusy ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
              {freshBusy ? "Rerunning" : "Rerun scan"}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* identity + score */}
      <Card className="grid gap-7 bg-[linear-gradient(180deg,#101311,#0c0e0c)] p-6 md:grid-cols-2 md:items-center">
        <div className="flex flex-col gap-3">
          <TokenHeader token={report.token} size="lg" />
          <div className="flex flex-wrap items-center gap-4">
            {onFresh ? (
              <button
                onClick={onFresh}
                disabled={freshBusy}
                className="inline-flex w-fit items-center gap-1.5 text-sm font-bold text-primary transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
              >
                <RefreshCcw className={freshBusy ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
                {freshBusy ? "Rerunning" : "Rerun scan"}
              </button>
            ) : null}
            <Link href={tokenPath} className="inline-flex w-fit items-center gap-1 text-sm font-bold text-primary hover:brightness-110">
              View Full Report
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Risk Score</span>
            <RiskBadge score={report.riskScore} size="sm" />
          </div>
          <ScoreGauge score={report.riskScore} />
        </div>
      </Card>

      <Card>
        <CardContent>
          <h3 className="mb-3 font-display text-base font-semibold">Quick answers</h3>
          <QuickAnswers report={report} />
        </CardContent>
      </Card>

      {/* body */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="mb-3.5 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">Trading simulation</h3>
                {onFresh ? (
                  <button
                    onClick={onFresh}
                    disabled={freshBusy}
                    className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <RefreshCcw className={freshBusy ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
                    {freshBusy ? "Rerunning" : "Rerun scan"}
                  </button>
                ) : null}
              </div>
              <TradingSimulation sim={report.simulation} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <h3 className="mb-3.5 font-display text-base font-semibold">
                Holder concentration <span className="text-xs font-normal text-faint">(excluding pools)</span>
              </h3>
              <HolderConcentration holders={report.holders} decimals={report.token.decimals} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-4">
              <Count n={report.checks.critical} label="Critical" hex="#f0483e" />
              <Count n={report.checks.high} label="High" hex="#ff8a3d" />
              <Count n={report.checks.medium} label="Medium" hex="#f5a623" />
              <Count n={report.checks.passed} label="Passed" hex="#b4f11f" />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="mb-3.5 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">Most serious findings</h3>
                <Link href={tokenPath} className="text-[13px] font-bold text-primary hover:brightness-110">
                  View all ({report.findings.length})
                </Link>
              </div>
              <div className="flex flex-col gap-2.5">
                {critical.length === 0 ? (
                  <p className="text-sm text-muted">No critical findings detected. This does not guarantee safety.</p>
                ) : (
                  critical.map((f) => (
                    <Link
                      key={f.id}
                      href={tokenPath}
                      className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/5 p-3.5 transition-colors hover:bg-danger/10"
                    >
                      {f.id === "blacklist" ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}
                      <span className="flex-1">
                        <span className="block text-sm font-bold text-danger">{f.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{f.summary}</span>
                      </span>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-faint" />
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <h3 className="mb-3.5 font-display text-base font-semibold">Liquidity overview</h3>
              <LiquidityCard liquidity={report.liquidity} chainId={report.token.chainId} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* metadata + actions */}
      <Card className="flex flex-col gap-4 bg-surface-deep p-5 lg:flex-row lg:items-center lg:justify-between">
        <ScanMetadata report={report} compact />
        <div className="flex flex-wrap gap-2.5">
          {onFresh ? (
            <Button variant="secondary" size="sm" onClick={onFresh} disabled={freshBusy}>
              <RefreshCcw className={freshBusy ? "size-4 animate-spin" : "size-4"} aria-hidden />
              {freshBusy ? "Rerunning" : "Rerun scan"}
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={tokenPath}>View Full Report</Link>
          </Button>
        </div>
      </Card>
      <ShareMenu report={report} />
    </div>
  );
}

function Count({ n, label, hex }: { n: number; label: string; hex: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-2xl font-bold" style={{ color: hex }}>
        {n}
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
