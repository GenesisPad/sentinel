import type {
  CheckOutcome,
  ScanProgress,
  ScanResultView,
  ScanState,
  SecurityFindingView
} from "@genesis-sentinel/shared";
import type { ChainId } from "./chains";
import { chainByNumericId } from "./chains";
import type {
  ContractControls,
  Finding,
  HolderInfo,
  LiquidityInfo,
  ScanJob,
  ScanReport,
  ScanResultStatus,
  ScanStage,
  ScanStageKey,
  Severity,
  TokenMeta,
  TradeSimulation
} from "./types";

const STAGE_DEFS: Array<{ key: ScanStageKey; label: string; state: ScanState }> = [
  { key: "resolving_chain", label: "Resolving chain", state: "RESOLVING_CHAIN" },
  { key: "fetching_contract", label: "Fetching contract", state: "FETCHING_CONTRACT" },
  { key: "analyzing_contract", label: "Analyzing contract", state: "ANALYZING_CONTRACT" },
  { key: "discovering_markets", label: "Discovering markets", state: "DISCOVERING_MARKETS" },
  { key: "analyzing_holders", label: "Analyzing holders", state: "ANALYZING_HOLDERS" },
  { key: "simulating_trades", label: "Simulating trades", state: "SIMULATING_TRADES" },
  { key: "scoring", label: "Scoring", state: "SCORING" }
];

const STATE_ORDER: ScanState[] = [
  "QUEUED",
  "RESOLVING_CHAIN",
  "FETCHING_CONTRACT",
  "ANALYZING_CONTRACT",
  "DISCOVERING_MARKETS",
  "ANALYZING_HOLDERS",
  "SIMULATING_TRADES",
  "SCORING",
  "COMPLETED"
];

function stateIndex(state: ScanState): number {
  if (state === "PARTIALLY_COMPLETED" || state === "FAILED") return STATE_ORDER.length;
  return STATE_ORDER.indexOf(state);
}

/** Derives a stage checklist purely from the backend's single authoritative `state` value. */
function deriveStages(state: ScanState): ScanStage[] {
  const currentIndex = stateIndex(state);
  return STAGE_DEFS.map((def) => {
    const defIndex = STATE_ORDER.indexOf(def.state);
    if (state === "FAILED") {
      return {
        key: def.key,
        label: def.label,
        status: defIndex < currentIndex ? "passed" : "pending"
      };
    }
    if (defIndex < currentIndex) return { key: def.key, label: def.label, status: "passed" };
    if (defIndex === currentIndex) return { key: def.key, label: def.label, status: "running" };
    return { key: def.key, label: def.label, status: "pending" };
  });
}

function chainIdFor(numericChainId: number): ChainId {
  return chainByNumericId(numericChainId)?.id ?? "robinhood";
}

export function mapProgressToJob(progress: ScanProgress): ScanJob {
  return {
    scanId: progress.scanId,
    status: mapStateToStatus(progress.state),
    stages: deriveStages(progress.state),
    token: { chainId: chainIdFor(progress.chainId), address: progress.address }
  };
}

function mapStateToStatus(state: ScanState): ScanResultStatus {
  if (state === "QUEUED") return "queued";
  if (state === "COMPLETED") return "completed";
  if (state === "PARTIALLY_COMPLETED") return "partial";
  if (state === "FAILED") return "failed";
  return "running";
}

const SEVERITY_MAP: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info"
};

function mapFinding(finding: SecurityFindingView): Finding {
  const firstEvidence = finding.evidence[0];
  return {
    id: finding.id,
    severity: SEVERITY_MAP[finding.severity] ?? "info",
    title: finding.title,
    summary: finding.description,
    detail: finding.description,
    technical: finding.technicalExplanation,
    controller: firstEvidence?.address,
    block: firstEvidence?.blockNumber ? Number(firstEvidence.blockNumber) : undefined,
    confidence: finding.confidence.toLowerCase() as "low" | "medium" | "high",
    recommendation: finding.recommendation,
    detectorId: finding.detectorId,
    detectorVersion: finding.detectorVersion,
    evidence: finding.evidence.map((e) => e.summary).join("\n") || undefined
  };
}

/**
 * Selector-pattern detectors are deterministic and always run once ANALYZING_CONTRACT
 * succeeds — so the *absence* of a finding for a given detector is real information
 * (no matching selector found), not an unknown. Only report booleans once that stage
 * has actually completed.
 */
