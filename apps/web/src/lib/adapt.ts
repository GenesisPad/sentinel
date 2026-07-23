import {
  liquidityHealthTier,
  NEGLIGIBLE_LIQUIDITY_USD as SHARED_NEGLIGIBLE_LIQUIDITY_USD,
  selectPrimaryLiquidityPool,
  type CheckOutcome,
  type ScanProgress,
  type ScanResultView,
  type ScanState,
  type SecurityFindingView
} from "@genesis-sentinel/shared";
import type { ChainId } from "./chains";
import { chainByNumericId } from "./chains";
import type {
  ContractControls,
  DevClusterInfo,
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
  TradeSimulation,
  WalletClusterEdge,
  WalletClusterEdgeType
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

function mapFinding(finding: SecurityFindingView, tokenAddress: string): Finding {
  const firstEvidence = finding.evidence[0];
  // Evidence `address` is "the contract this evidence pertains to" — for source-code pattern
  // matches and most on-chain reads that's just the scanned token itself, which is meaningless
  // as a "Controller" label (it doesn't identify who/what actually controls the behavior).
  // Only surface it when it's a genuinely different address (an owner, a related wallet, etc).
  const controllerAddress =
    firstEvidence?.address && firstEvidence.address.toLowerCase() !== tokenAddress.toLowerCase()
      ? firstEvidence.address
      : undefined;
  return {
    id: finding.id,
    severity: SEVERITY_MAP[finding.severity] ?? "info",
    title: finding.title,
    summary: finding.description,
    detail: finding.description,
    technical: finding.technicalExplanation,
    controller: controllerAddress,
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

function numberFromResult(result: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = result?.[key];
  return typeof value === "number" ? value : undefined;
}

function boolFromResult(result: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = result?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function mapSimulations(view: ScanResultView["simulations"]): TradeSimulation {
  const buy = view.find((run) => run.kind === "BUY");
  const sell = view.find((run) => run.kind === "SELL");
  const transfer = view.find((run) => run.kind === "TRANSFER");

  // isHoneypot is reported per-leg (a failed sell is the strongest signal, but a failed buy
  // is reported too) — never fabricated when neither leg produced a real verdict.
  const isHoneypot =
    boolFromResult(sell?.result, "isHoneypot") ?? boolFromResult(buy?.result, "isHoneypot") ?? null;

  return {
    isHoneypot,
    canBuy: mapSimulationCapability(buy?.outcome),
    canSell: mapSimulationCapability(sell?.outcome),
    evidenceLevel: simulationEvidenceLevel(buy, sell),
    buyTaxBps: numberFromResult(buy?.result, "buyTaxBps"),
    sellTaxBps: numberFromResult(sell?.result, "sellTaxBps"),
    transferTaxBps: numberFromResult(transfer?.result, "transferTaxBps"),
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

/** The worker tags every simulation's `input.simulationTool` with a "...-route-quote" suffix
 * (V2 or V3) when no forked buy/sell ran — see apps/worker scan-worker.ts `common.simulationTool`.
 * Reading it back here is how the UI knows canBuy/canSell reflect pool math rather than an
 * executed trade, without duplicating worker constants. */
function simulationEvidenceLevel(
  buy: ScanResultView["simulations"][number] | undefined,
  sell: ScanResultView["simulations"][number] | undefined
): TradeSimulation["evidenceLevel"] {
  const tool = (buy?.input?.simulationTool ?? sell?.input?.simulationTool) as string | undefined;
  if (!tool) return "unavailable";
  return tool.includes("route-quote") ? "route-quote-only" : "forked";
}

// Only Uniswap V2 pools discovered against wrapped native ETH on Robinhood Chain are
// persisted today (packages/database LiquidityPool). "Locked" here means burned/sent to a
// known dead address — the backend has no LP-locker-contract detection yet, so a genuine
// third-party lock (not burn) still reads as `locked: false` rather than a guess.
//
// Market-cap-aware health tiering and the negligible-liquidity floor live in
// @genesis-sentinel/shared (liquidityHealthTier) so the web app and the Telegram bot — which
// formats its own report text independently — can't drift out of sync on what counts as a
// dangerously empty pool.
export const NEGLIGIBLE_LIQUIDITY_USD = SHARED_NEGLIGIBLE_LIQUIDITY_USD;

function mapLiquidity(view: ScanResultView): LiquidityInfo {
  const pool = selectPrimaryLiquidityPool(view.liquidity.pools);
  if (!pool?.liquidityData) {
    return { totalUsd: null, locked: null };
  }

  const data = pool.liquidityData;
  const burnedPct =
    typeof data.lpBurnedPct === "number"
      ? data.lpBurnedPct
      : typeof data.lpBurnedOrLockedPct === "number"
        ? data.lpBurnedOrLockedPct
        : undefined;
  const lockedPct =
    typeof data.lpLockedPct === "number" ? data.lpLockedPct : undefined;
  const protectedPct =
    typeof data.lpBurnedOrLockedPct === "number"
      ? data.lpBurnedOrLockedPct
      : burnedPct;
  const totalUsd = typeof data.totalLiquidityUsd === "number" ? data.totalLiquidityUsd : null;
  // totalLiquidityUsd is computed as quote-side value * 2 (packages/providers), assuming a
  // roughly symmetric pool — so the quote (native/stablecoin) side alone is half of it.
  const quoteSideUsd = totalUsd != null ? totalUsd / 2 : null;
  const marketCapUsd = view.token.marketCapUsd ? Number(view.token.marketCapUsd) : null;
  const quoteSidePctOfMarketCap =
    quoteSideUsd != null && marketCapUsd != null && marketCapUsd > 0
      ? (quoteSideUsd / marketCapUsd) * 100
      : null;

  return {
    totalUsd,
    locked: protectedPct != null ? protectedPct >= 50 : null,
    burnedPct,
    lockedPct,
    poolAddress: pool.poolAddress,
    dex: pool.dex ?? undefined,
    quoteSidePctOfMarketCap,
    healthTier: totalUsd != null ? liquidityHealthTier(totalUsd, quoteSidePctOfMarketCap, marketCapUsd) : null
  };
}

function mapHolders(view: ScanResultView, devCluster: DevClusterInfo): HolderInfo {
  const holderView = view.holders;
  const snapshot = holderView.snapshots[0];
  const concentration = snapshot?.concentration as
    | {
        top1Pct?: number;
        top5Pct?: number;
        top10Pct?: number;
        deployerPct?: number | null;
        deployerBalanceRaw?: string | null;
      }
    | undefined;
  const topHolders = snapshot?.topHolders as { holders?: unknown[] } | undefined;
  const clusteredWithDeployer = Array.isArray(topHolders?.holders)
    ? topHolders.holders.filter(
        (holder): holder is { labels: string[] } =>
          typeof holder === "object" &&
          holder !== null &&
          Array.isArray((holder as { labels?: unknown }).labels) &&
          (holder as { labels: string[] }).labels.includes("RELATED_WALLET")
      ).length
    : undefined;
  const deployerPct =
    precisePctFromRaw(concentration?.deployerBalanceRaw, view.token.totalSupply) ??
    concentration?.deployerPct ??
    null;

  return {
    top1Pct: concentration?.top1Pct ?? null,
    top5Pct: concentration?.top5Pct ?? null,
    top10Pct: concentration?.top10Pct ?? null,
    holderCount: view.token.holderCount ?? snapshot?.holderCount,
    ...(clusteredWithDeployer ? { clusteredWithDeployer } : {}),
    devClusterPct: devCluster.knownHoldingPct,
    devClusterWalletCount: devCluster.walletCount,
    devClusterUnknownHoldingWalletCount: devCluster.unknownHoldingWalletCount,
    ...(concentration?.deployerBalanceRaw != null
      ? { deployerBalance: { amountRaw: concentration.deployerBalanceRaw, pct: deployerPct } }
      : {})
  };
}

const WALLET_CLUSTER_EDGE_TYPES = new Set<WalletClusterEdgeType>([
  "FUNDED_BY",
  "DEPLOYED_BY",
  "OWNED_BY",
  "PREVIOUSLY_OWNED_BY",
  "SHARED_BYTECODE",
  "TRANSFERRED_SUPPLY_TO",
]);

/** Builds an address → % of total supply lookup from the persisted top-holders snapshot, so
 * wallet-cluster edges can show how much of the supply each connected address actually holds.
 * Only covers whatever the snapshot tracked (typically the top N holders) — an address outside
 * that set has no entry here, and callers must treat that as "unknown," not "zero." */
function buildHolderPctLookup(view: ScanResultView): Map<string, number> {
  const snapshot = view.holders.snapshots[0];
  const topHolders = snapshot?.topHolders as { holders?: unknown[] } | undefined;
  const lookup = new Map<string, number>();
  if (!Array.isArray(topHolders?.holders)) return lookup;

  for (const holder of topHolders.holders) {
    if (typeof holder !== "object" || holder === null) continue;
    const record = holder as Record<string, unknown>;
    const { address, totalSupplyPct, balanceRaw } = record;
    if (typeof address === "string") {
      const precise = precisePctFromRaw(balanceRaw, view.token.totalSupply);
      if (precise != null) {
        lookup.set(address.toLowerCase(), precise);
      } else if (typeof totalSupplyPct === "number") {
        lookup.set(address.toLowerCase(), totalSupplyPct);
      }
    }
  }
  return lookup;
}

/** The full related-wallet edge list lives in the WALLET_CLUSTERING_EDGES_FOUND detector
 * check's evidence (deployerHistoryDetector, packages/security-engine) — not reduced anywhere
 * upstream, so this is the one place that has to parse it out of an untyped evidence blob. */
function extractWalletCluster(view: ScanResultView): WalletClusterEdge[] {
  const check = (view.detectorChecks ?? []).find((c) => c.code === "WALLET_CLUSTERING_EDGES_FOUND");
  const rawEdges = check?.evidence[0]?.data.edges;
  if (!Array.isArray(rawEdges)) return [];

  const holderPctByAddress = buildHolderPctLookup(view);

  return rawEdges.flatMap((raw): WalletClusterEdge[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const record = raw as Record<string, unknown>;
    const { type, address, confidence, evidence, source } = record;
    if (
      typeof type !== "string" ||
      !WALLET_CLUSTER_EDGE_TYPES.has(type as WalletClusterEdgeType) ||
      typeof address !== "string" ||
      typeof confidence !== "string" ||
      typeof evidence !== "string" ||
      typeof source !== "string"
    ) {
      return [];
    }

    // The worker reads each clustered wallet's balance directly on-chain, so prefer that over
    // the top-holder snapshot, which only covers wallets large enough to make the top N.
    const directHoldingPct =
      precisePctFromRaw(record.balanceRaw, view.token.totalSupply) ??
      (typeof record.holdingPct === "number" ? record.holdingPct : null);

    return [
      {
        type: type as WalletClusterEdgeType,
        address,
        confidence: confidence.toLowerCase() as "low" | "medium" | "high",
        evidence,
        source,
        holdingPct: directHoldingPct ?? holderPctByAddress.get(address.toLowerCase()) ?? null,
        ...(typeof record.balanceRaw === "string" ? { balanceRaw: record.balanceRaw } : {}),
      },
    ];
  });
}

function precisePctFromRaw(balanceRaw: unknown, totalSupply: string | null | undefined): number | null {
  if (typeof balanceRaw !== "string" || !totalSupply) return null;
  try {
    const total = BigInt(totalSupply);
    if (total <= 0n) return null;
    return Number((BigInt(balanceRaw) * 100_000_000n) / total) / 1_000_000;
  } catch {
    return null;
  }
}

/** Supply sent here is given up, not controlled, so it never counts toward the dev cluster. */
const BURN_OR_ZERO_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

function buildDevClusterSummary(view: ScanResultView, edges: WalletClusterEdge[]): DevClusterInfo {
  const holderPctByAddress = buildHolderPctLookup(view);
  const wallets = new Map<string, number | null>();
  const isBurned = (key: string) =>
    BURN_OR_ZERO_ADDRESSES.has(key) || key === view.token.address.toLowerCase();

  if (view.token.deployerAddress) {
    const key = view.token.deployerAddress.toLowerCase();
    if (!isBurned(key)) wallets.set(key, holderPctByAddress.get(key) ?? null);
  }

  for (const edge of edges) {
    const key = edge.address.toLowerCase();
    if (isBurned(key)) continue;
    wallets.set(key, edge.holdingPct ?? holderPctByAddress.get(key) ?? null);
  }

  const holdingValues = [...wallets.values()].flatMap((pct) => (pct == null ? [] : [pct]));
  return {
    walletCount: wallets.size,
    knownHoldingPct:
      holdingValues.length > 0 ? holdingValues.reduce((total, pct) => total + pct, 0) : null,
    unknownHoldingWalletCount: [...wallets.values()].filter((pct) => pct == null).length
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
    dexPaid: view.token.dexPaid,
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
  const walletCluster = extractWalletCluster(view);
  const devCluster = buildDevClusterSummary(view, walletCluster);

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
    findings: view.findings.map((finding) => mapFinding(finding, view.scan.address)),
    controls: deriveControls(view.findings, view.scan.state, token.ownershipStatus),
    simulation: mapSimulations(view.simulations),
    liquidity: mapLiquidity(view),
    holders: mapHolders(view, devCluster),
    devCluster,
    walletCluster,
    scannerVersion: view.scan.scannerVersion,
    block: view.scan.scanBlockNumber ? Number(view.scan.scanBlockNumber) : null,
    dataSource: `${chainByNumericId(view.scan.chainId)?.label ?? "Chain"} RPC`,
    scannedAt: view.scan.completedAt ?? view.scan.submittedAt,
    ...(view.scan.firstScannedAt ? { firstScannedAt: view.scan.firstScannedAt } : {}),
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
