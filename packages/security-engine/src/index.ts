import { toFunctionSelector } from "viem";
import { riskLevelForScore } from "@genesis-sentinel/shared";
import type {
  CheckOutcome,
  FindingConfidence,
  FindingEvidence,
  FindingSeverity,
  RiskAssessment,
  RiskCategory,
  SecurityFinding,
  SimulationKind
} from "@genesis-sentinel/shared";

export interface DetectorMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
}

export interface DetectorContext {
  scanId: string;
  chainId: number;
  address: `0x${string}`;
  scannerVersion: string;
  blockNumber?: bigint;
}

export interface DetectorCheck {
  code: string;
  outcome: CheckOutcome;
  confidence: FindingConfidence;
  evidence: FindingEvidence[];
  errorMessage?: string;
}

export interface DetectorResult {
  detector: DetectorMetadata;
  checks: DetectorCheck[];
  findings: SecurityFinding[];
}

export interface SecurityDetector<TInput = unknown> {
  readonly metadata: DetectorMetadata;
  run(input: TInput, context: DetectorContext): Promise<DetectorResult>;
}

export interface ScoredRiskAssessment extends RiskAssessment {
  scoringVersion: string;
  explanation: string;
}

export interface SimulationIntent {
  kind: SimulationKind;
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber?: bigint;
}

export interface SimulationResult {
  kind: SimulationKind;
  outcome: CheckOutcome;
  blockNumber?: bigint;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  revertReason?: string;
  gasUsed?: bigint;
  simulationTool: string;
}

export interface LiquidityDiscoveryResult {
  status: "UNSUPPORTED";
  discoveryTool: string;
  checkedDexes: string[];
  pools: [];
  reason: string;
}

export interface HolderAnalysisResult {
  status: "UNSUPPORTED";
  analysisTool: string;
  dataSources: string[];
  snapshots: [];
  reason: string;
}

export interface BytecodeDetectorInput {
  bytecode: `0x${string}`;
}

export interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}

export interface TokenMetadataDetectorInput {
  getTokenMetadata(address: `0x${string}`): Promise<TokenMetadata>;
}

export interface ContractSourceFile {
  filename: string;
  sourceCode: string;
}

export interface ContractSourceDetectorInput {
  status: "VERIFIED" | "UNAVAILABLE";
  address: `0x${string}`;
  contractName?: string | null;
  compilerVersion?: string | null;
  language?: string | null;
  abi?: unknown;
  sourceFiles: ContractSourceFile[];
}

interface SelectorRule {
  detectorId: string;
  detectorName: string;
  detectorDescription: string;
  checkCode: string;
  findingCode: string;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  description: string;
  technicalExplanation: string;
  recommendation: string;
  signatures: string[];
}

const detectorVersion = "0.1.0";
export const scoringVersion = "0.1.0-finding-weighted";
export const simulationFoundationVersion = "0.1.0-unsupported";
export const liquidityDiscoveryFoundationVersion = "0.1.0-unsupported";
export const holderAnalysisFoundationVersion = "0.1.0-unsupported";

export const contractCodeExistenceDetector: SecurityDetector<BytecodeDetectorInput> = {
  metadata: {
    id: "contract-code-existence",
    version: detectorVersion,
    name: "Contract code existence",
    description: "Checks whether bytecode exists at the target address."
  },

  async run(input, context) {
    await Promise.resolve();
    const evidence = bytecodeEvidence(context, input.bytecode, {
      bytecodeLength: bytecodeLength(input.bytecode)
    });

    if (input.bytecode === "0x") {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "CONTRACT_CODE_ABSENT",
            outcome: "DETECTED",
            confidence: "HIGH",
            evidence: [evidence]
          }
        ],
        findings: [
          createFinding({
            code: "CONTRACT_CODE_ABSENT",
            detector: this.metadata,
            title: "Not a deployed token contract on this chain",
            severity: "HIGH",
            category: "CONTRACT_CONTROL",
            confidence: "HIGH",
            description:
              "No contract bytecode was found at the submitted address. This address is not a deployed token contract on the scanned chain at the scanned block.",
            technicalExplanation:
              "The chain adapter returned empty bytecode (`0x`) for the target address at the scan block. This usually means the address is not a deployed contract at that block.",
            evidence: [evidence],
            recommendation:
              "Do not treat this as a tradable token CA until the address and chain are verified."
          })
        ]
      };
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: "CONTRACT_CODE_PRESENT",
          outcome: "PASSED",
          confidence: "HIGH",
          evidence: [evidence]
        }
      ],
      findings: []
    };
  }
};

