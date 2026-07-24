"use client";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, ArrowLeft, ChevronRight, List, RefreshCcw } from "lucide-react";
import type { ScanReport } from "@/lib/types";
import { useTokenReport } from "@/hooks/use-token-report";
import type { ChainId } from "@/lib/chains";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { sortFindings, SEVERITY_STYLES } from "@/lib/risk";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TokenHeader } from "@/components/token-header";
import { ScoreGauge } from "@/components/score-gauge";
import { RiskBadge } from "@/components/risk-badge";
import { ScanProgress } from "@/components/scan-progress";
import { QuickAnswers } from "@/components/quick-answers";
import { FindingsList } from "@/components/findings-list";
import { ContractControlsGrid } from "@/components/contract-controls";
import { OwnerDetails } from "@/components/owner-details";
import { DetectorChecksTable } from "@/components/detector-checks-table";
import { TradingSimulation } from "@/components/trading-simulation";
import { LiquidityCard } from "@/components/liquidity-card";
import { HolderConcentration } from "@/components/holder-concentration";
import { WalletClusterGraph } from "@/components/wallet-cluster-graph";
import { ScanMetadata } from "@/components/scan-metadata";
import { ShareMenu } from "@/components/share-menu";

const TRADER_SECTIONS = [
  { id: "quick-answers", label: "Quick answers" },
  { id: "risk", label: "Risk overview" },
  { id: "top-risks", label: "Top risks" },
  { id: "sim", label: "Trading simulation" },
  { id: "liquidity", label: "Liquidity" },
  { id: "holders", label: "Holders" },
  { id: "wallet-cluster", label: "Connected wallets" },
  { id: "metadata", label: "Scan metadata" },
];

const TECHNICAL_SECTIONS = [
  { id: "controls", label: "Contract controls" },
  { id: "owner", label: "Owner & verification" },
  { id: "findings", label: "All findings" },
  { id: "checks", label: "Detector checks" },
  { id: "sim", label: "Trading simulation" },
  { id: "liquidity", label: "Liquidity pool" },
  { id: "holders", label: "Holder analysis" },
  { id: "wallet-cluster", label: "Connected wallets" },
  { id: "metadata", label: "Scan metadata" },
];

export function TokenReportView({
  chainId,
  address,
  initialData,
}: {
  chainId: ChainId;
  address: string;
  initialData?: ScanReport;
}) {
  const { data: report, rerun, isRerunning, rerunError, freshJob } = useTokenReport(chainId, address, initialData);
  const view = useUiStore((s) => s.reportView);
  const setView = useUiStore((s) => s.setReportView);
  if (!report) return null;

  const sections = view === "trader" ? TRADER_SECTIONS : TECHNICAL_SECTIONS;

  return (
    <main className="mx-auto min-w-0 max-w-[1360px] px-4 pb-20 sm:px-7">
      <Link href="/" className="mb-4 inline-flex items-center gap-2 py-1.5 text-sm font-semibold text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to scanner
      </Link>

      <Card className="flex min-w-0 flex-col justify-between gap-5 bg-[linear-gradient(180deg,#101311,#0c0e0c)] p-4 sm:flex-row sm:items-center sm:p-6">
        <TokenHeader token={report.token} size="lg" />
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={rerun} disabled={isRerunning}>
              <RefreshCcw className={isRerunning ? "size-4 animate-spin" : "size-4"} aria-hidden />
              {isRerunning ? "Rerunning" : "Rerun scan"}
            </Button>
            <div className="inline-flex rounded-xl border border-border-strong bg-surface-deep p-1" role="tablist" aria-label="Report view">
              {(["trader", "technical"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-[13px] font-bold capitalize transition-colors",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  {v === "trader" ? "Trader View" : "Technical View"}
                </button>
              ))}
            </div>
          </div>
          {rerunError ? <p className="text-xs text-danger">Fresh scan failed. Try again in a moment.</p> : null}
        </div>
      </Card>
      <p className="mt-2 text-xs text-muted">
        {view === "trader"
          ? "Fast answers for a buy/sell decision. Switch to Technical View for raw evidence."
          : "Raw contract controls, detector checks, and evidence. Switch to Trader View for a quick summary."}
      </p>

      {isRerunning && freshJob ? (
        <div className="mt-6">
          <ScanProgress job={freshJob} />
        </div>
      ) : null}

      <div className="mt-4 lg:hidden">
        <MobileSectionNav sections={sections} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-0.5" aria-label="Report sections">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-lg px-3.5 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground">
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          {view === "trader" ? <TraderSections report={report} /> : <TechnicalSections report={report} />}
        </div>
      </div>
    </main>
  );
}

/** The sticky sidebar nav is hidden below `lg` since there's no room for it — this dropdown
 * is the only way to jump straight to a section on mobile instead of scrolling past all of them. */
function MobileSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface-deep px-4 py-2.5 text-sm font-semibold text-foreground"
        >
          <span className="inline-flex items-center gap-2">
            <List className="size-4" aria-hidden />
            Jump to section
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-40 max-h-[60vh] w-[calc(100vw-2.5rem)] overflow-y-auto rounded-xl border border-border-strong bg-surface-deep p-1.5 shadow-xl"
        >
          {sections.map((s) => (
            <DropdownMenu.Item key={s.id} asChild>
              <a
                href={`#${s.id}`}
                className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground outline-none data-[highlighted]:bg-[#161a12]"
              >
                {s.label}
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function TraderSections({ report }: { report: ScanReport }) {
  return (
    <>
      <Section id="quick-answers" title="Quick answers" subtitle="The questions investors ask first. Every value traces to real evidence or says so when it does not.">
        <QuickAnswers report={report} />
      </Section>

      <Section id="risk" title="Risk overview">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Detected risk</div>
            <div className="mt-1.5"><RiskBadge score={report.riskScore} size="lg" /></div>
          </div>
          <div className="flex gap-6">
            <Metric n={report.checks.critical} label="Critical" hex="#f0483e" />
            <Metric n={report.checks.high} label="High" hex="#ff8a3d" />
            <Metric n={report.checks.medium} label="Medium" hex="#f5a623" />
            <Metric n={report.checks.passed} label="Passed" hex="#b4f11f" />
          </div>
        </div>
        <div className="mt-5"><ScoreGauge score={report.riskScore} /></div>
      </Section>

      <Section id="top-risks" title="Top risks" subtitle="Most serious first. See Technical View for the full list and evidence.">
        <TopRisks report={report} />
      </Section>

      <Section id="sim" title="Trading simulation">
        <TradingSimulation sim={report.simulation} />
      </Section>

      <Section id="liquidity" title="Liquidity">
        <div className="max-w-xl"><LiquidityCard liquidity={report.liquidity} chainId={report.token.chainId} /></div>
      </Section>

      <Section id="holders" title="Holder concentration" subtitle="Excluding pools">
        <div className="max-w-xl"><HolderConcentration holders={report.holders} decimals={report.token.decimals} /></div>
      </Section>

      <Section id="wallet-cluster" title="Connected wallets" subtitle="Real, evidenced wallet relationships — never inferred from timing coincidence.">
        <WalletClusterGraph chainId={report.token.chainId} tokenSymbol={report.token.symbol} tokenAddress={report.token.address} edges={report.walletCluster} devCluster={report.devCluster} />
      </Section>

      <Section id="metadata" title="Scan metadata">
        <ScanMetadata report={report} />
        <div className="mt-5"><ShareMenu report={report} /></div>
      </Section>
    </>
  );
}

function TechnicalSections({ report }: { report: ScanReport }) {
  return (
    <>
      <Section id="controls" title="Contract controls">
        <ContractControlsGrid controls={report.controls} />
      </Section>

      <Section id="owner" title="Owner & verification">
        <OwnerDetails token={report.token} />
      </Section>

      <Section id="findings" title="All findings" subtitle="Most serious first. Expand a row to review its evidence.">
        <FindingsList findings={report.findings} />
      </Section>

      <Section id="checks" title="Detector checks" subtitle="Every check the backend ran, including passed and unavailable outcomes.">
        <DetectorChecksTable checks={report.detectorChecks} />
      </Section>

      <Section id="sim" title="Trading simulation">
        <TradingSimulation sim={report.simulation} />
      </Section>

      <Section id="liquidity" title="Liquidity pool">
        <div className="max-w-xl"><LiquidityCard liquidity={report.liquidity} chainId={report.token.chainId} technical /></div>
      </Section>

      <Section id="holders" title="Holder analysis" subtitle="Excluding pools">
        <div className="max-w-xl"><HolderConcentration holders={report.holders} decimals={report.token.decimals} /></div>
      </Section>

      <Section id="wallet-cluster" title="Connected wallets" subtitle="Real, evidenced wallet relationships — never inferred from timing coincidence.">
        <WalletClusterGraph chainId={report.token.chainId} tokenSymbol={report.token.symbol} tokenAddress={report.token.address} edges={report.walletCluster} devCluster={report.devCluster} />
      </Section>

      <Section id="metadata" title="Scan metadata">
        <ScanMetadata report={report} />
        <div className="mt-5"><ShareMenu report={report} /></div>
      </Section>
    </>
  );
}

function TopRisks({ report }: { report: ScanReport }) {
  // INFO findings (e.g. "launched via GenesisPad with liquidity locked") are evidence, not
  // risk — they never belong in a "most serious first" risk callout, regardless of how few
  // actual risk findings exist.
  const top = sortFindings(report.findings.filter((f) => f.severity !== "info")).slice(0, 3);
  if (top.length === 0) {
    return <p className="text-sm text-muted">No findings detected. This does not guarantee the token is safe.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {top.map((f) => {
        const style = SEVERITY_STYLES[f.severity];
        return (
          <div
            key={f.id}
            className="flex items-start gap-3 rounded-xl border p-3.5"
            style={{ borderColor: style.border, background: style.bg }}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: style.hex }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold" style={{ color: style.hex }}>
                {f.title}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{f.summary}</span>
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-faint" />
          </div>
        );
      })}
    </div>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 max-w-full scroll-mt-24">
      <Card className="min-w-0 max-w-full overflow-hidden">
        <CardContent>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="mb-4 mt-0.5 text-sm text-muted">{subtitle}</p> : <div className="mb-4" />}
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function Metric({ n, label, hex }: { n: number; label: string; hex: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-2xl font-bold" style={{ color: hex }}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
