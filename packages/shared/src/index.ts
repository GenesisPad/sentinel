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

export type SecuritySignalAnswer = "YES" | "NO" | "UNKNOWN";

export type SecuritySignalSeverity = "GOOD" | "INFO" | "WARN" | "HIGH" | "CRITICAL";

export type SecuritySignalSource =
  | "DETECTOR"
  | "SIMULATION"
  | "TOKEN_PROFILE"
  | "MISSING_DATA"
  | "NOT_IMPLEMENTED";

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
  signals: SecuritySummarySignal[];
}

export interface TokenSecuritySummaryOptions {
  webAppUrl?: string;
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
  proxy: ["PROXY_OR_UPGRADE_SURFACE", "EIP1967_PROXY_DETECTED", "EIP1967_BEACON_PROXY_DETECTED"],
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
  hiddenOwnerAbsent: ["SOURCE_OWNERSHIP_RECOVERY_SURFACE_ABSENT", "SOURCE_PRIVILEGED_ROLE_CONTROL_ABSENT"],
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
  const context = createSecuritySignalContext(result);
  const highIssueSeverities = new Set<FindingSeverity>(["HIGH", "CRITICAL"]);
  const fullAnalysisUrl = buildFullAnalysisUrl(options.webAppUrl, result.token.chainId, result.token.address);
  const devCluster = buildDevClusterSummary(result);

  const summary: TokenSecuritySummaryView = {
    chainId: result.token.chainId,
    address: result.token.address,
    scanId: result.scan.scanId,
    scannerVersion: result.scan.scannerVersion,
    scannedAt: result.scan.completedAt ?? result.scan.submittedAt,
    product: "Genesis Sentinel",
    risk: result.risk,
    issueCount: result.findings.filter((finding) => highIssueSeverities.has(finding.severity)).length,
    devCluster,
    signals: [
      detectorSignal(context, {
        id: "can_block_wallets",
        label: "Can block wallets",
        description: "Whether the contract appears able to block specific wallets from transferring or selling.",
        yesFindings: FINDING_CODES.blacklist,
        detectedChecks: CHECK_CODES.blacklist,
        noChecks: [...CHECK_CODES.blacklist, ...CHECK_CODES.blacklistSourceAbsent]
      }),
      detectorSignal(context, {
        id: "hidden_owner_controls",
        label: "Hidden owner/admin controls",
        description: "Whether source analysis found owner recovery, privileged roles, or similar hidden admin control paths.",
        yesFindings: FINDING_CODES.hiddenOwner,
        noChecks: CHECK_CODES.hiddenOwnerAbsent
      }),
      detectorSignal(context, {
        id: "obfuscated_address",
        label: "Hidden or obfuscated addresses",
        description: "Whether verified source code reconstructs or masks address constants instead of declaring them plainly.",
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
        description: "Whether cooldown, transfer-delay, anti-bot, or anti-snipe controls were detected.",
        yesFindings: FINDING_CODES.cooldown,
        detectedChecks: CHECK_CODES.cooldown,
        noChecks: CHECK_CODES.cooldown
      }),
      devClusterSignal(devCluster),
      detectorSignal(context, {
        id: "has_whitelist",
        label: "Whitelist or exempt wallets",
        description: "Whether fee, limit, or trading exemptions for selected wallets were detected.",
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
  checkCodesByOutcome: Map<CheckOutcome, Set<string>>;
}

function createSecuritySignalContext(result: ScanResultView): SecuritySignalContext {
  const checkCodesByOutcome = new Map<CheckOutcome, Set<string>>();
  for (const check of result.detectorChecks) {
    const codes = checkCodesByOutcome.get(check.outcome) ?? new Set<string>();
    codes.add(check.code);
    checkCodesByOutcome.set(check.outcome, codes);
  }

  return {
    findingCodes: new Set(result.findings.map((finding) => finding.code)),
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
    return {
      id: input.id,
      label: input.label,
      answer: "YES",
      severity: "HIGH",
      confidence: "HIGH",
      source: "DETECTOR",
      description: input.description,
      evidenceCodes: unique(evidenceCodes)
    };
  }

  const noEvidenceCodes = (input.noChecks ?? []).filter((code) => hasCheck(context, "PASSED", code));
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
      description: "Known supply held by the deployer wallet and wallets linked to it by on-chain evidence.",
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
    description: "Known supply held by the deployer wallet and wallets linked to it by on-chain evidence.",
    evidenceCodes: ["WALLET_CLUSTERING_EDGES_FOUND"],
    value:
      knownPct == null
        ? `${cluster.walletCount} linked wallet(s), holdings unknown`
        : `${knownPct.toFixed(2)}% across ${cluster.walletCount} linked wallet(s)`
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

function buildDevClusterSummary(result: ScanResultView): DevClusterSummaryView {
  const holderPctByAddress = buildHolderPctLookup(result);
  const walletsByAddress = new Map<string, DevClusterWalletView>();

  const addWallet = (
    address: `0x${string}`,
    role: RelatedWalletEdgeType,
    confidence: FindingConfidence,
    evidence: string
  ) => {
    const key = address.toLowerCase();
    const existing = walletsByAddress.get(key);
    const next: DevClusterWalletView = {
      address,
      role,
      holdingPct: holderPctByAddress.get(key) ?? null,
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
      "Explorer token profile reports this address as the contract deployer."
    );
  }

  for (const edge of extractRelatedWalletEdges(result)) {
    if (edge.type === "DEPLOYED_BY" || edge.type === "TRANSFERRED_SUPPLY_TO") {
      addWallet(edge.address, edge.type, edge.confidence, edge.evidence);
    }
  }

  const wallets = [...walletsByAddress.values()].sort((a, b) => {
    const bPct = b.holdingPct ?? -1;
    const aPct = a.holdingPct ?? -1;
    return bPct - aPct;
  });
  const knownValues = wallets.flatMap((wallet) => (wallet.holdingPct == null ? [] : [wallet.holdingPct]));
  const knownHoldingPct =
    knownValues.length > 0 ? knownValues.reduce((total, pct) => total + pct, 0) : null;

  return {
    walletCount: wallets.length,
    knownHoldingPct,
    unknownHoldingWalletCount: wallets.filter((wallet) => wallet.holdingPct == null).length,
    wallets
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
    const { address, totalSupplyPct } = record;
    if (typeof address === "string" && typeof totalSupplyPct === "number") {
      lookup.set(address.toLowerCase(), totalSupplyPct);
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
    const { type, address, confidence, evidence, source, firstObservedBlock } = record;
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
    return [view];
  });
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
export function selectPrimaryLiquidityPool(pools: LiquidityPoolView[]): LiquidityPoolView | undefined {
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
    (marketCapUsd != null ? LIQUIDITY_HEALTH_BRACKETS.find((b) => marketCapUsd < b.maxMarketCapUsd) : undefined) ??
    lastBracket;
  if (quoteSidePctOfMarketCap >= bracket.healthyPct) return "healthy";
  if (quoteSidePctOfMarketCap >= bracket.mediumPct) return "medium";
  return "low";
}