export const erc20MetadataDetector: SecurityDetector<TokenMetadataDetectorInput> = {
  metadata: {
    id: "erc20-metadata",
    version: detectorVersion,
    name: "ERC-20 metadata retrieval",
    description: "Retrieves common ERC-20 metadata fields."
  },

  async run(input, context) {
    const metadata = await input.getTokenMetadata(context.address);
    const evidence: FindingEvidence = {
      type: "FUNCTION",
      summary: "ERC-20 metadata read results",
      address: context.address,
      data: {
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals
      }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }
    const missing = [
      metadata.name === null ? "name" : null,
      metadata.symbol === null ? "symbol" : null,
      metadata.decimals === null ? "decimals" : null
    ].filter((field): field is string => field !== null);

    if (missing.length === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "ERC20_METADATA_READ",
            outcome: "PASSED",
            confidence: "HIGH",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: "ERC20_METADATA_INCOMPLETE",
          outcome: "INCONCLUSIVE",
          confidence: "MEDIUM",
          evidence: [evidence]
        }
      ],
      findings: [
        createFinding({
          code: "ERC20_METADATA_INCOMPLETE",
          detector: this.metadata,
          title: "ERC-20 metadata is incomplete",
          severity: "LOW",
          category: "REPUTATION_RISK",
          confidence: "MEDIUM",
          description: "One or more common ERC-20 metadata fields could not be read.",
          technicalExplanation: `The metadata adapter could not read: ${missing.join(", ")}.`,
          evidence: [evidence],
          recommendation:
            "Treat missing metadata as a review signal, not proof of malicious behavior."
        })
      ]
    };
  }
};

