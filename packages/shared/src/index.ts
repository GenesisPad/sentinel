export const scannerVersion = "0.1.0-foundation";

export const supportedChains = [
  {
    chainId: 4663,
    name: "Robinhood Chain",
    implemented: true
  }
] as const;

export type ScanState =
  | "QUEUED"
  | "RESOLVING_CHAIN"
  | "FETCHING_CONTRACT"
  | "ANALYZING_CONTRACT"
  | "DISCOVERING_MARKETS"
  | "ANALYZING_HOLDERS"
  | "SIMULATING_TRADES"
  | "SCORING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED";

export type ScanStageStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export type CheckOutcome =
  "DETECTED" | "PASSED" | "UNSUPPORTED" | "FAILED" | "INCONCLUSIVE" | "DATA_UNAVAILABLE";

export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type FindingConfidence = "LOW" | "MEDIUM" | "HIGH";

export type RiskCategory =
  | "CONTRACT_CONTROL"
  | "TRADING_SAFETY"
  | "LIQUIDITY_SAFETY"
  | "DISTRIBUTION_RISK"
  | "REPUTATION_RISK";

export type RiskLevel =
  | "LOW"
  | "MODERATE"
  | "ELEVATED"
  | "HIGH"
  | "CRITICAL"
  | "UNABLE_TO_ASSESS";

export type OwnershipStatus = "RENOUNCED" | "ACTIVE" | "UNKNOWN";

export type EvidenceType =
  | "FUNCTION"
  | "EVENT"
  | "STORAGE"
  | "BYTECODE"
  | "TRANSACTION_TRACE"
  | "SIMULATION"
  | "HOLDER_DATA"
  | "LIQUIDITY_DATA"
  | "EXTERNAL_SOURCE";

export interface FindingEvidence {
  type: EvidenceType;
  summary: string;
  data: Record<string, unknown>;
  blockNumber?: bigint;
  transactionHash?: `0x${string}`;
  address?: `0x${string}`;
}

export interface SecurityFinding {
  code: string;
  detectorId: string;
  detectorVersion: string;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  confidence: FindingConfidence;
  description: string;
  technicalExplanation: string;
  evidence: FindingEvidence[];
  recommendation?: string;
}

export interface CategoryScore {
  category: RiskCategory;
  score: number;
  confidence: FindingConfidence;
  explanation?: string;
}

/**
 * A single finding's contribution to its category score, persisted so the overall score is
 * reconstructible and auditable after the fact, not just the aggregate number.
 */
export interface FindingContribution {
  code: string;
  category: RiskCategory;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  weight: number;
}

export interface RiskAssessment {
  /** Null only when `level` is `UNABLE_TO_ASSESS` — never a stand-in for a low-risk score. */
  score: number | null;
  level: RiskLevel;
  confidence: FindingConfidence;
  categoryScores: CategoryScore[];
  scannerVersion: string;
  findingContributions: FindingContribution[];
  /** Evidence gaps (unsupported/unavailable/inconclusive/failed checks) that were not treated
   * as low risk. Non-empty even when a numeric score was produced, whenever some category's
   * evidence was incomplete. */
  unableToAssessReasons: string[];
}

export const riskScoreRange = {
  minimum: 0,
  maximum: 100
} as const;

export const riskScoreDirection =
  "Risk Score: 0=minimal detected risk, 100=maximum detected risk. Higher score means greater risk." as const;

export function riskLevelForScore(score: number): Exclude<RiskLevel, "UNABLE_TO_ASSESS"> {
  assertRiskScore(score);

  if (score >= 80) {
    return "CRITICAL";
  }

  if (score >= 60) {
    return "HIGH";
  }

  if (score >= 40) {
    return "ELEVATED";
  }

  if (score >= 20) {
    return "MODERATE";
  }

  return "LOW";
}

export interface ServiceHealth {
  status: "ok";
  service: string;
  version: string;
  time: string;
}

export interface ReadinessDependency {
  name: "postgres" | "redis";
  status: "ok" | "error";
  message?: string;
}

export interface ServiceReadiness {
  status: "ready" | "not_ready";
  service: string;
  version: string;
  time: string;
  dependencies: ReadinessDependency[];
}

export interface ScanProgress {
  scanId: string;
  chainId: number;
  address: `0x${string}`;
  state: ScanState;
  scannerVersion: string;
  submittedAt: string;
  message: string;
  scanBlockNumber?: string;
  completedAt?: string;
}

export interface FindingEvidenceView {
  type: EvidenceType;
  summary: string;
  data: Record<string, unknown>;
  blockNumber?: string;
  transactionHash?: `0x${string}`;
  address?: `0x${string}`;
}

export interface SecurityFindingView {
  id: string;
  code: string;
  detectorId: string;
  detectorVersion: string;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  confidence: FindingConfidence;
  description: string;
  technicalExplanation: string;
  evidence: FindingEvidenceView[];
  recommendation?: string;
}

export interface DetectorCheckView {
  id: string;
  detectorResultId: string;
  detectorId: string;
  detectorVersion: string;
  code: string;
  outcome: CheckOutcome;
  confidence: FindingConfidence;
  evidence: FindingEvidenceView[];
  errorMessage?: string;
}

export interface ScanResultView {
  scan: ScanProgress;
  token: TokenProfileView;
  detectorChecks: DetectorCheckView[];
  findings: SecurityFindingView[];
  liquidity: LiquiditySummaryView;
  holders: HolderSummaryView;
  simulations: SimulationRunView[];
  risk: RiskSnapshot;
}

