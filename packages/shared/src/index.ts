export const scannerVersion = "0.1.0-foundation";

export const supportedChains = [
  {
    chainId: 4663,
    name: "Robinhood Chain",
    implemented: true
  },
  {
    chainId: 5042,
    name: "Arc Chain",
    implemented: true
  },
  {
    chainId: 988,
    name: "Stable Chain",
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

export type RiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "CRITICAL" | "UNABLE_TO_ASSESS";

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
  /** When this token was first ever scanned (across all scans for this chainId+address, not
   * just this one) — undefined only when the lookup wasn't performed, never a guess. */
  firstScannedAt?: string;
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
  /** Whether DexScreener reports an approved "tokenProfile" order for this token — the
   * documented meaning of its "DEX Paid" badge. Undefined when unknown. */
  dexPaid?: boolean;
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

export interface AnalyticsSeriesPoint {
  date: string;
  scans: number;
}

export interface AnalyticsBreakdownItem {
  key: string;
  label: string;
  count: number;
}

export interface AnalyticsTrendingToken {
  chainId: number;
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  scans: number;
  lastScannedAt: string;
}

export interface PublicAnalyticsView {
  generatedAt: string;
  totals: {
    tokensAnalyzed: number;
    scansCompleted: number;
    uniqueContracts: number;
    highRiskTokens: number;
    riskSignals: number;
    honeypots: number;
    highTaxTokens: number;
    dangerousLiquidityTokens: number;
    concentratedHolderTokens: number;
    privilegedControlTokens: number;
    analyzedLiquidityUsd: number;
    uniqueUsers: number;
    totalVisits: number;
  };
  activity: {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
    averagePerDay: number;
    sevenDayGrowthPct: number | null;
    thirtyDayGrowthPct: number | null;
    daily: AnalyticsSeriesPoint[];
  };
  riskCategories: AnalyticsBreakdownItem[];
  frequentRisks: AnalyticsBreakdownItem[];
  trendingTokens: AnalyticsTrendingToken[];
  coverage: AnalyticsBreakdownItem[];
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
  /** Raw token balance held by this address, read directly on-chain at the scan block. Present
   * for every clustered wallet, not just those inside the top-holder snapshot. */
  balanceRaw?: string;
  /** `balanceRaw` as a percentage of total supply. Absent when supply is unknown. */
  holdingPct?: number;
}

export type SecuritySignalAnswer = "YES" | "NO" | "UNKNOWN";

export type SecuritySignalSeverity = "GOOD" | "INFO" | "WARN" | "HIGH" | "CRITICAL";

export type SecuritySignalSource =
  "DETECTOR" | "SIMULATION" | "TOKEN_PROFILE" | "MISSING_DATA" | "NOT_IMPLEMENTED";

export interface SecuritySummarySignal {
  id: string;
  label: string;
  answer: SecuritySignalAnswer;
  severity: SecuritySignalSeverity;
  confidence: FindingConfidence;
  source: SecuritySignalSource;
  description: string;
  evidenceCodes: string[];
  value?: string;
}

export interface DevClusterWalletView {
  address: `0x${string}`;
  role: RelatedWalletEdgeType;
  holdingPct: number | null;
  confidence: FindingConfidence;
  evidence: string;
}

export interface DevClusterSummaryView {
  walletCount: number;
  knownHoldingPct: number | null;
  unknownHoldingWalletCount: number;
  wallets: DevClusterWalletView[];
}

export interface DeployerBalanceView {
  amountRaw: string | null;
  pctOfSupply: number | null;
}

export interface TaxSummaryView {
  status: "AVAILABLE" | "UNKNOWN";
  buyTaxBps: number | null;
  buyTaxPct: number | null;
  sellTaxBps: number | null;
  sellTaxPct: number | null;
  source: "SIMULATION";
}

export interface TokenSecuritySummaryView {
  chainId: number;
  address: `0x${string}`;
  scanId: string;
  scannerVersion: string;
  scannedAt: string;
  product: "Genesis Sentinel";
  risk: RiskSnapshot;
  issueCount: number;
  fullAnalysisUrl?: string;
  devCluster: DevClusterSummaryView;
  deployerBalance: DeployerBalanceView | null;
  taxes: TaxSummaryView;
  signals: SecuritySummarySignal[];
}

export interface TokenSecuritySummaryOptions {
  webAppUrl?: string;
}

const OWNER_DEPENDENT_CONTROL_FINDING_CODES = new Set([
  "OWNERSHIP_CONTROL_SURFACE",
  "BLACKLIST_CAPABILITY_SURFACE",
  "PAUSE_CAPABILITY_SURFACE",
  "MAX_TRANSACTION_CAPABILITY_SURFACE",
  "COOLDOWN_CAPABILITY_SURFACE",
  "TRADING_CONTROL_SURFACE",
  "FEE_EXCLUSION_CAPABILITY_SURFACE",
  "SOURCE_BLACKLIST_CONTROL",
  "SOURCE_TRADING_COOLDOWN_CONTROL",
  "SOURCE_TRADING_TOGGLE",
  "SOURCE_TAX_OR_LIMIT_CONTROL",
  "SOURCE_ROUTER_OR_PAIR_REPLACEMENT"
]);

const ALTERNATE_AUTHORITY_FINDING_CODES = new Set([
  "PROXY_OR_UPGRADE_SURFACE",
  "EIP1967_PROXY_DETECTED",
  "EIP1967_BEACON_PROXY_DETECTED",
  "PROXY_ADMIN_CONTROLLED",
  "SOURCE_OWNERSHIP_RECOVERY_SURFACE",
  "SOURCE_PRIVILEGED_ROLE_CONTROL",
  "PRIVILEGED_ROLE_ACTIVE",
  "SOURCE_OBFUSCATED_ADDRESS",
  "RENOUNCED_BUT_EXTERNALLY_GATED",
  "TRANSFER_GATE_ALLOWLIST"
]);

/**
 * A burned owner makes ordinary onlyOwner-style knobs unreachable. Preserve their raw detector
 * checks as technical evidence, but do not present or score them as active risks unless separate
 * evidence shows another authority path survives renouncement.
 */
export function effectiveFindingsAfterOwnershipRenouncement<T extends { code: string }>(
  findings: readonly T[],
  ownershipRenounced: boolean
): T[] {
  if (
    !ownershipRenounced ||
    findings.some((finding) => ALTERNATE_AUTHORITY_FINDING_CODES.has(finding.code))
  ) {
    return [...findings];
  }
  return findings.filter(
    (finding) => !OWNER_DEPENDENT_CONTROL_FINDING_CODES.has(finding.code)
  );
}

const FINDING_CODES = {
  blacklist: ["BLACKLIST_CAPABILITY_SURFACE", "SOURCE_BLACKLIST_CONTROL"],
  hiddenOwner: ["SOURCE_OWNERSHIP_RECOVERY_SURFACE", "SOURCE_PRIVILEGED_ROLE_CONTROL"],
  obfuscatedAddress: ["SOURCE_OBFUSCATED_ADDRESS"],
  suspiciousFunctions: [
    "DELEGATECALL_OPCODE_PRESENT",
    "SELFDESTRUCT_OPCODE_PRESENT",
    "SOURCE_ADMIN_TRANSFER_SURFACE",
    "SOURCE_ARBITRARY_EXTERNAL_CALL",
    "SOURCE_ROUTER_OR_PAIR_REPLACEMENT"
  ],
  proxy: [
    "PROXY_OR_UPGRADE_SURFACE",
    "EIP1967_PROXY_DETECTED",
    "EIP1967_BEACON_PROXY_DETECTED",
    "EIP1167_MINIMAL_PROXY_DETECTED"
  ],
  mint: ["MINT_CAPABILITY_SURFACE", "SOURCE_MINT_OR_SUPPLY_CONTROL"],
  pause: ["PAUSE_CAPABILITY_SURFACE"],
  cooldown: ["COOLDOWN_CAPABILITY_SURFACE", "SOURCE_TRADING_COOLDOWN_CONTROL"],
  tradingControl: ["TRADING_CONTROL_SURFACE", "SOURCE_TRADING_TOGGLE"],
  whitelist: ["FEE_EXCLUSION_CAPABILITY_SURFACE"],
  ownershipActive: ["OWNERSHIP_NOT_RENOUNCED"],
  ownershipRenounced: ["OWNERSHIP_RENOUNCED"]
} as const;

const CHECK_CODES = {
  blacklist: ["BLACKLIST_SELECTORS_PRESENT"],
  blacklistSourceAbsent: ["SOURCE_BLACKLIST_CONTROL_ABSENT"],
  hiddenOwnerAbsent: [
    "SOURCE_OWNERSHIP_RECOVERY_SURFACE_ABSENT",
    "SOURCE_PRIVILEGED_ROLE_CONTROL_ABSENT"
  ],
  obfuscatedAddress: ["SOURCE_OBFUSCATED_ADDRESS_DETECTED"],
  obfuscatedAddressAbsent: ["SOURCE_OBFUSCATED_ADDRESS_ABSENT"],
  suspiciousAbsent: [
    "DELEGATECALL_OPCODE_ABSENT",
    "SELFDESTRUCT_OPCODE_ABSENT",
    "SOURCE_ADMIN_TRANSFER_SURFACE_ABSENT",
    "SOURCE_ARBITRARY_EXTERNAL_CALL_ABSENT",
    "SOURCE_ROUTER_OR_PAIR_REPLACEMENT_ABSENT"
  ],
  proxy: ["PROXY_SELECTORS_PRESENT"],
  proxyAbsent: ["PROXY_SELECTORS_PRESENT", "EIP1967_PROXY_ABSENT"],
  mint: ["MINT_SELECTORS_PRESENT"],
  pause: ["PAUSE_SELECTORS_PRESENT"],
  cooldown: ["COOLDOWN_SELECTORS_PRESENT"],
  whitelist: ["FEE_EXCLUSION_SELECTORS_PRESENT"],
  ownershipRenounced: ["OWNERSHIP_RENOUNCED"],
  ownershipActive: ["OWNERSHIP_ACTIVE"]
} as const;

export function buildTokenSecuritySummary(
  result: ScanResultView,
  options: TokenSecuritySummaryOptions = {}
): TokenSecuritySummaryView {
  const ownershipRenounced = result.token.ownershipStatus === "RENOUNCED";
  const effectiveFindings = effectiveFindingsAfterOwnershipRenouncement(
    result.findings,
    ownershipRenounced
  );
  const ownerControlsNeutralized =
    ownershipRenounced && effectiveFindings.length < result.findings.length;
  const context = createSecuritySignalContext(
    { ...result, findings: effectiveFindings },
    ownerControlsNeutralized
      ? new Set([
          "BLACKLIST_SELECTORS_PRESENT",
          "PAUSE_SELECTORS_PRESENT",
          "MAX_TRANSACTION_SELECTORS_PRESENT",
          "COOLDOWN_SELECTORS_PRESENT",
          "TRADING_CONTROL_SELECTORS_PRESENT",
          "FEE_EXCLUSION_SELECTORS_PRESENT",
          "SOURCE_BLACKLIST_CONTROL",
          "SOURCE_TRADING_COOLDOWN_CONTROL",
          "SOURCE_TRADING_TOGGLE",
          "SOURCE_TAX_OR_LIMIT_CONTROL"
        ])
      : undefined
  );
  const highIssueSeverities = new Set<FindingSeverity>(["HIGH", "CRITICAL"]);
  const fullAnalysisUrl = buildFullAnalysisUrl(
    options.webAppUrl,
    result.token.chainId,
    result.token.address
  );
  const devCluster = buildDevClusterSummary(result);
  const deployerBalance = buildDeployerBalance(result);
  const taxes = buildTaxSummary(result);

  const summary: TokenSecuritySummaryView = {
    chainId: result.token.chainId,
    address: result.token.address,
    scanId: result.scan.scanId,
    scannerVersion: result.scan.scannerVersion,
    scannedAt: result.scan.completedAt ?? result.scan.submittedAt,
    product: "Genesis Sentinel",
    risk: result.risk,
    issueCount: effectiveFindings.filter((finding) => highIssueSeverities.has(finding.severity))
      .length,
    devCluster,
    deployerBalance,
    taxes,
    signals: [
      detectorSignal(context, {
        id: "can_block_wallets",
        label: "Can block wallets",
        description:
          "Whether the contract appears able to block specific wallets from transferring or selling.",
        yesFindings: FINDING_CODES.blacklist,
        detectedChecks: CHECK_CODES.blacklist,
        noChecks: [...CHECK_CODES.blacklist, ...CHECK_CODES.blacklistSourceAbsent]
      }),
      detectorSignal(context, {
        id: "hidden_owner_controls",
        label: "Hidden owner/admin controls",
        description:
          "Whether source analysis found owner recovery, privileged roles, or similar hidden admin control paths.",
        yesFindings: FINDING_CODES.hiddenOwner,
        noChecks: CHECK_CODES.hiddenOwnerAbsent
      }),
      detectorSignal(context, {
        id: "obfuscated_address",
        label: "Hidden or obfuscated addresses",
        description:
          "Whether verified source code reconstructs or masks address constants instead of declaring them plainly.",
        yesFindings: FINDING_CODES.obfuscatedAddress,
        detectedChecks: CHECK_CODES.obfuscatedAddress,
        noChecks: CHECK_CODES.obfuscatedAddressAbsent
      }),
      detectorSignal(context, {
        id: "suspicious_functions",
        label: "Suspicious functions",
        description: "Whether dangerous opcodes or high-risk admin surfaces were detected.",
        yesFindings: FINDING_CODES.suspiciousFunctions,
        noChecks: CHECK_CODES.suspiciousAbsent
      }),
      honeypotSignal(result),
      taxSignal(
        "buy_tax",
        "Buy tax",
        "Measured buy-side token tax from trade simulation.",
        taxes.buyTaxBps
      ),
      taxSignal(
        "sell_tax",
        "Sell tax",
        "Measured sell-side token tax from trade simulation.",
        taxes.sellTaxBps
      ),
      detectorSignal(context, {
        id: "proxy_contract",
        label: "Proxy contract",
        description: "Whether the token appears upgradeable or routed through a proxy contract.",
        yesFindings: FINDING_CODES.proxy,
        detectedChecks: CHECK_CODES.proxy,
        noChecks: CHECK_CODES.proxyAbsent
      }),
      detectorSignal(context, {
        id: "can_create_more_tokens",
        label: "Can create more tokens",
        description: "Whether minting or supply-changing controls were detected.",
        yesFindings: FINDING_CODES.mint,
        detectedChecks: CHECK_CODES.mint,
        noChecks: CHECK_CODES.mint
      }),
      detectorSignal(context, {
        id: "can_pause_transfers",
        label: "Can pause transfers",
        description: "Whether the contract appears able to pause token transfers.",
        yesFindings: FINDING_CODES.pause,
        detectedChecks: CHECK_CODES.pause,
        noChecks: CHECK_CODES.pause
      }),
      detectorSignal(context, {
        id: "trading_cooldown",
        label: "Trading cooldown",
        description:
          "Whether cooldown, transfer-delay, anti-bot, or anti-snipe controls were detected.",
        yesFindings: FINDING_CODES.cooldown,
        detectedChecks: CHECK_CODES.cooldown,
        noChecks: CHECK_CODES.cooldown
      }),
      devClusterSignal(devCluster),
      detectorSignal(context, {
        id: "has_whitelist",
        label: "Whitelist or exempt wallets",
        description:
          "Whether fee, limit, or trading exemptions for selected wallets were detected.",
        yesFindings: FINDING_CODES.whitelist,
        detectedChecks: CHECK_CODES.whitelist,
        noChecks: CHECK_CODES.whitelist
      }),
      ownershipSignal(result),
      creatorAddressSignal(result)
    ]
  };

  if (fullAnalysisUrl) {
    summary.fullAnalysisUrl = fullAnalysisUrl;
  }

  return summary;
}

interface SecuritySignalContext {
  findingCodes: Set<string>;
  findingSeveritiesByCode: Map<string, FindingSeverity>;
  checkCodesByOutcome: Map<CheckOutcome, Set<string>>;
}

function createSecuritySignalContext(
  result: ScanResultView,
  ignoredDetectedCheckCodes?: ReadonlySet<string>
): SecuritySignalContext {
  const checkCodesByOutcome = new Map<CheckOutcome, Set<string>>();
  for (const check of result.detectorChecks) {
    const codes = checkCodesByOutcome.get(check.outcome) ?? new Set<string>();
    if (!(check.outcome === "DETECTED" && ignoredDetectedCheckCodes?.has(check.code))) {
      codes.add(check.code);
    }
    checkCodesByOutcome.set(check.outcome, codes);
  }

  return {
    findingCodes: new Set(result.findings.map((finding) => finding.code)),
    findingSeveritiesByCode: new Map(
      result.findings.map((finding) => [finding.code, finding.severity])
    ),
    checkCodesByOutcome
  };
}

function detectorSignal(
  context: SecuritySignalContext,
  input: {
    id: string;
    label: string;
    description: string;
    yesFindings: readonly string[];
    detectedChecks?: readonly string[];
    noChecks?: readonly string[];
  }
): SecuritySummarySignal {
  const evidenceCodes = [
    ...input.yesFindings.filter((code) => context.findingCodes.has(code)),
    ...(input.detectedChecks ?? []).filter((code) => hasCheck(context, "DETECTED", code))
  ];

  if (evidenceCodes.length > 0) {
    const findingSeverities = input.yesFindings
      .map((code) => context.findingSeveritiesByCode.get(code))
      .filter((severity): severity is FindingSeverity => severity !== undefined);
    return {
      id: input.id,
      label: input.label,
      answer: "YES",
      severity:
        findingSeverities.length > 0
          ? signalSeverityForFindings(findingSeverities)
          : "HIGH",
      confidence: "HIGH",
      source: "DETECTOR",
      description: input.description,
      evidenceCodes: unique(evidenceCodes)
    };
  }

  const noEvidenceCodes = (input.noChecks ?? []).filter((code) =>
    hasCheck(context, "PASSED", code)
  );
  if (noEvidenceCodes.length > 0) {
    return {
      id: input.id,
      label: input.label,
      answer: "NO",
      severity: "GOOD",
      confidence: "MEDIUM",
      source: "DETECTOR",
      description: input.description,
      evidenceCodes: unique(noEvidenceCodes)
    };
  }

  return unknownSignal(input.id, input.label, input.description, "MISSING_DATA");
}

function honeypotSignal(result: ScanResultView): SecuritySummarySignal {
  const simulation = result.simulations.find((run) => typeof run.result?.isHoneypot === "boolean");
  if (!simulation || typeof simulation.result?.isHoneypot !== "boolean") {
    return unknownSignal(
      "honeypot",
      "Honeypot",
      "Whether a sell simulation indicates buyers may be unable to sell.",
      "MISSING_DATA"
    );
  }

  const value = simulation.result.isHoneypot;
  return {
    id: "honeypot",
    label: "Honeypot",
    answer: value ? "YES" : "NO",
    severity: value ? "CRITICAL" : "GOOD",
    confidence: "HIGH",
    source: "SIMULATION",
    description: "Whether a sell simulation indicates buyers may be unable to sell.",
    evidenceCodes: [simulation.kind, simulation.outcome]
  };
}

function buildTaxSummary(result: ScanResultView): TaxSummaryView {
  const buyTaxBps =
    simulationNumber(result, "BUY", "buyTaxBps") ?? simulationNumber(result, "BUY", "taxBps");
  const sellTaxBps =
    simulationNumber(result, "SELL", "sellTaxBps") ?? simulationNumber(result, "SELL", "taxBps");

  return {
    status: buyTaxBps === null && sellTaxBps === null ? "UNKNOWN" : "AVAILABLE",
    buyTaxBps,
    buyTaxPct: bpsToPctNumber(buyTaxBps),
    sellTaxBps,
    sellTaxPct: bpsToPctNumber(sellTaxBps),
    source: "SIMULATION"
  };
}

function taxSignal(
  id: string,
  label: string,
  description: string,
  taxBps: number | null
): SecuritySummarySignal {
  if (taxBps === null) {
    return unknownSignal(id, label, description, "MISSING_DATA");
  }

  return {
    id,
    label,
    answer: taxBps > 0 ? "YES" : "NO",
    severity: taxSeverity(taxBps),
    confidence: "HIGH",
    source: "SIMULATION",
    description,
    evidenceCodes: ["SIMULATION_TAX_BPS"],
    value: formatTaxPct(taxBps)
  };
}

function simulationNumber(
  result: ScanResultView,
  kind: SimulationKind,
  field: string
): number | null {
  const run = result.simulations.find((simulation) => simulation.kind === kind);
  const value = run?.result?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bpsToPctNumber(value: number | null): number | null {
  return value === null ? null : Math.round((value / 100) * 100) / 100;
}

function formatTaxPct(value: number): string {
  return `${bpsToPctNumber(value)
    ?.toFixed(2)
    .replace(/\.?0+$/u, "")}%`;
}

function taxSeverity(value: number): SecuritySignalSeverity {
  if (value >= 2_000) return "HIGH";
  if (value >= 500) return "WARN";
  if (value > 0) return "INFO";
  return "GOOD";
}

function ownershipSignal(result: ScanResultView): SecuritySummarySignal {
  if (result.token.ownershipStatus === "RENOUNCED") {
    return {
      id: "ownership_renounced",
      label: "Ownership renounced",
      answer: "YES",
      severity: "GOOD",
      confidence: "HIGH",
      source: "TOKEN_PROFILE",
      description: "Whether the token owner has been renounced.",
      evidenceCodes: ["TOKEN_PROFILE_OWNERSHIP_RENOUNCED"]
    };
  }

  if (result.token.ownershipStatus === "ACTIVE") {
    return {
      id: "ownership_renounced",
      label: "Ownership renounced",
      answer: "NO",
      severity: "WARN",
      confidence: "HIGH",
      source: "TOKEN_PROFILE",
      description: "Whether the token owner has been renounced.",
      evidenceCodes: ["TOKEN_PROFILE_OWNERSHIP_ACTIVE"]
    };
  }

  const context = createSecuritySignalContext(result);
  const renouncedEvidence = [
    ...FINDING_CODES.ownershipRenounced.filter((code) => context.findingCodes.has(code)),
    ...CHECK_CODES.ownershipRenounced.filter((code) => hasCheck(context, "PASSED", code))
  ];
  if (renouncedEvidence.length > 0) {
    return {
      id: "ownership_renounced",
      label: "Ownership renounced",
      answer: "YES",
      severity: "GOOD",
      confidence: "MEDIUM",
      source: "DETECTOR",
      description: "Whether the token owner has been renounced.",
      evidenceCodes: unique(renouncedEvidence)
    };
  }

  const activeEvidence = [
    ...FINDING_CODES.ownershipActive.filter((code) => context.findingCodes.has(code)),
    ...CHECK_CODES.ownershipActive.filter((code) => hasCheck(context, "DETECTED", code))
  ];
  if (activeEvidence.length > 0) {
    return {
      id: "ownership_renounced",
      label: "Ownership renounced",
      answer: "NO",
      severity: "WARN",
      confidence: "MEDIUM",
      source: "DETECTOR",
      description: "Whether the token owner has been renounced.",
      evidenceCodes: unique(activeEvidence)
    };
  }

  return unknownSignal(
    "ownership_renounced",
    "Ownership renounced",
    "Whether the token owner has been renounced.",
    "MISSING_DATA"
  );
}

function creatorAddressSignal(result: ScanResultView): SecuritySummarySignal {
  if (!result.token.deployerAddress) {
    return unknownSignal(
      "creator_address",
      "Creator address",
      "The wallet or contract that deployed the token.",
      "MISSING_DATA"
    );
  }

  return {
    id: "creator_address",
    label: "Creator address",
    answer: "YES",
    severity: "INFO",
    confidence: "HIGH",
    source: "TOKEN_PROFILE",
    description: "The wallet or contract that deployed the token.",
    evidenceCodes: ["TOKEN_PROFILE_DEPLOYER_ADDRESS"],
    value: result.token.deployerAddress
  };
}

function devClusterSignal(cluster: DevClusterSummaryView): SecuritySummarySignal {
  if (cluster.walletCount === 0) {
    return {
      id: "dev_cluster",
      label: "Dev cluster",
      answer: "NO",
      severity: "GOOD",
      confidence: "MEDIUM",
      source: "DETECTOR",
      description:
        "Known supply held by the deployer wallet and wallets linked to it by on-chain evidence.",
      evidenceCodes: ["WALLET_CLUSTERING_EDGES_ABSENT"]
    };
  }

  const knownPct = cluster.knownHoldingPct;
  const severity: SecuritySignalSeverity =
    knownPct == null ? "INFO" : knownPct >= 20 ? "HIGH" : knownPct >= 10 ? "WARN" : "INFO";
  return {
    id: "dev_cluster",
    label: "Dev cluster",
    answer: knownPct != null && knownPct > 0 ? "YES" : "UNKNOWN",
    severity,
    confidence: cluster.unknownHoldingWalletCount > 0 ? "MEDIUM" : "HIGH",
    source: "DETECTOR",
    description:
      "Known supply held by the deployer wallet and wallets linked to it by on-chain evidence.",
    evidenceCodes: ["WALLET_CLUSTERING_EDGES_FOUND"],
    value:
      knownPct == null
        ? `${cluster.walletCount} linked wallet(s), holdings unknown`
        : `${formatSupplyPercentage(knownPct)} across ${cluster.walletCount} linked wallet(s)`
  };
}

function buildFullAnalysisUrl(
  webAppUrl: string | undefined,
  chainId: number,
  address: `0x${string}`
): string | undefined {
  if (!webAppUrl) return undefined;
  return `${webAppUrl.replace(/\/+$/u, "")}/token/${chainId}/${address}`;
}

/** Addresses that provably cannot trade: supply sent here is given up, not controlled. */
const burnOrZeroAddresses = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead"
]);

function buildDevClusterSummary(result: ScanResultView): DevClusterSummaryView {
  const holderPctByAddress = buildHolderPctLookup(result);
  const deployerPct = readDeployerPct(result);
  const walletsByAddress = new Map<string, DevClusterWalletView>();

  const addWallet = (
    address: `0x${string}`,
    role: RelatedWalletEdgeType,
    confidence: FindingConfidence,
    evidence: string,
    /** Balance read directly on-chain for this wallet, when the scan captured one. */
    directHoldingPct?: number | null
  ) => {
    const key = address.toLowerCase();
    // Burned supply is unsellable, so folding it into the dev cluster would overstate how much
    // the team can actually dump. Exclude it here too, not only at edge-discovery time, so
    // scans persisted before that filter existed are also reported correctly.
    if (burnOrZeroAddresses.has(key) || key === result.token.address.toLowerCase()) {
      return;
    }

    const existing = walletsByAddress.get(key);
    const next: DevClusterWalletView = {
      address,
      role,
      holdingPct: directHoldingPct ?? holderPctByAddress.get(key) ?? null,
      confidence,
      evidence
    };

    if (!existing || confidenceRank(next.confidence) > confidenceRank(existing.confidence)) {
      walletsByAddress.set(key, next);
    }
  };

  if (result.token.deployerAddress) {
    addWallet(
      result.token.deployerAddress,
      "DEPLOYED_BY",
      "HIGH",
      "Explorer token profile reports this address as the contract deployer.",
      deployerPct
    );
  }

  for (const edge of extractRelatedWalletEdges(result)) {
    addWallet(edge.address, edge.type, edge.confidence, edge.evidence, edge.holdingPct ?? null);
  }

  const wallets = [...walletsByAddress.values()].sort((a, b) => {
    const bPct = b.holdingPct ?? -1;
    const aPct = a.holdingPct ?? -1;
    return bPct - aPct;
  });
  const knownValues = wallets.flatMap((wallet) =>
    wallet.holdingPct == null ? [] : [wallet.holdingPct]
  );
  const knownHoldingPct =
    knownValues.length > 0 ? knownValues.reduce((total, pct) => total + pct, 0) : null;

  return {
    walletCount: wallets.length,
    knownHoldingPct,
    unknownHoldingWalletCount: wallets.filter((wallet) => wallet.holdingPct == null).length,
    wallets
  };
}

function readDeployerPct(result: ScanResultView): number | null {
  const snapshot = result.holders.snapshots[0];
  const concentration = snapshot?.concentration as
    { deployerPct?: number | null; deployerBalanceRaw?: string | null } | undefined;
  return (
    precisePctFromRaw(concentration?.deployerBalanceRaw, result.token.totalSupply) ??
    (typeof concentration?.deployerPct === "number" ? concentration.deployerPct : null)
  );
}

function buildDeployerBalance(result: ScanResultView): DeployerBalanceView | null {
  const deployerAddress = result.token.deployerAddress;
  if (!deployerAddress) return null;

  const snapshot = result.holders.snapshots[0];
  const concentration = snapshot?.concentration as
    { deployerPct?: number | null; deployerBalanceRaw?: string | null } | undefined;
  if (!concentration) return null;

  return {
    amountRaw:
      typeof concentration.deployerBalanceRaw === "string"
        ? concentration.deployerBalanceRaw
        : null,
    pctOfSupply:
      precisePctFromRaw(concentration.deployerBalanceRaw, result.token.totalSupply) ??
      (typeof concentration.deployerPct === "number" ? concentration.deployerPct : null)
  };
}

function buildHolderPctLookup(result: ScanResultView): Map<string, number> {
  const snapshot = result.holders.snapshots[0];
  const topHolders = snapshot?.topHolders as { holders?: unknown[] } | undefined;
  const lookup = new Map<string, number>();
  if (!Array.isArray(topHolders?.holders)) return lookup;

  for (const holder of topHolders.holders) {
    if (typeof holder !== "object" || holder === null) continue;
    const record = holder as Record<string, unknown>;
    const { address, totalSupplyPct, balanceRaw } = record;
    if (typeof address === "string") {
      const precise = precisePctFromRaw(balanceRaw, result.token.totalSupply);
      if (precise != null) {
        lookup.set(address.toLowerCase(), precise);
      } else if (typeof totalSupplyPct === "number") {
        lookup.set(address.toLowerCase(), totalSupplyPct);
      }
    }
  }

  return lookup;
}

function extractRelatedWalletEdges(result: ScanResultView): RelatedWalletEdge[] {
  const check = result.detectorChecks.find((item) => item.code === "WALLET_CLUSTERING_EDGES_FOUND");
  const edges = check?.evidence[0]?.data.edges;
  if (!Array.isArray(edges)) return [];

  return edges.flatMap((edge): RelatedWalletEdge[] => {
    if (typeof edge !== "object" || edge === null) return [];
    const record = edge as Record<string, unknown>;
    const { type, address, confidence, evidence, source, firstObservedBlock, balanceRaw } = record;
    if (
      !isRelatedWalletEdgeType(type) ||
      typeof address !== "string" ||
      !isEvmAddress(address) ||
      !isFindingConfidence(confidence) ||
      typeof evidence !== "string" ||
      typeof source !== "string"
    ) {
      return [];
    }

    const view: RelatedWalletEdge = {
      type,
      address,
      confidence,
      evidence,
      source
    };
    if (typeof firstObservedBlock === "string") {
      view.firstObservedBlock = firstObservedBlock;
    }
    if (typeof balanceRaw === "string") {
      view.balanceRaw = balanceRaw;
    }
    const holdingPct =
      precisePctFromRaw(balanceRaw, result.token.totalSupply) ??
      (typeof record.holdingPct === "number" ? record.holdingPct : null);
    if (holdingPct != null) {
      view.holdingPct = holdingPct;
    }
    return [view];
  });
}

function signalSeverityForFindings(
  severities: FindingSeverity[]
): SecuritySignalSeverity {
  if (severities.includes("CRITICAL")) return "CRITICAL";
  if (severities.includes("HIGH")) return "HIGH";
  if (severities.includes("MEDIUM") || severities.includes("LOW")) return "WARN";
  return "INFO";
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

function isRelatedWalletEdgeType(value: unknown): value is RelatedWalletEdgeType {
  return (
    value === "FUNDED_BY" ||
    value === "DEPLOYED_BY" ||
    value === "OWNED_BY" ||
    value === "PREVIOUSLY_OWNED_BY" ||
    value === "SHARED_BYTECODE" ||
    value === "TRANSFERRED_SUPPLY_TO"
  );
}

function isFindingConfidence(value: unknown): value is FindingConfidence {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

function isEvmAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function confidenceRank(confidence: FindingConfidence): number {
  if (confidence === "HIGH") return 3;
  if (confidence === "MEDIUM") return 2;
  return 1;
}

function unknownSignal(
  id: string,
  label: string,
  description: string,
  source: Extract<SecuritySignalSource, "MISSING_DATA" | "NOT_IMPLEMENTED">
): SecuritySummarySignal {
  return {
    id,
    label,
    answer: "UNKNOWN",
    severity: "INFO",
    confidence: "LOW",
    source,
    description,
    evidenceCodes: []
  };
}

function hasCheck(context: SecuritySignalContext, outcome: CheckOutcome, code: string): boolean {
  return context.checkCodesByOutcome.get(outcome)?.has(code) ?? false;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

/**
 * Pools are persisted in discovery order, not by liquidity size — a token can have many
 * near-empty or unused fee-tier pools alongside its real trading pool. Picking `pools[0]`
 * blindly showed "$0 liquidity" for tokens whose largest pool wasn't discovered first (verified
 * against $CASHCAT: pool 0 held $0.0000000000000037 while its real pool held $2.7M). The pool
 * with the highest totalLiquidityUsd is the one that actually matters to a trader. Shared so the
 * web app and the Telegram bot (which reads ScanResultView.liquidity.pools independently) can't
 * drift — this exact bug existed in both surfaces before this function was extracted.
 */
export function selectPrimaryLiquidityPool(
  pools: LiquidityPoolView[]
): LiquidityPoolView | undefined {
  return pools.reduce<LiquidityPoolView | undefined>((best, candidate) => {
    const candidateUsd = candidate.liquidityData?.totalLiquidityUsd;
    if (typeof candidateUsd !== "number") return best;
    const bestUsd = best?.liquidityData?.totalLiquidityUsd;
    return typeof bestUsd !== "number" || candidateUsd > bestUsd ? candidate : best;
  }, undefined);
}

export type LiquidityHealthTier = "low" | "medium" | "healthy";

// A fixed 10/20% threshold treats a $50K ultra-low-cap the same as a $50M mid-cap, which isn't
// how launchpad/DEX liquidity actually reads: smaller caps need deeper *relative* liquidity to
// resist sniper/whale drainage, while larger caps can be "healthy" at a much lower percentage
// because their absolute dollar depth is already large. Thresholds below follow this size-aware
// cheatsheet (quote-side USD as a % of market cap):
//   <$100K   (ultra-low-cap): low <10%,  medium 10-20%,  healthy >=20%
//   $100K-5M (low-cap):       low <5%,   medium 5-12%,   healthy >=12%
//   >=$5M    (micro/mid-cap): low <5%,   medium 5-10%,   healthy >=10%
// The cheatsheet's micro-cap ($5-6M) and mid-cap ($50-60M) brackets share identical thresholds,
// so they're merged into one ">=$5M" tier; the $100K-200K gap between its ultra-low and low-cap
// brackets is folded into the low-cap tier (the stricter/lower of the two nearby thresholds).
const LIQUIDITY_HEALTH_BRACKETS = [
  { maxMarketCapUsd: 100_000, healthyPct: 20, mediumPct: 10 },
  { maxMarketCapUsd: 5_000_000, healthyPct: 12, mediumPct: 5 },
  { maxMarketCapUsd: Infinity, healthyPct: 10, mediumPct: 5 }
] as const;

// Below this absolute dollar figure, liquidity is negligible no matter what the market cap
// ratio says — there is no market cap for which $50 of real liquidity is "fine" to trade
// against. This exists because the ratio-based brackets above require a market cap to compute
// a percentage; a token with no market cap data (e.g. a rugged/dead pool DexScreener no longer
// prices) would otherwise report a tier of null — read as neutral/unknown instead of the
// obvious red flag a near-zero dollar figure actually is. Verified against a real drained pool
// ($UHOOD): totalLiquidityUsd $0.175, no market cap data, LP 100% burned — the "LP burned" fact
// is true and irrelevant once the reserves themselves are gone via a huge sell (burning the LP
// token only prevents removeLiquidity(); it does nothing to stop a normal swap from draining
// the reserves).
export const NEGLIGIBLE_LIQUIDITY_USD = 250;

/**
 * Shared by the web app and the Telegram bot so a liquidity danger signal never exists in only
 * one surface — this exact rule was fixed once for the web (ADR 0036) and needed porting here
 * for Telegram to actually match, rather than risking the same false-safety-signal bug in a
 * second, independently-formatted surface.
 */
export function liquidityHealthTier(
  totalUsd: number,
  quoteSidePctOfMarketCap: number | null,
  marketCapUsd: number | null
): LiquidityHealthTier | null {
  if (totalUsd < NEGLIGIBLE_LIQUIDITY_USD) return "low";
  if (quoteSidePctOfMarketCap == null) return null;

  const [, , lastBracket] = LIQUIDITY_HEALTH_BRACKETS;
  const bracket =
    (marketCapUsd != null
      ? LIQUIDITY_HEALTH_BRACKETS.find((b) => marketCapUsd < b.maxMarketCapUsd)
      : undefined) ?? lastBracket;
  if (quoteSidePctOfMarketCap >= bracket.healthyPct) return "healthy";
  if (quoteSidePctOfMarketCap >= bracket.mediumPct) return "medium";
  return "low";
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.?0+$/u, "");
}

/**
 * Formats a USD amount with k/m/b suffixes ("$25m", "$50.5k") instead of a full comma-separated
 * number ("$25,000,000", "$50,500") — matches how these figures are actually said out loud, and
 * keeps market cap/volume readable in a compact chat message or card. Shared by the web app and
 * the Telegram bot so the two surfaces never drift into showing the same number two different
 * ways. Values under $1,000 use ordinary currency formatting (with extra precision below $1,
 * where a whole-dollar rounding would erase the only digits that matter) since abbreviating a
 * three-digit number saves no space and loses information.
 */
export function formatCompactUsd(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  if (numeric === 0) return "$0";

  const sign = numeric < 0 ? "-" : "";
  const abs = Math.abs(numeric);

  if (abs >= 1_000_000_000) return `${sign}$${trimTrailingZero((abs / 1_000_000_000).toFixed(2))}b`;
  if (abs >= 1_000_000) return `${sign}$${trimTrailingZero((abs / 1_000_000).toFixed(2))}m`;
  if (abs >= 1_000) return `${sign}$${trimTrailingZero((abs / 1_000).toFixed(2))}k`;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs < 1 ? 8 : 2
  }).format(numeric);
}

/**
 * A human-readable absolute date/time ("Jul 23, 2026, 1:28 AM UTC") instead of a raw ISO
 * timestamp. Fixed to UTC and labeled as such — the Telegram bot has no reliable per-user
 * timezone to convert to, and a labeled, consistent timezone beats a technically-local one that
 * silently disagrees with the timestamp another user in the same chat sees.
 */
export function formatHumanDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

/** Chain slug shared by DexScreener, GeckoTerminal, and the web app's own `/token/{slug}/...`
 * route (see apps/web/src/lib/chains.ts) for every chain Genesis Sentinel supports end-to-end.
 * Falls back to the numeric chain id for anything not in this list rather than guessing a slug
 * that would silently 404. */
export function chainMarketSlug(chainId: number): string {
  const slugs: Record<number, string> = {
    4663: "robinhood",
    5042: "arc",
    988: "stable"
  };
  return slugs[chainId] ?? String(chainId);
}

export function buildDexScreenerUrl(chainSlug: string, pairAddress: string): string {
  return `https://dexscreener.com/${chainSlug}/${pairAddress}`;
}

/** Formats supply ownership without rounding a real sub-0.01% balance down to zero. */
export function formatSupplyPercentage(value: number, maximumFractionDigits = 2): string {
  if (value > 0 && value < 0.01) return "<0.01%";
  if (value === 0) return "0%";
  return `${value.toFixed(maximumFractionDigits)}%`;
}

/** GeckoTerminal indexes pools DexScreener's API doesn't always return yet, so this is kept as a
 * fallback chart link alongside buildDexScreenerUrl. */
export function buildMarketChartUrl(chainSlug: string, pairAddress: string): string {
  return `https://www.geckoterminal.com/${chainSlug}/pools/${pairAddress}`;
}