const selectorRules: SelectorRule[] = [
  {
    detectorId: "ownership-selector-patterns",
    detectorName: "Common ownership selectors",
    detectorDescription: "Detects common Ownable-style function selectors in bytecode.",
    checkCode: "OWNERSHIP_SELECTORS_PRESENT",
    findingCode: "OWNERSHIP_CONTROL_SURFACE",
    title: "Ownership control surface detected",
    severity: "MEDIUM",
    category: "CONTRACT_CONTROL",
    description: "The bytecode contains selectors commonly associated with ownership controls.",
    technicalExplanation:
      "Selector presence indicates the contract may expose ownership-related functions. This does not prove the current owner, permissions, or exploitability.",
    recommendation: "Review owner address, renounce status, and privileged function reachability.",
    signatures: ["owner()", "getOwner()", "transferOwnership(address)", "renounceOwnership()"]
  },
  {
    detectorId: "proxy-selector-patterns",
    detectorName: "Common proxy selectors",
    detectorDescription: "Detects common proxy admin and upgrade function selectors in bytecode.",
    checkCode: "PROXY_SELECTORS_PRESENT",
    findingCode: "PROXY_OR_UPGRADE_SURFACE",
    title: "Proxy or upgrade control surface detected",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    description:
      "The bytecode contains selectors commonly associated with proxy or upgrade controls.",
    technicalExplanation:
      "Selector presence indicates potential proxy/admin/upgrade functionality. Storage slots and admin permissions must be checked before concluding upgradeability is active.",
    recommendation:
      "Verify implementation/admin storage, upgrade authority, and whether upgrades are disabled.",
    signatures: [
      "implementation()",
      "admin()",
      "changeAdmin(address)",
      "upgradeTo(address)",
      "upgradeToAndCall(address,bytes)"
    ]
  },
  {
    detectorId: "mint-selector-patterns",
    detectorName: "Common mint selectors",
    detectorDescription: "Detects common mint function selectors in bytecode.",
    checkCode: "MINT_SELECTORS_PRESENT",
    findingCode: "MINT_CAPABILITY_SURFACE",
    title: "Mint capability surface detected",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    description: "The bytecode contains selectors commonly associated with token minting.",
    technicalExplanation:
      "Selector presence indicates possible mint functionality. Access control and supply effects must be verified before concluding minting is currently possible.",
    recommendation:
      "Verify mint permissions, max supply bounds, and whether minting has been permanently disabled.",
    signatures: ["mint(address,uint256)", "mint(uint256)"]
  },
  {
    detectorId: "pause-selector-patterns",
    detectorName: "Common pause selectors",
    detectorDescription: "Detects common pause function selectors in bytecode.",
    checkCode: "PAUSE_SELECTORS_PRESENT",
    findingCode: "PAUSE_CAPABILITY_SURFACE",
    title: "Pause capability surface detected",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with pausing transfers or contract behavior.",
    technicalExplanation:
      "Selector presence indicates possible pause functionality. It does not prove the contract is currently paused or that transfers can be stopped.",
    recommendation:
      "Verify pause authority and test transfer behavior around paused state where possible.",
    signatures: ["pause()", "unpause()", "paused()"]
  },
  {
    detectorId: "blacklist-selector-patterns",
    detectorName: "Common blacklist selectors",
    detectorDescription: "Detects common blacklist/bot-list function selectors in bytecode.",
    checkCode: "BLACKLIST_SELECTORS_PRESENT",
    findingCode: "BLACKLIST_CAPABILITY_SURFACE",
    title: "Blacklist or bot-list control surface detected",
    severity: "HIGH",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with blacklist, blocklist, or bot-list controls.",
    technicalExplanation:
      "Selector presence indicates possible address-based transfer restriction controls. It does not prove the controls are active or reachable by a privileged role.",
    recommendation:
      "Verify transfer restrictions with simulation and inspect privileged role permissions.",
    signatures: [
      "blacklist(address)",
      "unblacklist(address)",
      "setBlacklist(address,bool)",
      "isBlacklisted(address)",
      "setBot(address,bool)",
      "isBot(address)"
    ]
  },
  {
    detectorId: "max-transaction-selector-patterns",
    detectorName: "Common max-transaction/max-wallet selectors",
    detectorDescription:
      "Detects common max-transaction and max-wallet limit function selectors in bytecode.",
    checkCode: "MAX_TRANSACTION_SELECTORS_PRESENT",
    findingCode: "MAX_TRANSACTION_CAPABILITY_SURFACE",
    title: "Max-transaction or max-wallet control surface detected",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with per-transaction or per-wallet transfer caps.",
    technicalExplanation:
      "Selector presence indicates the contract may restrict trade size or wallet holdings. It does not prove the caps are currently active or what their values are.",
    recommendation:
      "Verify current cap values and whether a privileged role can change them without limits.",
    signatures: [
      "maxTransactionAmount()",
      "setMaxTxAmount(uint256)",
      "maxWalletAmount()",
      "setMaxWalletAmount(uint256)",
      "_maxTxAmount()",
      "_maxWalletSize()"
    ]
  },
  {
    detectorId: "trading-control-selector-patterns",
    detectorName: "Common trading-enable/disable selectors",
    detectorDescription: "Detects common trading-enable/disable function selectors in bytecode.",
    checkCode: "TRADING_CONTROL_SELECTORS_PRESENT",
    findingCode: "TRADING_CONTROL_SURFACE",
    title: "Trading enable/disable control surface detected",
    severity: "HIGH",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with globally enabling or disabling trading.",
    technicalExplanation:
      "Selector presence indicates a privileged role may be able to halt all trading for this token. It does not prove trading is currently disabled.",
    recommendation:
      "Verify current trading status and who holds the privileged role that can toggle it.",
    signatures: ["enableTrading()", "setTradingEnabled(bool)", "tradingActive()", "openTrading()"]
  },
  {
    detectorId: "fee-exclusion-selector-patterns",
    detectorName: "Common fee/limit exclusion (whitelist) selectors",
    detectorDescription:
      "Detects common fee- or limit-exclusion (whitelist) function selectors in bytecode.",
    checkCode: "FEE_EXCLUSION_SELECTORS_PRESENT",
    findingCode: "FEE_EXCLUSION_CAPABILITY_SURFACE",
    title: "Fee or limit exclusion (whitelist) control surface detected",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with excluding specific addresses from fees or transfer limits.",
    technicalExplanation:
      "Selector presence indicates a privileged role may exempt chosen addresses from taxes or caps applied to everyone else. It does not prove which addresses are currently excluded.",
    recommendation:
      "Review which addresses are excluded and whether exclusions create an unfair trading advantage.",
    signatures: [
      "excludeFromFees(address,bool)",
      "setExcludedFromFees(address,bool)",
      "isExcludedFromFees(address)",
      "_isExcludedFromFee(address)"
    ]
  }
];

