import type { ChainId } from "./chains";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Backend-authoritative status for a single scan stage. */
export type StageStatus =
  | "pending"
  | "running"
  | "passed"
  | "warning"
  | "failed"
  | "inconclusive"
  | "skipped"
  | "unsupported";

// Matches the backend's ScanState progression (packages/shared) one-to-one so stage status
// is always derived from a real backend value, never invented.
export type ScanStageKey =
  | "resolving_chain"
  | "fetching_contract"
  | "analyzing_contract"
  | "discovering_markets"
  | "analyzing_holders"
  | "simulating_trades"
  | "scoring";

export interface ScanStage {
  key: ScanStageKey;
  label: string;
  status: StageStatus;
  /** Optional short backend note, e.g. why a stage was skipped. */
  detail?: string;
}

/** Frontend-level scan lifecycle (distinct from per-stage status). */
export type ScanState =
  | "idle"
  | "validating"
  | "ready"
  | "submitting"
  | "queued"
  | "scanning"
  | "partial"
  | "completed"
  | "failed";

export type ScanResultStatus = "queued" | "running" | "completed" | "partial" | "failed";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  /** Longer plain-language "why this matters". */
  detail: string;
  technical?: string;
  affectedFunction?: string;
  controller?: string;
  block?: number;
  confidence?: "low" | "medium" | "high";
  recommendation?: string;
  detectorId?: string;
  detectorVersion?: string;
  evidence?: string;
}

export interface CheckSummary {
  critical: number;
  high: number;
  medium: number;
  passed: number;
}

export interface TradeSimulation {
  buyTaxBps?: number;
  sellTaxBps?: number;
  transferTaxBps?: number;
  maxSellTaxBps?: number;
  maxWalletBps?: number;
  /** null = not simulated yet (unsupported stub), not "confirmed not a honeypot". */
  isHoneypot: boolean | null;
  /** True only once a real buy simulation has succeeded — never assumed. */
  canBuy: boolean | null;
  /** True only once a real sell simulation has succeeded — never assumed. */
  canSell: boolean | null;
  results: Array<{
    label: string;
    status: "passed" | "failed" | "inconclusive";
    detail?: string;
  }>;
}

export interface LiquidityInfo {
  totalUsd: number | null;
  locked: boolean | null;
  lockedUntil?: string;
  deployerControlledPct?: number;
  burnedPct?: number;
  lockedPct?: number;
  lpOwner?: string;
  poolAddress?: string;
  dex?: string;
  /** Native/stablecoin side of the pool as a percentage of market cap: <10% low, 10-20%
   * medium, >20% healthy. Null when market cap or pool value isn't known. */
  quoteSidePctOfMarketCap?: number | null;
  healthTier?: "low" | "medium" | "healthy" | null;
}

export interface HolderInfo {
  top1Pct: number | null;
  top5Pct: number | null;
  top10Pct: number | null;
  holderCount?: number;
  clusteredWithDeployer?: number;
  devClusterPct?: number | null;
  devClusterWalletCount?: number;
  devClusterUnknownHoldingWalletCount?: number;
}

export type WalletClusterEdgeType =
  | "FUNDED_BY"
  | "DEPLOYED_BY"
  | "OWNED_BY"
  | "PREVIOUSLY_OWNED_BY"
  | "SHARED_BYTECODE"
  | "TRANSFERRED_SUPPLY_TO";

/** One real, evidenced wallet-relationship edge (Milestone 6) — never inferred from timing
 * coincidence. Mirrors the backend's RelatedWalletEdge shape for the web layer. */
export interface WalletClusterEdge {
  type: WalletClusterEdgeType;
  address: string;
  confidence: "low" | "medium" | "high";
  evidence: string;
  source: string;
  /** % of total supply this address holds, cross-referenced from the persisted top-holders
   * snapshot. Null/undefined when the address isn't in that snapshot (e.g. it fell outside the
   * top-N holders tracked) — never estimated. */
  holdingPct?: number | null;
}

export interface DevClusterInfo {
  walletCount: number;
  knownHoldingPct: number | null;
  unknownHoldingWalletCount: number;
}

export interface ContractControls {
  ownershipRenounced: boolean | null;
  canMint: boolean | null;
  canBlacklist: boolean | null;
  canPause: boolean | null;
  canChangeTaxes: boolean | null;
  isProxy: boolean | null;
  upgradeable: boolean | null;
  canLimitTransactions: boolean | null;
  canDisableTrading: boolean | null;
  hasFeeWhitelist: boolean | null;
}

export type OwnershipStatus = "renounced" | "active" | "unknown";

export interface TokenMeta {
  chainId: ChainId;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  // null = not checked yet, not "confirmed unverified" — the API has no source-verification
  // check implemented today.
  verified: boolean | null;
  totalSupply?: string;
  holders?: number;
  priceUsd?: string;
  marketCapUsd?: string;
  volume24hUsd?: string;
  /** Contract deployment time, when the backend can supply it. Not scan time. */
  createdAt?: string;
  deployer?: string;
  creationTxHash?: string;
  tokenType?: string;
  iconUrl?: string;
  reputation?: string;
  /** Whether DexScreener reports an approved "tokenProfile" order for this token — its "DEX
   * Paid" badge. Undefined when unknown (no market data provider, or the lookup failed). */
  dexPaid?: boolean;
  ownerAddress?: string;
  ownershipStatus?: OwnershipStatus;
}

/** Raw per-detector check outcome — the technical view's evidence trail. */
export interface DetectorCheckSummary {
  detectorId: string;
  code: string;
  outcome: "detected" | "passed" | "unsupported" | "failed" | "inconclusive" | "unavailable";
  confidence?: "low" | "medium" | "high";
}

/** The single canonical report consumed by BOTH the homepage result and /token/... */
export interface ScanReport {
  scanId: string;
  status: ScanResultStatus;
  token: TokenMeta;
  /** 0 = minimal detected risk, 100 = maximum detected risk. Higher score means greater risk. */
  riskScore: number | null;
  scoreExplanation: string;
  checks: CheckSummary;
  stages: ScanStage[];
  findings: Finding[];
  controls: ContractControls;
  simulation: TradeSimulation;
  liquidity: LiquidityInfo;
  holders: HolderInfo;
  devCluster: DevClusterInfo;
  /** Real, evidenced wallet-relationship edges (Milestone 6) — empty when none were found. */
  walletCluster: WalletClusterEdge[];
  scannerVersion: string;
  block: number | null;
  dataSource: string;
  scannedAt: string;
  /** Set when this payload is served from cache. */
  cachedAt?: string;
  /** Present on partial reports: human-readable list of what could not complete. */
  incomplete?: string[];
  /** Raw per-detector outcomes for the technical view. Empty until the backend exposes them. */
  detectorChecks: DetectorCheckSummary[];
}

export interface ScanJob {
  scanId: string;
  status: ScanResultStatus;
  stages: ScanStage[];
  token?: Partial<TokenMeta>;
}

export interface RecentScan {
  chainId: ChainId;
  address: string;
  name: string;
  symbol: string;
  riskScore: number;
  riskLevel?: string;
  scannedAt: string;
}