function deriveControls(
  findings: SecurityFindingView[],
  state: ScanState,
  ownershipStatus: TokenMeta["ownershipStatus"]
): ContractControls {
  const contractAnalysisReached = stateIndex(state) > STATE_ORDER.indexOf("ANALYZING_CONTRACT");
  const known = contractAnalysisReached && state !== "FAILED";
  const detected = (detectorId: string) => findings.some((f) => f.detectorId === detectorId);

  if (!known) {
    return {
      ownershipRenounced: null,
      canMint: null,
      canBlacklist: null,
      canPause: null,
      canChangeTaxes: null,
      isProxy: null,
      upgradeable: null,
      canLimitTransactions: null,
      canDisableTrading: null,
      hasFeeWhitelist: null
    };
  }

  const isProxy = detected("proxy-selector-patterns");
  // Prefer the backend's direct on-chain owner() read (ownershipStatus) — it can positively
  // confirm "renounced", which no finding-presence heuristic can (renounced never produces a
  // finding, it's the passed case). Fall back to unknown when the backend hasn't resolved it.
  const ownershipNotRenounced = findings.some((f) => f.code === "OWNERSHIP_NOT_RENOUNCED");
  const ownershipRenounced =
    ownershipStatus === "renounced"
      ? true
      : ownershipStatus === "active" || ownershipNotRenounced
        ? false
        : null;

  return {
    ownershipRenounced,
    canMint: detected("mint-selector-patterns"),
    canBlacklist: detected("blacklist-selector-patterns"),
    canPause: detected("pause-selector-patterns"),
    canChangeTaxes: null,
    isProxy,
    upgradeable: isProxy ? true : null,
    canLimitTransactions: detected("max-transaction-selector-patterns"),
    canDisableTrading: detected("trading-control-selector-patterns"),
    hasFeeWhitelist: detected("fee-exclusion-selector-patterns")
  };
}

function mapOutcomeToSimStatus(outcome: CheckOutcome): "passed" | "failed" | "inconclusive" {
  if (outcome === "PASSED") return "passed";
  if (outcome === "DETECTED" || outcome === "FAILED") return "failed";
  return "inconclusive";
}

function mapSimulations(view: ScanResultView["simulations"]): TradeSimulation {
  const buy = view.find((run) => run.kind === "BUY");
  const sell = view.find((run) => run.kind === "SELL");

  return {
    isHoneypot: null,
    canBuy: mapSimulationCapability(buy?.outcome),
    canSell: mapSimulationCapability(sell?.outcome),
    results: view.map((run) => ({
      label: `${run.kind.charAt(0)}${run.kind.slice(1).toLowerCase()} simulation`,
      status: mapOutcomeToSimStatus(run.outcome),
      detail: run.revertReason
    }))
  };
}

function mapSimulationCapability(outcome: CheckOutcome | undefined): boolean | null {
  if (outcome === "PASSED") return true;
  if (outcome === "DETECTED" || outcome === "FAILED") return false;
  return null;
}

// Only Uniswap V2 pools discovered against wrapped native ETH on Robinhood Chain are
// persisted today (packages/database LiquidityPool). "Locked" here means burned/sent to a
// known dead address — the backend has no LP-locker-contract detection yet, so a genuine
// third-party lock (not burn) still reads as `locked: false` rather than a guess.
function mapLiquidity(view: ScanResultView): LiquidityInfo {
  const pool = view.liquidity.pools[0];
  if (!pool?.liquidityData) {
    return { totalUsd: null, locked: null };
  }

  const data = pool.liquidityData;
  const burnedPct =
    typeof data.lpBurnedOrLockedPct === "number" ? data.lpBurnedOrLockedPct : undefined;
  const totalUsd = typeof data.totalLiquidityUsd === "number" ? data.totalLiquidityUsd : null;

  return {
    totalUsd,
    locked: burnedPct != null ? burnedPct >= 50 : null,
    burnedPct,
    lockedPct: burnedPct
  };
}

function mapHolders(view: ScanResultView): HolderInfo {
  const holderView = view.holders;
  const snapshot = holderView.snapshots[0];
  const concentration = snapshot?.concentration as
    { top1Pct?: number; top5Pct?: number; top10Pct?: number } | undefined;

  return {
    top1Pct: concentration?.top1Pct ?? null,
    top5Pct: concentration?.top5Pct ?? null,
    top10Pct: concentration?.top10Pct ?? null,
    holderCount: view.token.holderCount ?? snapshot?.holderCount
  };
}

/**
 * Best-effort token identity. The API only exposes name/symbol/decimals publicly when the
 * ERC-20 metadata detector produced a finding (i.e. metadata was *incomplete*) — a fully
 * healthy token currently has no metadata surfaced by any endpoint. Rather than fabricate a
 * name/symbol, this stays null and the UI falls back to the address.
 */