// Known burn/dead addresses used to classify ownership as renounced.
const burnAddresses = new Set([
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000"
]);

export interface OwnerAddressDetectorInput {
  getOwnerAddress(address: `0x${string}`): Promise<`0x${string}` | null>;
}

/**
 * Reads owner() directly on-chain rather than relying on selector presence, so it can
 * distinguish "ownership renounced" from "no Ownable pattern detected" instead of guessing.
 */
export const ownershipStatusDetector: SecurityDetector<OwnerAddressDetectorInput> = {
  metadata: {
    id: "ownership-status",
    version: detectorVersion,
    name: "Ownership status",
    description: "Reads owner() on-chain and classifies ownership as renounced or active."
  },

  async run(input, context) {
    const owner = await input.getOwnerAddress(context.address);
    const evidence: FindingEvidence = {
      type: "FUNCTION",
      summary: "owner() read result",
      address: context.address,
      data: { owner }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    if (owner === null) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "OWNER_READ_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    if (burnAddresses.has(owner.toLowerCase())) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "OWNERSHIP_RENOUNCED",
            outcome: "PASSED",
            confidence: "HIGH",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: "OWNERSHIP_ACTIVE",
          outcome: "DETECTED",
          confidence: "HIGH",
          evidence: [evidence]
        }
      ],
      findings: [
        createFinding({
          code: "OWNERSHIP_NOT_RENOUNCED",
          detector: this.metadata,
          title: "Contract ownership is not renounced",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description: `owner() returned an active address (${owner}), not a known burn address. The owner may retain privileged control.`,
          technicalExplanation:
            "owner() was read directly on-chain at the scan block and compared against known burn/zero addresses.",
          evidence: [evidence],
          recommendation:
            "Review which privileged functions the owner can call and whether that risk is acceptable."
        })
      ]
    };
  }
};

export const selectorPatternDetectors: SecurityDetector<BytecodeDetectorInput>[] =
  selectorRules.map((rule) => createSelectorDetector(rule));

interface SourceRiskRule {
  code: string;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  confidence: FindingConfidence;
  description: string;
  technicalExplanation: string;
  recommendation: string;
  patterns: RegExp[];
}