export interface TokenProfileView {
  chainId: number;
  address: `0x${string}`;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  holderCount?: number;
  sourceVerified?: boolean;
  ownerAddress?: `0x${string}`;
  ownershipStatus?: OwnershipStatus;
  deployerAddress?: `0x${string}`;
  contractCreatedAt?: string;
  creationTxHash?: `0x${string}`;
  tokenType?: string;
  iconUrl?: string;
  reputation?: string;
  priceUsd?: string;
  marketCapUsd?: string;
  volume24hUsd?: string;
  metadataUpdatedAt?: string;
}

export interface HolderSnapshotView {
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: string;
  holderCount?: number;
  topHolders: Record<string, unknown>;
  concentration?: Record<string, unknown>;
  createdAt: string;
}

export interface HolderSummaryView {
  status: "AVAILABLE" | "UNSUPPORTED" | "NOT_FOUND";
  snapshots: HolderSnapshotView[];
  message: string;
}

export interface LiquidityPoolView {
  chainId: number;
  tokenAddress: `0x${string}`;
  poolAddress: `0x${string}`;
  dex?: string;
  quoteTokenAddress?: `0x${string}`;
  firstObservedBlock?: string;
  lastObservedBlock?: string;
  liquidityData?: Record<string, unknown>;
}

export interface LiquiditySummaryView {
  status: "AVAILABLE" | "UNSUPPORTED" | "NOT_FOUND";
  pools: LiquidityPoolView[];
  message: string;
}

export type SimulationKind = "BUY" | "SELL" | "TRANSFER";

export interface SimulationRunView {
  id: string;
  kind: SimulationKind;
  outcome: CheckOutcome;
  blockNumber?: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  revertReason?: string;
  gasUsed?: string;
  simulationTool: string;
  createdAt: string;
}

/** One row for the public "recent detections" feed — only scans with a real, persisted numeric
 * score are eligible, so an UNABLE_TO_ASSESS scan never shows up looking like a risk verdict. */
export interface RecentScanView {
  chainId: number;
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  scannedAt: string;
}

export interface RiskSnapshot {
  chainId: number;
  address: `0x${string}`;
  scannerVersion: string;
  status: "AVAILABLE" | "UNABLE_TO_ASSESS";
  level: RiskLevel;
  score: number | null;
  confidence: FindingConfidence;
  categoryScores: CategoryScore[];
  findingContributions: FindingContribution[];
  unableToAssessReasons: string[];
  findingCounts: Record<FindingSeverity, number>;
  message: string;
}

export interface DeployerHistoryEntryView {
  chainId: number;
  tokenAddress: `0x${string}`;
  scanId: string;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  highOrCriticalFindingCount: number;
  scannedAt: string;
}

/**
 * Deployer/wallet intelligence (Milestone 6) built entirely from Sentinel's own prior scan
 * history — never an external reputation service or "known scammer" list. Absence of history
 * means no prior scans were found, not that the deployer is clean.
 */
export interface DeployerHistoryView {
  deployerAddress: `0x${string}`;
  previousTokenCount: number;
  previousHighOrCriticalCount: number;
  entries: DeployerHistoryEntryView[];
}

export interface BytecodeReuseView {
  bytecodeHash: string;
  reusedByCount: number;
  reusedByAddresses: `0x${string}`[];
}

export type RelatedWalletEdgeType =
  | "FUNDED_BY"
  | "DEPLOYED_BY"
  | "OWNED_BY"
  | "PREVIOUSLY_OWNED_BY"
  | "SHARED_BYTECODE"
  | "TRANSFERRED_SUPPLY_TO";

/**
 * A single wallet-relationship edge with its own evidence and confidence — never inferred
 * from timing coincidence alone (e.g. two wallets buying near the same time is NOT sufficient
 * evidence for an edge). Each edge names the concrete on-chain observation that produced it.
 */
export interface RelatedWalletEdge {
  type: RelatedWalletEdgeType;
  address: `0x${string}`;
  confidence: FindingConfidence;
  evidence: string;
  source: string;
  firstObservedBlock?: string;
}

export function createHealth(service: string): ServiceHealth {
  return {
    status: "ok",
    service,
    version: scannerVersion,
    time: new Date().toISOString()
  };
}

export function createScanId(
  chainId: number,
  address: `0x${string}`,
  idempotencyKey: string
): string {
  return `${chainId}:${address.toLowerCase()}:${idempotencyKey}`;
}

export function normalizeEvmAddress(address: `0x${string}`): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

export type ApiUsageKind =
  | "CACHED_LOOKUP"
  | "FRESH_SCAN"
  | "DEEP_SIMULATION"
  | "PROVIDER_HEAVY"
  | "FAILED_REQUEST"
  | "RATE_LIMIT_EVENT";

/** Safe API key view — never includes the hash or the plaintext secret. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned exactly once, at creation time. The plaintext key is never persisted or
 * retrievable again — only its hash is stored. */
export interface ApiKeyCreatedView extends ApiKeyView {
  key: string;
}

/** SSE event types for scan progress (GET /v1/scans/:scanId/events), matching the spec's
 * required event list. Polling (GET /v1/scans/:scanId) remains a full fallback. */
export type ScanEventType =
  | "scan.queued"
  | "scan.started"
  | "scan.stage.started"
  | "scan.stage.completed"
  | "scan.stage.inconclusive"
  | "scan.partial"
  | "scan.completed"
  | "scan.failed";

export interface ScanEvent {
  type: ScanEventType;
  scanId: string;
  data: Record<string, unknown>;
  emittedAt: string;
}

export function assertRiskScore(score: number): number {
  if (
    !Number.isInteger(score) ||
    score < riskScoreRange.minimum ||
    score > riskScoreRange.maximum
  ) {
    throw new Error("Risk score must be an integer from 0 to 100.");
  }

  return score;
}