function deriveTokenMeta(
  view: ScanResultView,
  chainId: ChainId,
  address: `0x${string}`
): TokenMeta {
  const metadataFinding = view.findings.find((f) => f.detectorId === "erc20-metadata");
  const evidenceData = metadataFinding?.evidence[0]?.data as
    { name?: string | null; symbol?: string | null; decimals?: number | null } | undefined;

  return {
    chainId,
    address,
    name: view.token.name ?? evidenceData?.name ?? null,
    symbol: view.token.symbol ?? evidenceData?.symbol ?? null,
    decimals: view.token.decimals ?? evidenceData?.decimals ?? null,
    verified: view.token.sourceVerified ?? null,
    totalSupply: view.token.totalSupply,
    holders: view.token.holderCount,
    priceUsd: view.token.priceUsd,
    marketCapUsd: view.token.marketCapUsd,
    volume24hUsd: view.token.volume24hUsd,
    createdAt: view.token.contractCreatedAt,
    deployer: view.token.deployerAddress,
    creationTxHash: view.token.creationTxHash,
    tokenType: view.token.tokenType,
    iconUrl: view.token.iconUrl,
    reputation: view.token.reputation,
    ownerAddress: view.token.ownerAddress,
    ownershipStatus:
      view.token.ownershipStatus === "RENOUNCED"
        ? "renounced"
        : view.token.ownershipStatus === "ACTIVE"
          ? "active"
          : view.token.ownershipStatus === "UNKNOWN"
            ? "unknown"
            : undefined
  };
}

function countBySeverity(findings: SecurityFindingView[], severity: Severity): number {
  return findings.filter((f) => SEVERITY_MAP[f.severity] === severity).length;
}

const CONTRACT_ANALYSIS_DETECTORS = [
  "ownership-selector-patterns",
  "proxy-selector-patterns",
  "mint-selector-patterns",
  "pause-selector-patterns",
  "blacklist-selector-patterns",
  "max-transaction-selector-patterns",
  "trading-control-selector-patterns",
  "fee-exclusion-selector-patterns"
];

function countPassed(view: ScanResultView): number {
  const contractAnalysisReached =
    stateIndex(view.scan.state) > STATE_ORDER.indexOf("ANALYZING_CONTRACT");
  if (!contractAnalysisReached || view.scan.state === "FAILED") return 0;
  const triggeredDetectors = new Set(view.findings.map((f) => f.detectorId));
  return CONTRACT_ANALYSIS_DETECTORS.filter((id) => !triggeredDetectors.has(id)).length;
}

function buildIncomplete(view: ScanResultView): string[] | undefined {
  const notes: string[] = [];
  if (view.liquidity.status !== "AVAILABLE") notes.push(`Liquidity: ${view.liquidity.message}`);
  if (view.holders.status !== "AVAILABLE") notes.push(`Holder analysis: ${view.holders.message}`);
  if (view.risk.status !== "AVAILABLE") notes.push(`Risk score: ${view.risk.message}`);
  return notes.length > 0 ? notes : undefined;
}

function hasNoContractCode(view: ScanResultView): boolean {
  return view.findings.some((finding) => finding.code === "CONTRACT_CODE_ABSENT");
}

function scoreExplanation(view: ScanResultView): string {
  if (hasNoContractCode(view)) {
    return "No deployed contract bytecode was found at this address on Robinhood Chain. This is not a valid token contract for DYOR; verify the CA and chain before trading.";
  }

  return view.risk.message;
}

export function mapResultToReport(view: ScanResultView): ScanReport {
  const chainId = chainIdFor(view.scan.chainId);
  const riskScore = view.risk.score;
  const token = deriveTokenMeta(view, chainId, view.scan.address);

  return {
    scanId: view.scan.scanId,
    status: mapStateToStatus(view.scan.state),
    token,
    riskScore,
    scoreExplanation: scoreExplanation(view),
    checks: {
      critical: countBySeverity(view.findings, "critical"),
      high: countBySeverity(view.findings, "high"),
      medium: countBySeverity(view.findings, "medium"),
      passed: countPassed(view)
    },
    stages: deriveStages(view.scan.state),
    findings: view.findings.map(mapFinding),
    controls: deriveControls(view.findings, view.scan.state, token.ownershipStatus),
    simulation: mapSimulations(view.simulations),
    liquidity: mapLiquidity(view),
    holders: mapHolders(view),
    scannerVersion: view.scan.scannerVersion,
    block: view.scan.scanBlockNumber ? Number(view.scan.scanBlockNumber) : null,
    dataSource: `${chainByNumericId(view.scan.chainId)?.label ?? "Chain"} RPC`,
    scannedAt: view.scan.completedAt ?? view.scan.submittedAt,
    incomplete: buildIncomplete(view),
    // Defensive: the type says required, but a currently-deployed backend that predates this
    // field will omit it entirely — don't let older/newer deployment skew crash the page.
    detectorChecks: (view.detectorChecks ?? []).map((check) => ({
      detectorId: check.detectorId,
      code: check.code,
      outcome: mapDetectorCheckOutcome(check.outcome),
      confidence: check.confidence?.toLowerCase() as "low" | "medium" | "high" | undefined
    }))
  };
}

function mapDetectorCheckOutcome(
  outcome: CheckOutcome
): "detected" | "passed" | "unsupported" | "failed" | "inconclusive" | "unavailable" {
  if (outcome === "DETECTED") return "detected";
  if (outcome === "PASSED") return "passed";
  if (outcome === "UNSUPPORTED") return "unsupported";
  if (outcome === "FAILED") return "failed";
  if (outcome === "DATA_UNAVAILABLE") return "unavailable";
  return "inconclusive";
}