const sourceRiskRules: SourceRiskRule[] = [
  {
    code: "SOURCE_BLACKLIST_CONTROL",
    title: "Source code exposes blacklist or bot-list controls",
    severity: "HIGH",
    category: "TRADING_SAFETY",
    confidence: "HIGH",
    description:
      "Verified source code contains address-restriction controls that may let privileged roles block buys, sells, or transfers.",
    technicalExplanation:
      "The detector matched blacklist, blocklist, bot-list, or cooldown control terms in verified source code.",
    recommendation:
      "Review who can call these controls and whether trade simulation confirms normal buyers can still sell.",
    patterns: [
      /\b(?:blacklist|blacklisted|blocklist|blocked|isBot|bots|sniper|cooldown|antiBot)\b/i,
      /\bmapping\s*\([^)]*address[^)]*\)\s*(?:public|private|internal)?\s*(?:_|is)?(?:blacklist|blacklisted|blocklist|blocked|bot|bots)/i
    ]
  },
  {
    code: "SOURCE_TRADING_TOGGLE",
    title: "Source code exposes trading enable/disable controls",
    severity: "HIGH",
    category: "TRADING_SAFETY",
    confidence: "HIGH",
    description:
      "Verified source code contains trading gates that can restrict transfers before or after launch.",
    technicalExplanation:
      "The detector matched trading-open, swap-enabled, launch, or transfer gate logic in verified source code.",
    recommendation:
      "Verify current trading state and whether the owner/admin can disable trading after launch.",
    patterns: [
      /\b(?:tradingOpen|tradingEnabled|tradingActive|openTrading|enableTrading|swapEnabled|limitsInEffect|launched)\b/i,
      /\brequire\s*\([^;]*(?:trading|launched|swapEnabled|limitsInEffect)[^;]*\)/i
    ]
  },
  {
    code: "SOURCE_OWNERSHIP_RECOVERY_SURFACE",
    title: "Source code may allow ownership/admin recovery after renounce",
    severity: "CRITICAL",
    category: "CONTRACT_CONTROL",
    confidence: "MEDIUM",
    description:
      "Verified source code contains ownership or admin reassignment patterns that may bypass a simple renounced owner() check.",
    technicalExplanation:
      "The detector matched ownership recovery, hidden owner, admin setter, or direct owner storage assignment terms in verified source code.",
    recommendation:
      "Manually inspect the matched functions and compare owner(), roles, and storage writes before trusting renounced ownership.",
    patterns: [
      /\bfunction\s+(?:reclaimOwnership|recoverOwnership|restoreOwnership|manualOwnership|setOwner)\s*\(/i,
      /\b(?:reclaimOwnership|recoverOwnership|restoreOwnership)\b/i
    ]
  },
  {
    code: "SOURCE_PRIVILEGED_ROLE_CONTROL",
    title: "Source code exposes privileged role/admin controls",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    confidence: "MEDIUM",
    description:
      "Verified source code contains role or admin controls that may grant privileged contract powers outside owner().",
    technicalExplanation:
      "The detector matched AccessControl roles, role grants, operator setters, controller setters, or admin setter functions in verified source code.",
    recommendation:
      "Review role holders and admin functions, especially if owner() appears renounced but roles remain active.",
    patterns: [
      /\b(?:DEFAULT_ADMIN_ROLE|MINTER_ROLE|PAUSER_ROLE|grantRole|revokeRole|_grantRole|AccessControl)\b/i,
      /\bfunction\s+(?:setAdmin|setOperator|setController|setManager|setMinter|setPauser)\s*\(/i
    ]
  },
  {
    code: "SOURCE_ADMIN_TRANSFER_SURFACE",
    title: "Source code may allow admin-forced token movement",
    severity: "CRITICAL",
    category: "CONTRACT_CONTROL",
    confidence: "MEDIUM",
    description:
      "Verified source code contains functions or transfer paths that may let an admin move or seize tokens outside normal ERC-20 allowance rules.",
    technicalExplanation:
      "The detector matched forced transfer, confiscation, seizure, or suspicious admin transfer function names/source paths.",
    recommendation:
      "Inspect whether any privileged role can transfer tokens from holders without allowance. Treat confirmed forced-transfer capability as critical.",
    patterns: [
      /\b(?:forceTransfer|forcedTransfer|adminTransfer|operatorTransfer|seize|confiscate|clawback|wipe|burnFrom)\b/i,
      /function\s+\w*(?:rescue|recover|sweep)\w*\s*\([^)]*address\s+(?:token|from|account|wallet)/i
    ]
  },
  {
    code: "SOURCE_MINT_OR_SUPPLY_CONTROL",
    title: "Source code exposes mint or supply-control functions",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    confidence: "HIGH",
    description:
      "Verified source code contains minting or supply-control paths that can dilute holders if still callable.",
    technicalExplanation:
      "The detector matched mint or supply-management function names/calls in verified source code.",
    recommendation:
      "Verify mint permissions, max supply, and whether minting has been permanently disabled.",
    patterns: [
      /\bfunction\s+\w*mint\w*\s*\([^)]*\)\s*(?:external|public)\b/i,
      /\b(?:MINTER_ROLE|setMinter|grantRole\s*\(\s*MINTER_ROLE)\b/i,
      /\b(?:setSupply|increaseSupply)\s*\(/i
    ]
  },
  {
    code: "SOURCE_TAX_OR_LIMIT_CONTROL",
    title: "Source code exposes tax, max-wallet, or max-transaction controls",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    confidence: "HIGH",
    description:
      "Verified source code contains adjustable fees, wallet limits, or transaction limits that can affect trading outcomes.",
    technicalExplanation:
      "The detector matched tax/fee setters, max-wallet, max-transaction, or exclusion/whitelist controls in verified source code.",
    recommendation:
      "Review current fee and limit values and whether privileged roles can raise them without a cap.",
    patterns: [
      /\b(?:setTax|setTaxes|setFees|setBuyFee|setSellFee|buyTax|sellTax|taxFee|marketingFee|liquidityFee)\b/i,
      /\b(?:maxWallet|maxTx|maxTransaction|setMaxWallet|setMaxTx|excludeFromFees|isExcludedFromFee|whitelist)\b/i
    ]
  }
];

export const sourceCodeRiskDetector: SecurityDetector<ContractSourceDetectorInput> = {
  metadata: {
    id: "source-code-risk-patterns",
    version: detectorVersion,
    name: "Verified source-code risk patterns",
    description:
      "Scans verified contract source code and ABI for privileged controls and harmful token mechanics."
  },

  async run(input, context) {
    await Promise.resolve();
    const evidenceBase = createSourceEvidence(context, input, {
      sourceFileCount: input.sourceFiles.length,
      contractName: input.contractName ?? null,
      compilerVersion: input.compilerVersion ?? null,
      language: input.language ?? null
    });

    if (input.status !== "VERIFIED" || input.sourceFiles.length === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "SOURCE_CODE_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidenceBase]
          }
        ],
        findings: []
      };
    }

    const findings: SecurityFinding[] = [];
    const checks: DetectorCheck[] = [];
    for (const rule of sourceRiskRules) {
      const matches = matchSourceRule(input.sourceFiles, rule);
      const evidence = createSourceEvidence(context, input, {
        ruleCode: rule.code,
        matches
      });
      checks.push({
        code: matches.length > 0 ? `${rule.code}_DETECTED` : `${rule.code}_ABSENT`,
        outcome: matches.length > 0 ? "DETECTED" : "PASSED",
        confidence: matches.length > 0 ? rule.confidence : "MEDIUM",
        evidence: [evidence]
      });

      if (matches.length > 0) {
        findings.push(
          createFinding({
            code: rule.code,
            detector: this.metadata,
            title: rule.title,
            severity: rule.severity,
            category: rule.category,
            confidence: rule.confidence,
            description: rule.description,
            technicalExplanation: rule.technicalExplanation,
            evidence: [evidence],
            recommendation: rule.recommendation
          })
        );
      }
    }

    return {
      detector: this.metadata,
      checks,
      findings
    };
  }
};

export function createEmptyDetectorResult(metadata: DetectorMetadata): DetectorResult {
  return {
    detector: metadata,
    checks: [],
    findings: []
  };
}

export async function runFoundationDetectors(
  input: BytecodeDetectorInput & TokenMetadataDetectorInput & OwnerAddressDetectorInput,
  context: DetectorContext
): Promise<DetectorResult[]> {
  const bytecodeInput = { bytecode: input.bytecode };
  return [
    await contractCodeExistenceDetector.run(bytecodeInput, context),
    await erc20MetadataDetector.run(input, context),
    await ownershipStatusDetector.run(input, context),
    ...(await Promise.all(
      selectorPatternDetectors.map((detector) => detector.run(bytecodeInput, context))
    ))
  ];
}

export function scoreFindings(
  findings: SecurityFinding[],
  scannerVersion: string
): ScoredRiskAssessment | null {
  if (findings.length === 0) {
    return null;
  }

  const categoryScores = uniqueCategories(findings).map((category) => {
    const categoryFindings = findings.filter((finding) => finding.category === category);
    const score = Math.min(
      100,
      categoryFindings.reduce((total, finding) => total + findingWeight(finding), 0)
    );

    return {
      category,
      score,
      confidence: strongestConfidence(categoryFindings.map((finding) => finding.confidence))
    };
  });
  const score = Math.min(
    100,
    Math.max(...categoryScores.map((categoryScore) => categoryScore.score))
  );

  return {
    score,
    level: riskLevelForScore(score),
    confidence: strongestConfidence(findings.map((finding) => finding.confidence)),
    categoryScores,
    scannerVersion,
    scoringVersion,
    explanation:
      "Risk Score is derived only from persisted detector findings. Unimplemented simulations, liquidity analysis, holder analysis, and source verification are not treated as low risk."
  };
}

export function createUnsupportedTradeSimulations(input: {
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber?: bigint;
}): SimulationResult[] {
  return (["BUY", "SELL", "TRANSFER"] as const).map((kind) => {
    const intent: SimulationIntent = {
      kind,
      chainId: input.chainId,
      tokenAddress: input.tokenAddress
    };

    if (input.blockNumber !== undefined) {
      intent.blockNumber = input.blockNumber;
    }

    return createUnsupportedSimulation(intent);
  });
}

export function createUnsupportedLiquidityDiscovery(): LiquidityDiscoveryResult {
  return {
    status: "UNSUPPORTED",
    discoveryTool: liquidityDiscoveryFoundationVersion,
    checkedDexes: [],
    pools: [],
    reason:
      "No DEX factory, subgraph, or explorer liquidity discovery source is configured for this chain."
  };
}

export function createUnsupportedHolderAnalysis(): HolderAnalysisResult {
  return {
    status: "UNSUPPORTED",
    analysisTool: holderAnalysisFoundationVersion,
    dataSources: [],
    snapshots: [],
    reason:
      "No holder index, bounded Transfer-log scanner, or cached holder snapshot source is configured for this chain."
  };
}

function createSelectorDetector(rule: SelectorRule): SecurityDetector<BytecodeDetectorInput> {
  const selectors = rule.signatures.map((signature) => ({
    signature,
    selector: toFunctionSelector(signature)
  }));

  return {
    metadata: {
      id: rule.detectorId,
      version: detectorVersion,
      name: rule.detectorName,
      description: rule.detectorDescription
    },

    async run(input, context) {
      await Promise.resolve();
      const matches = selectors.filter(({ selector }) =>
        input.bytecode.includes(selector.slice(2))
      );
      const evidence = bytecodeEvidence(context, input.bytecode, {
        matchedSelectors: matches,
        checkedSignatures: rule.signatures
      });

      if (matches.length === 0) {
        return {
          detector: this.metadata,
          checks: [
            {
              code: rule.checkCode,
              outcome: "PASSED",
              confidence: "MEDIUM",
              evidence: [evidence]
            }
          ],
          findings: []
        };
      }

      return {
        detector: this.metadata,
        checks: [
          {
            code: rule.checkCode,
            outcome: "DETECTED",
            confidence: "MEDIUM",
            evidence: [evidence]
          }
        ],
        findings: [
          createFinding({
            code: rule.findingCode,
            detector: this.metadata,
            title: rule.title,
            severity: rule.severity,
            category: rule.category,
            confidence: "MEDIUM",
            description: rule.description,
            technicalExplanation: rule.technicalExplanation,
            evidence: [evidence],
            recommendation: rule.recommendation
          })
        ]
      };
    }
  };
}

function createFinding(input: {
  code: string;
  detector: DetectorMetadata;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  confidence: FindingConfidence;
  description: string;
  technicalExplanation: string;
  evidence: FindingEvidence[];
  recommendation?: string;
}): SecurityFinding {
  const finding: SecurityFinding = {
    code: input.code,
    detectorId: input.detector.id,
    detectorVersion: input.detector.version,
    title: input.title,
    severity: input.severity,
    category: input.category,
    confidence: input.confidence,
    description: input.description,
    technicalExplanation: input.technicalExplanation,
    evidence: input.evidence
  };

  if (input.recommendation) {
    finding.recommendation = input.recommendation;
  }

  return finding;
}

function bytecodeEvidence(
  context: DetectorContext,
  bytecode: `0x${string}`,
  data: Record<string, unknown>
): FindingEvidence {
  const evidence: FindingEvidence = {
    type: "BYTECODE",
    summary: "Bytecode inspection at scan block",
    address: context.address,
    data: {
      bytecodeLength: bytecodeLength(bytecode),
      ...data
    }
  };

  if (context.blockNumber !== undefined) {
    evidence.blockNumber = context.blockNumber;
  }

  return evidence;
}

function bytecodeLength(bytecode: `0x${string}`): number {
  return bytecode === "0x" ? 0 : (bytecode.length - 2) / 2;
}

function createSourceEvidence(
  context: DetectorContext,
  input: ContractSourceDetectorInput,
  data: Record<string, unknown>
): FindingEvidence {
  const evidence: FindingEvidence = {
    type: "EXTERNAL_SOURCE",
    summary:
      input.status === "VERIFIED"
        ? "Verified source code retrieved from explorer"
        : "Verified source code unavailable from explorer",
    address: context.address,
    data: {
      sourceStatus: input.status,
      sourceFiles: input.sourceFiles.map((file) => ({
        filename: file.filename,
        byteLength: file.sourceCode.length
      })),
      ...data
    }
  };

  if (context.blockNumber !== undefined) {
    evidence.blockNumber = context.blockNumber;
  }

  return evidence;
}

function matchSourceRule(sourceFiles: ContractSourceFile[], rule: SourceRiskRule) {
  const matches: Array<{ filename: string; pattern: string; snippet: string }> = [];
  for (const file of sourceFiles) {
    const source = stripSolidityComments(file.sourceCode);
    for (const pattern of rule.patterns) {
      const match = pattern.exec(source);
      if (match?.index !== undefined) {
        matches.push({
          filename: file.filename,
          pattern: pattern.source,
          snippet: sourceSnippet(source, match.index)
        });
      }
    }
  }

  return matches.slice(0, 10);
}

function stripSolidityComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function sourceSnippet(source: string, index: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(source.length, index + 240);
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function createUnsupportedSimulation(intent: SimulationIntent): SimulationResult {
  const result: SimulationResult = {
    kind: intent.kind,
    outcome: "UNSUPPORTED",
    input: {
      kind: intent.kind,
      chainId: intent.chainId,
      tokenAddress: intent.tokenAddress
    },
    result: {
      status: "UNSUPPORTED",
      reason:
        "No isolated simulation runner is configured. Genesis Sentinel did not execute a buy, sell, or transfer simulation for this scan."
    },
    simulationTool: simulationFoundationVersion
  };

  if (intent.blockNumber !== undefined) {
    result.blockNumber = intent.blockNumber;
    result.input.blockNumber = intent.blockNumber.toString();
  }

  return result;
}

function uniqueCategories(findings: SecurityFinding[]): RiskCategory[] {
  return [...new Set(findings.map((finding) => finding.category))];
}

function findingWeight(finding: SecurityFinding): number {
  const severityWeight: Record<FindingSeverity, number> = {
    INFO: 5,
    LOW: 15,
    MEDIUM: 35,
    HIGH: 60,
    CRITICAL: 85
  };
  const confidenceMultiplier: Record<FindingConfidence, number> = {
    LOW: 0.75,
    MEDIUM: 1,
    HIGH: 1.15
  };

  return Math.round(severityWeight[finding.severity] * confidenceMultiplier[finding.confidence]);
}

function strongestConfidence(confidences: FindingConfidence[]): FindingConfidence {
  if (confidences.includes("HIGH")) {
    return "HIGH";
  }

  if (confidences.includes("MEDIUM")) {
    return "MEDIUM";
  }

  return "LOW";
}
