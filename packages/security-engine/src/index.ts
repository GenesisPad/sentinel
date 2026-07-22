import { toFunctionSelector } from "viem";
import { riskLevelForScore } from "@genesis-sentinel/shared";
import type {
  BytecodeReuseView,
  CheckOutcome,
  DeployerHistoryView,
  FindingConfidence,
  FindingContribution,
  FindingEvidence,
  FindingSeverity,
  RelatedWalletEdge,
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
export const scoringVersion = "0.2.0-category-weighted-with-gap-reasons";
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
    // Only setter selectors — a bare no-argument getter like maxWalletAmount()/
    // maxTransactionAmount() is the auto-generated accessor Solidity creates for ANY `public`
    // state variable, including a permanently `immutable` one with no setter at all. Matching
    // getter selectors here means any contract exposing its (harmless, fixed-at-deploy) limits
    // for transparency gets flagged the same as one with a privileged setter. Verified against a
    // real deployed token whose maxWalletAmount/maxTxAmount are immutable, have no setter, and
    // are enforced only for a fixed anti-snipe block window — this detector still reported a
    // "control surface" purely from the read-only getter's selector matching by coincidence.
    signatures: ["setMaxTxAmount(uint256)", "setMaxWalletAmount(uint256)"]
  },
  {
    detectorId: "cooldown-selector-patterns",
    detectorName: "Common cooldown and anti-bot selectors",
    detectorDescription:
      "Detects common cooldown, transfer-delay, and anti-bot function selectors in bytecode.",
    checkCode: "COOLDOWN_SELECTORS_PRESENT",
    findingCode: "COOLDOWN_CAPABILITY_SURFACE",
    title: "Cooldown or anti-bot control surface detected",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    description:
      "The bytecode contains selectors commonly associated with cooldown, transfer-delay, or anti-bot controls.",
    technicalExplanation:
      "Selector presence indicates the contract may restrict how frequently wallets can trade or transfer. It does not prove the cooldown is currently active.",
    recommendation:
      "Verify current cooldown settings and whether a privileged role can change or re-enable them.",
    signatures: [
      "setCooldown(uint256)",
      "setCooldownEnabled(bool)",
      "setTransferDelayEnabled(bool)",
      "setAntiBotEnabled(bool)",
      "removeLimits()"
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

export interface StorageReaderDetectorInput {
  getStorageAt(slot: `0x${string}`): Promise<`0x${string}`>;
}

// EIP-1967 well-known storage slots: keccak256("eip1967.proxy.<name>") - 1.
const eip1967ImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb" as const;
const eip1967AdminSlot = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;
const eip1967BeaconSlot =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

function addressFromSlot(slot: `0x${string}`): `0x${string}` | null {
  const value = slot.slice(2).replace(/^0+/, "");
  if (value.length === 0) {
    return null;
  }
  return `0x${value.padStart(40, "0")}`.toLowerCase() as `0x${string}`;
}

/**
 * Reads the standardized EIP-1967 implementation/admin/beacon storage slots directly on-chain
 * rather than inferring proxy behavior from function-selector presence. A non-zero
 * implementation or beacon slot is direct evidence of an active EIP-1967-style proxy; an
 * all-zero result is direct evidence of absence of this specific standard (it does not rule
 * out non-standard proxy patterns like minimal/diamond proxies, which selector-pattern
 * detectors may still flag separately).
 */
export const eip1967ProxyDetector: SecurityDetector<StorageReaderDetectorInput> = {
  metadata: {
    id: "eip1967-proxy-storage",
    version: detectorVersion,
    name: "EIP-1967 proxy storage",
    description: "Reads the EIP-1967 implementation, admin, and beacon storage slots on-chain."
  },

  async run(input, context) {
    const [implementationSlotValue, adminSlotValue, beaconSlotValue] = await Promise.all([
      input.getStorageAt(eip1967ImplementationSlot),
      input.getStorageAt(eip1967AdminSlot),
      input.getStorageAt(eip1967BeaconSlot)
    ]);
    const implementationAddress = addressFromSlot(implementationSlotValue);
    const adminAddress = addressFromSlot(adminSlotValue);
    const beaconAddress = addressFromSlot(beaconSlotValue);

    const evidence: FindingEvidence = {
      type: "STORAGE",
      summary: "EIP-1967 implementation/admin/beacon storage slot read",
      address: context.address,
      data: { implementationAddress, adminAddress, beaconAddress }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    if (!implementationAddress && !beaconAddress) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "EIP1967_PROXY_ABSENT",
            outcome: "PASSED",
            confidence: "HIGH",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const isBeacon = !implementationAddress && Boolean(beaconAddress);
    return {
      detector: this.metadata,
      checks: [
        {
          code: isBeacon ? "EIP1967_BEACON_PROXY_DETECTED" : "EIP1967_PROXY_DETECTED",
          outcome: "DETECTED",
          confidence: "HIGH",
          evidence: [evidence]
        }
      ],
      findings: [
        createFinding({
          code: isBeacon ? "EIP1967_BEACON_PROXY_DETECTED" : "EIP1967_PROXY_DETECTED",
          detector: this.metadata,
          title: isBeacon
            ? "Contract is an EIP-1967 beacon proxy"
            : "Contract is an EIP-1967 upgradeable proxy",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description: isBeacon
            ? `The EIP-1967 beacon storage slot is set to ${beaconAddress}. Calls are forwarded to whatever implementation the beacon currently points to.`
            : `The EIP-1967 implementation storage slot is set to ${implementationAddress}${adminAddress ? `, with admin ${adminAddress}` : ""}. This contract's logic can be replaced by whoever controls the upgrade authority.`,
          technicalExplanation:
            "The implementation/admin/beacon storage slots were read directly on-chain at the scan block, per the EIP-1967 standard slot layout.",
          evidence: [evidence],
          recommendation:
            "Verify who controls the upgrade authority (admin or beacon owner) and whether upgrades are timelocked or renounced before trusting current contract behavior as permanent."
        })
      ]
    };
  }
};

// Skips PUSH1-PUSH32 (0x60-0x7f) immediate-data bytes so they are never misread as opcodes.
function scanOpcodes(bytecode: `0x${string}`): Set<number> {
  const hex = bytecode.slice(2);
  const found = new Set<number>();
  let i = 0;
  while (i + 2 <= hex.length) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    found.add(byte);
    i += byte >= 0x60 && byte <= 0x7f ? 2 + (byte - 0x5f) * 2 : 2;
  }
  return found;
}

const delegatecallOpcode = 0xf4;
const selfdestructOpcode = 0xff;

/**
 * Scans runtime bytecode for the DELEGATECALL and SELFDESTRUCT opcodes by walking the actual
 * instruction stream (skipping PUSH immediate data), rather than substring-matching function
 * selectors. Presence is real bytecode evidence; it does not by itself prove the opcode is
 * reachable from an externally callable function or under what conditions.
 */
export const dangerousOpcodeDetector: SecurityDetector<BytecodeDetectorInput> = {
  metadata: {
    id: "dangerous-opcode-surface",
    version: detectorVersion,
    name: "Dangerous opcode surface",
    description: "Scans bytecode instructions for DELEGATECALL and SELFDESTRUCT opcodes."
  },

  async run(input, context) {
    await Promise.resolve();
    const opcodes = scanOpcodes(input.bytecode);
    const hasDelegatecall = opcodes.has(delegatecallOpcode);
    const hasSelfdestruct = opcodes.has(selfdestructOpcode);
    const evidence = bytecodeEvidence(context, input.bytecode, {
      hasDelegatecall,
      hasSelfdestruct
    });

    const findings: SecurityFinding[] = [];
    if (hasDelegatecall) {
      findings.push(
        createFinding({
          code: "DELEGATECALL_OPCODE_PRESENT",
          detector: this.metadata,
          title: "Bytecode contains the DELEGATECALL opcode",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description:
            "The contract's runtime bytecode contains a DELEGATECALL instruction, which executes external code in this contract's own storage context.",
          technicalExplanation:
            "DELEGATECALL is required by proxy patterns (see EIP-1967 findings) but can also be used by non-proxy contracts to run arbitrary externally-supplied logic against local storage. Opcode presence alone does not prove reachability or an attacker-controlled target.",
          evidence: [evidence],
          recommendation:
            "Cross-check against proxy findings; if this contract is not a known proxy pattern, review which functions reach DELEGATECALL and who controls the target address."
        })
      );
    }
    if (hasSelfdestruct) {
      findings.push(
        createFinding({
          code: "SELFDESTRUCT_OPCODE_PRESENT",
          detector: this.metadata,
          title: "Bytecode contains the SELFDESTRUCT opcode",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description:
            "The contract's runtime bytecode contains a SELFDESTRUCT instruction, which can remove contract code or forcibly send its native balance elsewhere.",
          technicalExplanation:
            "Opcode presence was detected by walking the instruction stream. It does not by itself prove the instruction is reachable by an external caller or which address controls it.",
          evidence: [evidence],
          recommendation:
            "Review whether SELFDESTRUCT is reachable, by which role, and what happens to holder funds/liquidity if it is triggered."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: findings.length > 0 ? "DANGEROUS_OPCODES_DETECTED" : "DANGEROUS_OPCODES_ABSENT",
          outcome: findings.length > 0 ? "DETECTED" : "PASSED",
          confidence: "MEDIUM",
          evidence: [evidence]
        }
      ],
      findings
    };
  }
};

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

/**
 * A rule's regex can match a genuinely dangerous shape and a well-known benign shape with the
 * same keyword (e.g. `rescue`-named functions that recover foreign tokens vs. ones that drain
 * this token; `burnFrom` gated by allowance vs. an unrestricted burn-anyone's-balance function).
 * `classifyMatch` lets a specific pattern look at the full match context and the code) and
 * confirm the occurrence is a known-safe shape. Returning null/undefined leaves the match at the
 * rule's default severity — failing to prove benign-ness is not the same as proving risk, so an
 * unresolved case must never silently clear.
 */
interface SourceRiskPattern {
  regex: RegExp;
  classifyMatch?: (source: string, matchIndex: number, matchedText: string) => { note: string } | null;
}

interface SourceRiskRule {
  code: string;
  title: string;
  severity: FindingSeverity;
  category: RiskCategory;
  confidence: FindingConfidence;
  description: string;
  technicalExplanation: string;
  recommendation: string;
  patterns: SourceRiskPattern[];
}

/**
 * Extracts a full brace-balanced function body starting from the first `{` at or after
 * `fromIndex`, instead of a fixed-radius text snippet — verifying a benign shape (e.g. a guard
 * clause) requires seeing the whole function, not just ~360 characters around the match.
 */
function extractFunctionBodyAt(source: string, fromIndex: number): string | null {
  const braceStart = source.indexOf("{", fromIndex);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

/**
 * Confirms a matched rescue/recover/sweep function explicitly reverts when its token parameter
 * equals this contract's own address — the standard, safe shape for recovering foreign tokens
 * accidentally sent to the contract, which cannot touch this token's own balances.
 */
function classifyRescueFunction(source: string, matchIndex: number): { note: string } | null {
  const body = extractFunctionBodyAt(source, matchIndex);
  if (!body) return null;

  const excludesSelf =
    /require\s*\(\s*\w+\s*!=\s*address\s*\(\s*this\s*\)/.test(body) ||
    /if\s*\(\s*\w+\s*==\s*address\s*\(\s*this\s*\)\s*\)\s*revert/.test(body);
  if (!excludesSelf) return null;

  return {
    note: "the matched rescue/recover/sweep function explicitly reverts when its token parameter equals this contract's own address, so it can only recover foreign tokens accidentally sent here, not this token's balances"
  };
}

/**
 * Confirms a matched `burnFrom` is the standard OpenZeppelin ERC20Burnable shape: it spends the
 * caller's allowance from the target before burning, so it can only burn tokens the holder has
 * already approved — not an unrestricted admin power to destroy any holder's balance.
 */
function classifyBurnFrom(source: string, matchIndex: number): { note: string } | null {
  const body = extractFunctionBodyAt(source, matchIndex);
  if (!body) return null;

  const allowanceGated =
    /_spendAllowance\s*\(/.test(body) ||
    /allowance\s*\(\s*\w+\s*,\s*(?:_msgSender\s*\(\s*\)|msg\.sender)\s*\)/.test(body);
  if (!allowanceGated) return null;

  return {
    note: "burnFrom spends the target's allowance to the caller before burning — the standard OpenZeppelin ERC20Burnable pattern, which can only burn tokens the holder has already approved, not seize arbitrary balances"
  };
}

/**
 * Confirms the matched identifier is declared `immutable` or `constant` — Solidity's compiler
 * forbids reassigning either outside the constructor, so a matched cooldown/anti-snipe keyword
 * that names one is a fixed, self-expiring launch-window constant, not a knob any function
 * (including one not covered by the setter-name pattern) can ever change post-deployment.
 * Verified against a real false positive: PonsLauncherToken's `launchBlock`/`restrictionEndBlock`
 * are `uint256 public immutable`, fixed forever at deploy time.
 */
function classifyImmutableIdentifier(source: string, _matchIndex: number, matchedText: string): { note: string } | null {
  const idPattern = new RegExp(`\\b${escapeRegExp(matchedText)}\\b`, "g");
  let occurrence: RegExpExecArray | null;
  while ((occurrence = idPattern.exec(source))) {
    const stmtStart = Math.max(source.lastIndexOf(";", occurrence.index), source.lastIndexOf("{", occurrence.index)) + 1;
    const stmtEnd = source.indexOf(";", occurrence.index);
    if (stmtEnd === -1) continue;

    const statement = source.slice(stmtStart, stmtEnd);
    const looksLikeDeclaration = /^\s*(?:uint\d*|int\d*|address|bool|bytes\d*|string)\b/.test(statement);
    if (looksLikeDeclaration && /\b(?:immutable|constant)\b/.test(statement)) {
      return {
        note: `\`${matchedText}\` is declared immutable/constant, fixed forever at deployment — Solidity's compiler forbids any function from reassigning it afterward`
      };
    }
  }
  return null;
}

/**
 * Confirms a matched router/pair setter can only ever fire once — guarded by a check that the
 * state variable it assigns is still unset (typically `require(x == address(0))` or an
 * `if (x != address(0)) revert` guard). A setter that can only run once cannot be used to swap
 * the router/pair out from under holders after launch, unlike a setter callable at any time.
 */
function classifyOneTimeSetterGuard(source: string, matchIndex: number): { note: string } | null {
  const body = extractFunctionBodyAt(source, matchIndex);
  if (!body) return null;

  const hasOneTimeGuard =
    /require\s*\(\s*\w+\s*==\s*address\s*\(\s*0\s*\)/.test(body) ||
    /if\s*\(\s*\w+\s*!=\s*address\s*\(\s*0\s*\)\s*\)\s*revert/.test(body);
  if (!hasOneTimeGuard) return null;

  return {
    note: "the matched setter is guarded to only succeed while the target state variable is still unset (zero address), so it can only run once and cannot replace an already-configured router/pair later"
  };
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
      "The detector matched blacklist, blocklist, or bot-list control terms in verified source code.",
    recommendation:
      "Review who can call these controls and whether trade simulation confirms normal buyers can still sell.",
    patterns: [
      { regex: /\b(?:blacklist|blacklisted|blocklist|blocked|isBot|bots)\b/i },
      { regex: /\bmapping\s*\([^)]*address[^)]*\)\s*(?:public|private|internal)?\s*(?:_|is)?(?:blacklist|blacklisted|blocklist|blocked|bot|bots)/i }
    ]
  },
  {
    code: "SOURCE_TRADING_COOLDOWN_CONTROL",
    title: "Source code exposes cooldown or anti-bot controls",
    severity: "MEDIUM",
    category: "TRADING_SAFETY",
    confidence: "HIGH",
    description:
      "Verified source code contains cooldown, transfer-delay, anti-bot, or anti-snipe controls that can restrict when wallets may trade.",
    technicalExplanation:
      "The detector matched cooldown, transfer-delay, anti-bot, anti-snipe, launch-window, or per-wallet transfer-timestamp terms in verified source code.",
    recommendation:
      "Review whether the cooldown is temporary/fixed or can be changed by a privileged role after launch.",
    patterns: [
      // The bare keyword can match either a mutable knob or a fixed, self-expiring launch-window
      // constant (e.g. Pons: `uint256 public immutable launchBlock`) — classifyImmutableIdentifier
      // tells them apart. Solidity's compiler forbids reassigning immutable/constant variables
      // outside the constructor, so this is a provable guarantee, not a heuristic guess.
      {
        regex: /\b(?:cooldown|coolDown|transferDelay|antiBot|antiSnipe|sniper|launchBlock|limitsInEffect|_holderLastTransferTimestamp|lastTransferTimestamp)\b/i,
        classifyMatch: classifyImmutableIdentifier
      },
      // A named setter function is itself the risk signal regardless of any other variable's
      // mutability — never downgraded.
      { regex: /\bfunction\s+\w*(?:setCooldown|setTransferDelay|setAntiBot|setAntiSnipe|removeLimits)\w*\s*\(/i },
      { regex: /\bmapping\s*\([^)]*address[^)]*\)\s*(?:public|private|internal)?\s*\w*(?:cooldown|lastTransfer|lastTx)\w*/i }
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
      { regex: /\b(?:tradingOpen|tradingEnabled|tradingActive|openTrading|enableTrading|swapEnabled|limitsInEffect|launched)\b/i },
      { regex: /\brequire\s*\([^;]*(?:trading|launched|swapEnabled|limitsInEffect)[^;]*\)/i }
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
      { regex: /\bfunction\s+(?:reclaimOwnership|recoverOwnership|restoreOwnership|manualOwnership|setOwner)\s*\(/i },
      { regex: /\b(?:reclaimOwnership|recoverOwnership|restoreOwnership)\b/i }
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
      { regex: /\b(?:DEFAULT_ADMIN_ROLE|MINTER_ROLE|PAUSER_ROLE|grantRole|revokeRole|_grantRole|AccessControl)\b/i },
      { regex: /\bfunction\s+(?:setAdmin|setOperator|setController|setManager|setMinter|setPauser)\s*\(/i }
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
      "The detector matched forced transfer, confiscation, seizure, unrestricted burnFrom, or suspicious admin transfer function names/source paths.",
    recommendation:
      "Inspect whether any privileged role can transfer tokens from holders without allowance. Treat confirmed forced-transfer capability as critical.",
    patterns: [
      // forceTransfer/seize/confiscate/clawback/wipe have no known-benign shape — any real
      // occurrence stays at full severity, unlike burnFrom and rescue below.
      { regex: /\b(?:forceTransfer|forcedTransfer|adminTransfer|operatorTransfer|seize|confiscate|clawback|wipe)\b/i },
      // burnFrom matches the OpenZeppelin ERC20Burnable name, which is allowance-gated and safe
      // by far the most common case, but an unrestricted override sharing the same name would
      // not be — classifyBurnFrom reads the actual function body to tell them apart.
      { regex: /\bfunction\s+burnFrom\s*\(/i, classifyMatch: classifyBurnFrom },
      {
        regex: /function\s+\w*(?:rescue|recover|sweep)\w*\s*\([^)]*address\s+(?:token|from|account|wallet)/i,
        classifyMatch: classifyRescueFunction
      }
    ]
  },
  {
    code: "SOURCE_OBFUSCATED_ADDRESS",
    title: "Source code contains hidden or obfuscated address construction",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    confidence: "MEDIUM",
    description:
      "Verified source code appears to reconstruct or mask address constants instead of declaring them plainly.",
    technicalExplanation:
      "The detector matched address constants converted through integer casts, bitwise masking/XOR, or short assembly blocks. Plain router/pair address constants are not enough to trigger this rule.",
    recommendation:
      "Manually inspect the matched address construction and confirm what wallet or contract it resolves to before trusting ownership, routing, or fee destinations.",
    patterns: [
      { regex: /\baddress\s*\(\s*uint160\s*\(\s*(?:uint256\s*\(\s*)?0x[a-fA-F0-9]{20,64}\s*\)?\s*\)\s*\)/i },
      { regex: /\baddress\s*\(\s*uint160\s*\([^)]*(?:\^|&|\|)[^)]*0x[a-fA-F0-9]{20,64}[^)]*\)\s*\)/i },
      { regex: /\bassembly\s*\{[\s\S]{0,500}\b(?:mstore|sstore)\b[\s\S]{0,160}0x[a-fA-F0-9]{40,64}[\s\S]{0,500}\}/i }
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
      { regex: /\bfunction\s+\w*mint\w*\s*\([^)]*\)\s*(?:external|public)\b/i },
      { regex: /\b(?:MINTER_ROLE|setMinter|grantRole\s*\(\s*MINTER_ROLE)\b/i },
      { regex: /\b(?:setSupply|increaseSupply)\s*\(/i }
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
      // Only setter-shaped function declarations — a bare "buyTax"/"sellTax"/"taxFee" match
      // false-positives on the extremely common pattern of a local variable or plain state
      // variable holding a computed/fixed tax amount, with no setter anywhere (verified
      // against $GEN: `uint256 buyTax = (value * totalTax) / SWAP_DIVISOR;` is a per-call
      // local variable computing the already-fixed, constructor-capped tax owed on this
      // transfer, not a mutable control surface).
      { regex: /\bfunction\s+set(?:Tax|Taxes|Fees?|BuyFee|SellFee|BuyTax|SellTax|MarketingFee|LiquidityFee)\s*\(/i },
      // Only setter-shaped names (setMaxWallet/setMaxTx/...) — NOT a bare "maxWallet"/"maxTx"/
      // "maxTransaction" match, which false-positives on read-only getters, immutable variable
      // names, struct fields, and even unrelated identifiers like a custom error's parameter
      // name (verified against a real deployed token: `error MaxWalletExceeded(..., uint256
      // maxWallet)` alone triggered this finding with no owner, no setter, and the limit itself
      // declared `immutable` — a false claim of a mutable "control surface" that doesn't exist).
      { regex: /\b(?:setMaxWallet|setMaxTx|setMaxTransaction|excludeFromFees|isExcludedFromFee|whitelist)\b/i }
    ]
  },
  {
    code: "SOURCE_ROUTER_OR_PAIR_REPLACEMENT",
    title: "Source code allows replacing the trading router or pair",
    severity: "HIGH",
    category: "TRADING_SAFETY",
    confidence: "MEDIUM",
    description:
      "Verified source code contains functions that let a privileged role change which DEX router or trading pair the contract treats as canonical.",
    technicalExplanation:
      "The detector matched router- or pair-setter function names in verified source code.",
    recommendation:
      "Review who can call these setters and whether trade simulations against the currently configured router/pair remain valid after a change.",
    patterns: [
      {
        regex: /\bfunction\s+\w*(?:setRouter|setPair|updateRouter|updatePair|setUniswapRouter|setDexRouter)\w*\s*\(/i,
        classifyMatch: classifyOneTimeSetterGuard
      }
    ]
  },
  {
    code: "SOURCE_ARBITRARY_EXTERNAL_CALL",
    title: "Source code contains low-level arbitrary external calls",
    severity: "HIGH",
    category: "CONTRACT_CONTROL",
    confidence: "MEDIUM",
    description:
      "Verified source code contains low-level .call/.delegatecall invocations with externally influenced targets or calldata, which can allow arbitrary code execution or fund movement outside normal ERC-20 semantics.",
    technicalExplanation:
      "The detector matched .delegatecall( (always flagged — it runs the target's code inside this contract's own storage context, regardless of arguments), or .call( carrying real calldata (able to invoke any function on the target). A .call{value: x}(\"\") with empty calldata is excluded: it can only trigger the target's receive()/fallback(), never an arbitrary function — it's the ETH-send idiom Solidity's own docs recommend over .transfer()/.send(), not an arbitrary-execution risk. Verified against a real false positive ($GEN): a fixed, constructor-only recipient list paid via .call{value: share}(\"\") was being flagged identically to a genuine arbitrary-calldata call.",
    recommendation:
      "Inspect whether the call target and calldata are attacker- or admin-controlled, and whether the call is reachable by a privileged role or by any user.",
    patterns: [
      { regex: /\.\s*delegatecall\s*(?:\{[^}]*\})?\s*\(/ },
      { regex: /\.\s*call\s*(?:\{[^}]*\})?\s*\((?!\s*(?:""|'')\s*\))/ }
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

    // Explorers often return every file from the deployed contract's compilation project as
    // "verified source" — including unrelated sibling contracts, mocks, and third-party
    // interfaces that happen to share the same submission but never run as part of this
    // address's bytecode (e.g. a Uniswap interface's `setOwner` declaration, or a platform's
    // OTHER token template). Scanning all of them produces false positives attributed to code
    // this contract doesn't execute. When `contractName` identifies the deployed contract and
    // its declaration is found, scope matching to that file and its real import closure; when
    // it can't be identified, fall back to scanning every file rather than guessing wrong.
    const relevantSourceFiles = relevantSourceFilesFor(input.sourceFiles, input.contractName ?? null);

    const findings: SecurityFinding[] = [];
    const checks: DetectorCheck[] = [];
    for (const rule of sourceRiskRules) {
      const matches = matchSourceRule(relevantSourceFiles, rule);
      // Only downgrade when EVERY match for this rule is individually confirmed benign — one
      // verified-safe rescue function must never mask a separate, unrelated dangerous match
      // (e.g. a real `seize()` elsewhere in the same contract) that the rule also caught.
      const allMatchesBenign = matches.length > 0 && matches.every((m) => m.benignNote);
      const severity = allMatchesBenign ? "INFO" : rule.severity;
      const confidence = allMatchesBenign ? "MEDIUM" : rule.confidence;
      const technicalExplanation = allMatchesBenign
        ? `${rule.technicalExplanation} Verified benign: ${matches
            .map((m) => m.benignNote)
            .filter((note, i, all) => all.indexOf(note) === i)
            .join("; ")}.`
        : rule.technicalExplanation;

      const evidence = createSourceEvidence(context, input, {
        ruleCode: rule.code,
        matches,
        verifiedBenign: allMatchesBenign
      });
      checks.push({
        code: matches.length > 0 ? `${rule.code}_DETECTED` : `${rule.code}_ABSENT`,
        outcome: matches.length > 0 ? "DETECTED" : "PASSED",
        confidence: matches.length > 0 ? confidence : "MEDIUM",
        evidence: [evidence]
      });

      if (matches.length > 0) {
        findings.push(
          createFinding({
            code: rule.code,
            detector: this.metadata,
            title: rule.title,
            severity,
            category: rule.category,
            confidence,
            description: rule.description,
            technicalExplanation,
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

function abiFunctionNames(abi: unknown): Set<string> {
  if (!Array.isArray(abi)) {
    return new Set();
  }

  const names = new Set<string>();
  for (const entry of abi) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).type === "function" &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      names.add((entry as Record<string, unknown>).name as string);
    }
  }
  return names;
}

/**
 * Reads verified ABI function names directly (when source verification succeeded) instead of
 * matching text patterns or bytecode selectors, to identify two-step ownership transfer and
 * OpenZeppelin-style AccessControl roles. ABI presence is a stronger evidence class than a
 * source-text regex match because it reflects the compiler's own recorded function signatures,
 * but it still does not prove a role is currently held by anyone or that a function is
 * reachable — see the finding's technicalExplanation.
 */
export const ownershipRolesAbiDetector: SecurityDetector<ContractSourceDetectorInput> = {
  metadata: {
    id: "ownership-roles-abi",
    version: detectorVersion,
    name: "Ownership and role ABI inspection",
    description:
      "Inspects verified contract ABI for two-step ownership transfer and AccessControl role functions."
  },

  async run(input, context) {
    await Promise.resolve();
    const evidence: FindingEvidence = {
      type: "EXTERNAL_SOURCE",
      summary: "Verified ABI function-name inspection",
      address: context.address,
      data: { abiAvailable: input.status === "VERIFIED" && Array.isArray(input.abi) }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    if (input.status !== "VERIFIED" || !Array.isArray(input.abi)) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "ABI_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const functionNames = abiFunctionNames(input.abi);
    const hasTwoStepOwnership =
      functionNames.has("pendingOwner") && functionNames.has("acceptOwnership");
    const hasAccessControl =
      (functionNames.has("hasRole") && functionNames.has("grantRole")) ||
      functionNames.has("DEFAULT_ADMIN_ROLE");

    const findings: SecurityFinding[] = [];
    if (hasTwoStepOwnership) {
      findings.push(
        createFinding({
          code: "TWO_STEP_OWNERSHIP_PATTERN",
          detector: this.metadata,
          title: "Contract uses a two-step ownership transfer pattern",
          severity: "INFO",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description:
            "The verified ABI exposes pendingOwner() and acceptOwnership(), indicating ownership transfers require a pending step before taking effect.",
          technicalExplanation:
            "Both function names were read directly from the verified contract ABI, not inferred from source text or bytecode selectors.",
          evidence: [evidence],
          recommendation:
            "A simple owner()-equals-burn-address check may not reflect a pending transfer in progress; review pendingOwner() alongside owner()."
        })
      );
    }
    if (hasAccessControl) {
      findings.push(
        createFinding({
          code: "ACCESS_CONTROL_ROLE_SURFACE",
          detector: this.metadata,
          title: "Contract exposes AccessControl-style privileged roles",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description:
            "The verified ABI exposes role-based access control functions, indicating privileged capabilities may exist outside of a single owner() address.",
          technicalExplanation:
            "hasRole/grantRole or DEFAULT_ADMIN_ROLE were read directly from the verified contract ABI, not inferred from source text or bytecode selectors.",
          evidence: [evidence],
          recommendation:
            "Review current role holders; a renounced owner() does not imply no privileged roles remain active."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: findings.length > 0 ? "OWNERSHIP_ROLE_ABI_SURFACE_DETECTED" : "OWNERSHIP_ROLE_ABI_ABSENT",
          outcome: findings.length > 0 ? "DETECTED" : "PASSED",
          confidence: "HIGH",
          evidence: [evidence]
        }
      ],
      findings
    };
  }
};

export interface LiveTradingStateDetectorInput {
  readPausedState(): Promise<boolean | null>;
  readTradingOpenState(): Promise<boolean | null>;
}

/**
 * Calls pause()/trading-toggle-style view functions live on-chain at the scan block, rather
 * than only reporting that the capability exists (see pause-selector-patterns and
 * trading-control-selector-patterns). A null result means the function could not be read
 * (absent, reverted, or not a bool) and is reported as unavailable, never as a passing state.
 */
export const liveTradingStateDetector: SecurityDetector<LiveTradingStateDetectorInput> = {
  metadata: {
    id: "live-trading-state",
    version: detectorVersion,
    name: "Live trading state",
    description: "Reads current pause and trading-enabled status directly on-chain."
  },

  async run(input, context) {
    const [paused, tradingOpen] = await Promise.all([
      input.readPausedState(),
      input.readTradingOpenState()
    ]);
    const evidence: FindingEvidence = {
      type: "FUNCTION",
      summary: "Live pause()/trading-toggle state read at scan block",
      address: context.address,
      data: { paused, tradingOpen }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    const findings: SecurityFinding[] = [];
    if (paused === true) {
      findings.push(
        createFinding({
          code: "TRADING_CURRENTLY_PAUSED",
          detector: this.metadata,
          title: "Contract is currently paused",
          severity: "HIGH",
          category: "TRADING_SAFETY",
          confidence: "HIGH",
          description:
            "A live on-chain read at the scan block shows the contract's pause state is currently true.",
          technicalExplanation:
            "paused() was called directly on-chain at the scan block and returned true.",
          evidence: [evidence],
          recommendation:
            "Do not assume trading is currently possible. Wait for a confirmed unpause before trusting buy/sell simulation results."
        })
      );
    }
    if (tradingOpen === false) {
      findings.push(
        createFinding({
          code: "TRADING_CURRENTLY_DISABLED",
          detector: this.metadata,
          title: "Trading is currently disabled",
          severity: "HIGH",
          category: "TRADING_SAFETY",
          confidence: "HIGH",
          description:
            "A live on-chain read at the scan block shows the contract's trading-enabled flag is currently false.",
          technicalExplanation:
            "A trading-toggle view function (tradingOpen/tradingEnabled/tradingActive) was called directly on-chain at the scan block and returned false.",
          evidence: [evidence],
          recommendation:
            "Treat buy/sell simulations as inconclusive until trading is confirmed open; a contract can selectively allow admin wallets to transact while trading is closed for everyone else."
        })
      );
    }

    const dataAvailable = paused !== null || tradingOpen !== null;
    return {
      detector: this.metadata,
      checks: [
        {
          code:
            findings.length > 0
              ? "LIVE_TRADING_STATE_RESTRICTED"
              : dataAvailable
                ? "LIVE_TRADING_STATE_OPEN"
                : "LIVE_TRADING_STATE_UNAVAILABLE",
          outcome: findings.length > 0 ? "DETECTED" : dataAvailable ? "PASSED" : "DATA_UNAVAILABLE",
          confidence: dataAvailable ? "HIGH" : "LOW",
          evidence: [evidence]
        }
      ],
      findings
    };
  }
};

export interface GenesisPadLaunchDetectorInput {
  launch: {
    originalCreator: `0x${string}`;
    pool: `0x${string}`;
    positionManager: `0x${string}`;
    locker: `0x${string}`;
    positionTokenId: string;
    permanentlyLocked: boolean;
    verified: boolean;
    launchTimestamp: Date;
  } | null;
}

/**
 * Reports confirmed GenesisPad launch provenance from the on-chain GenesisLaunchRegistry
 * (see @genesis-sentinel/providers' GenesisPadLaunchProvider) — never inferred from a website
 * label or token metadata. When permanentlyLocked is true, this is real, registry-confirmed
 * evidence that the token's Uniswap V3 launch position cannot be withdrawn by anyone,
 * independent of the generic V2-only Genesis Locker check.
 */
export const genesispadLaunchDetector: SecurityDetector<GenesisPadLaunchDetectorInput> = {
  metadata: {
    id: "genesispad-launch-provenance",
    version: detectorVersion,
    name: "GenesisPad launch provenance",
    description:
      "Checks the on-chain GenesisLaunchRegistry for a confirmed GenesisPad direct-Uniswap-V3 launch record."
  },

  async run(input, context) {
    await Promise.resolve();

    if (!input.launch) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "GENESISPAD_LAUNCH_NOT_FOUND",
            outcome: "PASSED",
            confidence: "MEDIUM",
            evidence: [
              {
                type: "FUNCTION",
                summary: "GenesisLaunchRegistry.isRegistered() read",
                address: context.address,
                data: { registered: false }
              }
            ]
          }
        ],
        findings: []
      };
    }

    const evidence: FindingEvidence = {
      type: "FUNCTION",
      summary: "GenesisLaunchRegistry.isRegistered()/getLaunch() read",
      address: context.address,
      data: {
        originalCreator: input.launch.originalCreator,
        pool: input.launch.pool,
        positionManager: input.launch.positionManager,
        locker: input.launch.locker,
        positionTokenId: input.launch.positionTokenId,
        permanentlyLocked: input.launch.permanentlyLocked,
        verified: input.launch.verified,
        launchTimestamp: input.launch.launchTimestamp.toISOString()
      }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: "GENESISPAD_LAUNCH_CONFIRMED",
          outcome: "DETECTED",
          confidence: "HIGH",
          evidence: [evidence]
        }
      ],
      findings: [
        createFinding({
          code: "GENESISPAD_CONFIRMED_LAUNCH",
          detector: this.metadata,
          title: input.launch.permanentlyLocked
            ? "Token launched via GenesisPad with liquidity permanently locked"
            : "Token launched via GenesisPad",
          severity: "INFO",
          category: "REPUTATION_RISK",
          confidence: "HIGH",
          description: input.launch.permanentlyLocked
            ? "The on-chain GenesisLaunchRegistry confirms this token was launched via GenesisPad's direct-Uniswap-V3 launch flow, with its launch liquidity position permanently locked and not withdrawable by anyone."
            : "The on-chain GenesisLaunchRegistry confirms this token was launched via GenesisPad's direct-Uniswap-V3 launch flow. Its launch liquidity position is not reported as permanently locked.",
          technicalExplanation:
            "isRegistered() and getLaunch() were read directly from the GenesisLaunchRegistry contract at the scan block; permanentlyLocked reflects the registry's own record, not an inference.",
          evidence: [evidence],
          ...(input.launch.permanentlyLocked
            ? {}
            : {
                recommendation:
                  "Review the launch position directly (pool/positionManager/positionTokenId in evidence) before assuming the launch liquidity is locked."
              })
        })
      ]
    };
  }
};

export interface DeployerHistoryDetectorInput {
  deployerHistory: DeployerHistoryView | null;
  bytecodeReuse: BytecodeReuseView | null;
  /** Fully assembled wallet-relationship edges (DEPLOYED_BY/OWNED_BY/SHARED_BYTECODE plus any
   * FUNDED_BY/TRANSFERRED_SUPPLY_TO edges found via on-chain scans) — see
   * @genesis-sentinel/providers' wallet-clustering.ts for how the latter two are derived. */
  relatedWalletEdges: RelatedWalletEdge[];
}

/**
 * Builds deployer/wallet intelligence entirely from Sentinel's own prior scan history (see
 * @genesis-sentinel/database's getDeployerHistory/getBytecodeReuse) — never an external
 * reputation service or "known scammer" list. Per the project rule, a deployer is never
 * labeled malicious solely for being fresh, reusing bytecode, or having deployed multiple
 * contracts; findings describe only what Sentinel itself observed, in the exact terms
 * observed (counts and outcomes), not a verdict.
 */
export const deployerHistoryDetector: SecurityDetector<DeployerHistoryDetectorInput> = {
  metadata: {
    id: "deployer-history",
    version: detectorVersion,
    name: "Deployer and bytecode history",
    description:
      "Summarizes this deployer's and this contract's bytecode's prior appearances across Sentinel's own scan history."
  },

  async run(input, context) {
    await Promise.resolve();
    const findings: SecurityFinding[] = [];
    const checks: DetectorCheck[] = [];

    if (input.deployerHistory) {
      const evidence: FindingEvidence = {
        type: "EXTERNAL_SOURCE",
        summary: "Sentinel's own prior scans by this deployer address",
        address: context.address,
        data: {
          deployerAddress: input.deployerHistory.deployerAddress,
          previousTokenCount: input.deployerHistory.previousTokenCount,
          previousHighOrCriticalCount: input.deployerHistory.previousHighOrCriticalCount,
          entries: input.deployerHistory.entries
        }
      };
      if (context.blockNumber !== undefined) {
        evidence.blockNumber = context.blockNumber;
      }

      if (input.deployerHistory.previousTokenCount > 0) {
        const { previousTokenCount, previousHighOrCriticalCount } = input.deployerHistory;
        const severity: FindingSeverity =
          previousHighOrCriticalCount >= 3
            ? "HIGH"
            : previousHighOrCriticalCount > 0
              ? "MEDIUM"
              : "INFO";

        findings.push(
          createFinding({
            code: "DEPLOYER_PRIOR_SCAN_HISTORY",
            detector: this.metadata,
            title: "Deployer has prior tokens scanned by Sentinel",
            severity,
            category: "REPUTATION_RISK",
            confidence: "HIGH",
            description:
              previousHighOrCriticalCount > 0
                ? `This deployer address previously created ${previousTokenCount} other token(s) scanned by Sentinel. ${previousHighOrCriticalCount} of those scans recorded a HIGH or CRITICAL severity finding.`
                : `This deployer address previously created ${previousTokenCount} other token(s) scanned by Sentinel. None of those scans recorded a HIGH or CRITICAL severity finding.`,
            technicalExplanation:
              "Computed by matching this scan's deployer address against Token.deployerAddress across Sentinel's own persisted scan history for this chain, excluding the current token.",
            evidence: [evidence],
            recommendation:
              "This describes Sentinel's own scan history only, not a verdict — review the individual prior scans linked in evidence before drawing a conclusion."
          })
        );
      }

      checks.push({
        code:
          input.deployerHistory.previousTokenCount > 0
            ? "DEPLOYER_HISTORY_FOUND"
            : "DEPLOYER_HISTORY_ABSENT",
        outcome: input.deployerHistory.previousTokenCount > 0 ? "DETECTED" : "PASSED",
        confidence: "HIGH",
        evidence: [evidence]
      });
    } else {
      checks.push({
        code: "DEPLOYER_HISTORY_UNAVAILABLE",
        outcome: "DATA_UNAVAILABLE",
        confidence: "LOW",
        evidence: [
          {
            type: "EXTERNAL_SOURCE",
            summary: "No deployer address was available to search Sentinel's scan history",
            address: context.address,
            data: {}
          }
        ]
      });
    }

    if (input.bytecodeReuse && input.bytecodeReuse.reusedByCount > 0) {
      const evidence: FindingEvidence = {
        type: "BYTECODE",
        summary: "Sentinel's own scans of contracts with identical runtime bytecode",
        address: context.address,
        data: {
          bytecodeHash: input.bytecodeReuse.bytecodeHash,
          reusedByCount: input.bytecodeReuse.reusedByCount,
          reusedByAddresses: input.bytecodeReuse.reusedByAddresses
        }
      };
      if (context.blockNumber !== undefined) {
        evidence.blockNumber = context.blockNumber;
      }

      findings.push(
        createFinding({
          code: "BYTECODE_REUSED_ACROSS_SCANS",
          detector: this.metadata,
          title: "Contract bytecode matches other contracts scanned by Sentinel",
          severity: "MEDIUM",
          category: "REPUTATION_RISK",
          confidence: "HIGH",
          description: `This contract's runtime bytecode is byte-for-byte identical to ${input.bytecodeReuse.reusedByCount} other contract(s) Sentinel has scanned on this chain.`,
          technicalExplanation:
            "Computed by comparing this contract's SHA-256 runtime bytecode hash against Contract.bytecodeHash across Sentinel's own persisted scan history for this chain.",
          evidence: [evidence],
          recommendation:
            "Identical bytecode can mean a shared, audited template (e.g. a token launchpad's standard contract) or a cloned scam factory — review the other addresses in evidence to tell which."
        })
      );
      checks.push({
        code: "BYTECODE_REUSE_DETECTED",
        outcome: "DETECTED",
        confidence: "HIGH",
        evidence: [evidence]
      });
    }

    if (input.relatedWalletEdges.length > 0) {
      const edgeEvidence: FindingEvidence = {
        type: "EXTERNAL_SOURCE",
        summary: "Related-wallet edges derived from on-chain evidence, never timing coincidence",
        address: context.address,
        data: { edges: input.relatedWalletEdges }
      };
      if (context.blockNumber !== undefined) {
        edgeEvidence.blockNumber = context.blockNumber;
      }
      checks.push({
        code: "WALLET_CLUSTERING_EDGES_FOUND",
        outcome: "DETECTED",
        confidence: "HIGH",
        evidence: [edgeEvidence]
      });

      // One finding per recipient, summed by category, meant N transfers (e.g. N early bonding-
      // curve buyers, or N pool/locker addresses the pool-address filter didn't already catch)
      // could linearly inflate DISTRIBUTION_RISK to CRITICAL regardless of whether any single
      // recipient was actually concerning (verified against a real case, $GEN: 5 transfers of
      // ~4-5% each summed 6 x MEDIUM into a capped 100/CRITICAL score). Emitting exactly one
      // finding — still carrying every recipient in its evidence, so nothing is hidden — reports
      // the same underlying fact without multiplying its score weight by however many recipients
      // happened to be found.
      const supplyTransferEdges = input.relatedWalletEdges.filter(
        (edge) => edge.type === "TRANSFERRED_SUPPLY_TO"
      );
      if (supplyTransferEdges.length > 0) {
        const supplyTransferEvidence: FindingEvidence = {
          type: "EXTERNAL_SOURCE",
          summary: "Supply transfers from the deployer to other wallets, never timing coincidence",
          address: context.address,
          data: { edges: supplyTransferEdges }
        };
        if (context.blockNumber !== undefined) {
          supplyTransferEvidence.blockNumber = context.blockNumber;
        }
        findings.push(
          createFinding({
            code: "SUPPLY_TRANSFERRED_TO_WALLET",
            detector: this.metadata,
            title:
              supplyTransferEdges.length === 1
                ? "Deployer transferred a significant share of supply to another wallet"
                : `Deployer transferred supply to ${supplyTransferEdges.length} other wallets`,
            severity: "MEDIUM",
            category: "DISTRIBUTION_RISK",
            confidence: strongestConfidence(supplyTransferEdges.map((edge) => edge.confidence)),
            description:
              supplyTransferEdges.length === 1
                ? `${supplyTransferEdges[0]?.evidence} (${supplyTransferEdges[0]?.address})`
                : `The deployer transferred supply to ${supplyTransferEdges.length} other wallets. See evidence for each recipient and its share.`,
            technicalExplanation: "Edge type TRANSFERRED_SUPPLY_TO, source: erc20-transfer-log-scan.",
            evidence: [supplyTransferEvidence],
            recommendation:
              "Review each recipient in evidence: is it a known team/vesting/exchange wallet, a legitimate early buyer, or an unexplained large holder?"
          })
        );
      }

      for (const edge of input.relatedWalletEdges) {
        if (edge.type === "FUNDED_BY") {
          findings.push(
            createFinding({
              code: "DEPLOYER_FUNDED_BY_WALLET",
              detector: this.metadata,
              title: "Deployer wallet's funding source identified",
              severity: "INFO",
              category: "REPUTATION_RISK",
              confidence: edge.confidence,
              description: `${edge.evidence} (${edge.address})`,
              technicalExplanation: `Edge type ${edge.type}, source: ${edge.source}.`,
              evidence: [edgeEvidence]
            })
          );
        }
      }
    } else {
      checks.push({
        code: "WALLET_CLUSTERING_EDGES_ABSENT",
        outcome: "PASSED",
        confidence: "MEDIUM",
        evidence: [
          {
            type: "EXTERNAL_SOURCE",
            summary: "No related-wallet edges were found from available on-chain evidence",
            address: context.address,
            data: {}
          }
        ]
      });
    }

    return {
      detector: this.metadata,
      checks,
      findings
    };
  }
};

export interface LedgerAccountReconciliation {
  address: `0x${string}`;
  /** Raw balance at `fromBlock`. */
  balanceBefore: string;
  /** Raw balance at `toBlock`. */
  balanceAfter: string;
  /** Sum of raw Transfer amounts received by this address within the window. */
  transferredIn: string;
  /** Sum of raw Transfer amounts sent by this address within the window. */
  transferredOut: string;
}

export interface LedgerReconciliation {
  fromBlock: string;
  toBlock: string;
  accounts: LedgerAccountReconciliation[];
  totalSupplyBefore: string | null;
  totalSupplyAfter: string | null;
}

export interface LedgerIntegrityDetectorInput {
  readReconciliation(): Promise<LedgerReconciliation | null>;
}

interface LedgerDiscrepancy {
  address: `0x${string}`;
  expectedRaw: string;
  actualRaw: string;
  differenceRaw: string;
  direction: "DECREASE" | "INCREASE";
}

/**
 * ERC-20 requires every balance change to emit a Transfer event, so a holder's balance must
 * always satisfy `after == before + transfersIn - transfersOut`. This detector reconciles that
 * identity over a bounded block window and reports any account where it does not hold.
 *
 * A violation is arithmetic proof — not a heuristic — that the contract rewrites balances
 * outside the ERC-20 interface. It is the only check that catches "out-of-band balance
 * deletion" rugs, where the token behaves perfectly during buy/sell simulation and the operator
 * later deletes victims' balances in a separate transaction; no trade simulation can observe
 * that, because at simulation time nothing is wrong.
 */
export const ledgerIntegrityDetector: SecurityDetector<LedgerIntegrityDetectorInput> = {
  metadata: {
    id: "ledger-integrity",
    version: detectorVersion,
    name: "Ledger integrity",
    description:
      "Reconciles observed balance changes against emitted Transfer events to detect balances rewritten outside the ERC-20 interface."
  },

  async run(input, context) {
    const reconciliation = await input.readReconciliation();
    const evidence: FindingEvidence = {
      type: "HOLDER_DATA",
      summary: "Balance-vs-Transfer-event reconciliation over a bounded block window",
      address: context.address,
      data: { reconciliation }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    if (!reconciliation || reconciliation.accounts.length === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "LEDGER_INTEGRITY_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const discrepancies: LedgerDiscrepancy[] = [];
    let reconciledAccounts = 0;
    for (const account of reconciliation.accounts) {
      const before = parseRawAmount(account.balanceBefore);
      const after = parseRawAmount(account.balanceAfter);
      const received = parseRawAmount(account.transferredIn);
      const sent = parseRawAmount(account.transferredOut);
      if (before === null || after === null || received === null || sent === null) {
        continue;
      }

      reconciledAccounts += 1;
      const expected = before + received - sent;
      if (expected === after) continue;

      const difference = after - expected;
      discrepancies.push({
        address: account.address,
        expectedRaw: expected.toString(),
        actualRaw: after.toString(),
        differenceRaw: difference.toString(),
        direction: difference < 0n ? "DECREASE" : "INCREASE"
      });
    }

    if (reconciledAccounts === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "LEDGER_INTEGRITY_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const deletions = discrepancies.filter((entry) => entry.direction === "DECREASE");
    const inflations = discrepancies.filter((entry) => entry.direction === "INCREASE");
    const findings: SecurityFinding[] = [];
    const discrepancyEvidence: FindingEvidence = {
      ...evidence,
      summary: "Accounts whose balance change is not explained by any Transfer event",
      data: { reconciliation, discrepancies }
    };

    if (deletions.length > 0) {
      findings.push(
        createFinding({
          code: "LEDGER_BALANCE_DELETED",
          detector: this.metadata,
          title: "Token deletes holder balances without emitting Transfer events",
          severity: "CRITICAL",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description: `${deletions.length} holder balance${deletions.length === 1 ? "" : "s"} decreased with no corresponding Transfer event. The contract can remove tokens from any wallet at will, and holders cannot see it happen on a block explorer.`,
          technicalExplanation:
            "ERC-20 requires every balance change to emit Transfer, so balanceAfter must equal balanceBefore + transfersIn - transfersOut. These accounts ended below that value, proving the contract writes its balance mapping outside the ERC-20 interface.",
          evidence: [discrepancyEvidence],
          recommendation:
            "Treat this token as unsafe to hold at any size. Balances can be zeroed at the operator's discretion, and buy/sell simulation cannot protect against it because the deletion happens in a separate transaction."
        })
      );
    }

    if (inflations.length > 0) {
      findings.push(
        createFinding({
          code: "LEDGER_BALANCE_INFLATED",
          detector: this.metadata,
          title: "Token increases balances without emitting Transfer events",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description: `${inflations.length} holder balance${inflations.length === 1 ? "" : "s"} increased with no corresponding Transfer event, indicating a hidden mint or rebase that is invisible to explorers and holders.`,
          technicalExplanation:
            "These accounts ended above balanceBefore + transfersIn - transfersOut, so the contract credited tokens without emitting Transfer.",
          evidence: [discrepancyEvidence],
          recommendation:
            "Do not rely on displayed supply or holder distribution for this token; balances can be created silently, which can be used to drain a pool."
        })
      );
    }

    const supplyBefore = parseRawAmount(reconciliation.totalSupplyBefore);
    const supplyAfter = parseRawAmount(reconciliation.totalSupplyAfter);
    if (deletions.length > 0 && supplyBefore !== null && supplyAfter !== null && supplyBefore === supplyAfter) {
      findings.push(
        createFinding({
          code: "LEDGER_SUPPLY_MISMATCH",
          detector: this.metadata,
          title: "Deleted balances were never removed from total supply",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description:
            "Holder balances were deleted while totalSupply stayed unchanged, so the token's own accounting does not balance.",
          technicalExplanation:
            "A legitimate burn decrements totalSupply and emits Transfer to the zero address. Here balances fell with neither, so the reported supply overstates the tokens that actually exist.",
          evidence: [discrepancyEvidence],
          recommendation:
            "Treat every supply-derived figure for this token (market cap, holder percentages, circulating supply) as unreliable."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: discrepancies.length > 0 ? "LEDGER_INTEGRITY_VIOLATED" : "LEDGER_INTEGRITY_CONSISTENT",
          outcome: discrepancies.length > 0 ? "DETECTED" : "PASSED",
          confidence: "HIGH",
          evidence: [discrepancies.length > 0 ? discrepancyEvidence : evidence]
        }
      ],
      findings
    };
  }
};

export interface PoolReserveSample {
  poolAddress: `0x${string}`;
  protocol?: string;
  /** Reserve the pool itself reports (getReserves / cached state). */
  reportedTokenReserveRaw: string;
  /** Real balanceOf(pool) for the scanned token. */
  actualTokenBalanceRaw: string;
}

export interface PoolReserveIntegrityDetectorInput {
  readPoolReserves(): Promise<PoolReserveSample[] | null>;
}

/**
 * Cross-checks what a pool claims to hold against what the token contract says the pool
 * actually holds. A constant-product pool prices trades off its cached reserves, so if the real
 * balance is far below the cached reserve the displayed price and depth are fiction and the
 * pool can be drained by a tiny swap.
 *
 * Small, short-lived gaps are normal: a Uniswap V2 pair's reserves legitimately lag a direct
 * transfer until the next sync(), and fee-on-transfer tokens drift slightly. Only order-of-
 * magnitude gaps are treated as critical.
 */
export const poolReserveIntegrityDetector: SecurityDetector<PoolReserveIntegrityDetectorInput> = {
  metadata: {
    id: "pool-reserve-integrity",
    version: detectorVersion,
    name: "Pool reserve integrity",
    description:
      "Compares pool-reported reserves against real token balances held by the pool to detect a desynced or pre-drained pool."
  },

  async run(input, context) {
    const samples = await input.readPoolReserves();
    const evidence: FindingEvidence = {
      type: "LIQUIDITY_DATA",
      summary: "Pool-reported reserves vs real token balance held by the pool",
      address: context.address,
      data: { samples }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    if (!samples || samples.length === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "POOL_RESERVE_INTEGRITY_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const mismatches: Array<{
      poolAddress: `0x${string}`;
      reportedRaw: string;
      actualRaw: string;
      /** How many times larger the reported reserve is than the real balance. */
      overstatementFactor: number | null;
    }> = [];
    let comparedPools = 0;

    for (const sample of samples) {
      const reported = parseRawAmount(sample.reportedTokenReserveRaw);
      const actual = parseRawAmount(sample.actualTokenBalanceRaw);
      if (reported === null || actual === null || reported <= 0n) continue;
      comparedPools += 1;

      if (actual === 0n) {
        mismatches.push({
          poolAddress: sample.poolAddress,
          reportedRaw: reported.toString(),
          actualRaw: "0",
          overstatementFactor: null
        });
        continue;
      }

      // Ratio in basis points keeps precision without converting huge reserves to float.
      const ratioBps = Number((reported * 10_000n) / actual) / 10_000;
      if (ratioBps > POOL_RESERVE_TOLERANCE_RATIO) {
        mismatches.push({
          poolAddress: sample.poolAddress,
          reportedRaw: reported.toString(),
          actualRaw: actual.toString(),
          overstatementFactor: ratioBps
        });
      }
    }

    if (comparedPools === 0) {
      return {
        detector: this.metadata,
        checks: [
          {
            code: "POOL_RESERVE_INTEGRITY_UNAVAILABLE",
            outcome: "DATA_UNAVAILABLE",
            confidence: "LOW",
            evidence: [evidence]
          }
        ],
        findings: []
      };
    }

    const findings: SecurityFinding[] = [];
    const mismatchEvidence: FindingEvidence = {
      ...evidence,
      summary: "Pools whose reported reserves exceed the tokens they actually hold",
      data: { samples, mismatches }
    };
    const severe = mismatches.filter(
      (entry) => entry.overstatementFactor === null || entry.overstatementFactor >= POOL_RESERVE_CRITICAL_RATIO
    );

    if (severe.length > 0) {
      findings.push(
        createFinding({
          code: "POOL_RESERVE_DESYNC_CRITICAL",
          detector: this.metadata,
          title: "Pool holds far fewer tokens than its reserves claim",
          severity: "CRITICAL",
          category: "LIQUIDITY_SAFETY",
          confidence: "HIGH",
          description:
            "At least one pool reports token reserves that are orders of magnitude larger than the tokens it actually holds, so the price and depth shown to traders are not real.",
          technicalExplanation:
            "A constant-product pool prices swaps from its cached reserves. When the real balance is far below the cached reserve, a very small sell can extract nearly the entire paired asset, which is the setup used to drain a pool.",
          evidence: [mismatchEvidence],
          recommendation:
            "Do not trade against this pool. The quoted liquidity does not exist and the pool is positioned to be drained."
        })
      );
    } else if (mismatches.length > 0) {
      findings.push(
        createFinding({
          code: "POOL_RESERVE_DESYNC",
          detector: this.metadata,
          title: "Pool reserves do not match the pool's real token balance",
          severity: "MEDIUM",
          category: "LIQUIDITY_SAFETY",
          confidence: "MEDIUM",
          description:
            "A pool's reported reserves exceed the tokens it actually holds by more than normal rounding, so quoted prices may be stale or slightly overstated.",
          technicalExplanation:
            "Reserves can legitimately lag a direct transfer until the next sync(), and fee-on-transfer tokens drift, so a modest gap is not proof of manipulation on its own.",
          evidence: [mismatchEvidence],
          recommendation:
            "Re-scan before trading. If the gap widens or persists, treat the quoted liquidity as unreliable."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: mismatches.length > 0 ? "POOL_RESERVE_DESYNC_DETECTED" : "POOL_RESERVES_CONSISTENT",
          outcome: mismatches.length > 0 ? "DETECTED" : "PASSED",
          confidence: mismatches.length > 0 ? "HIGH" : "MEDIUM",
          evidence: [mismatches.length > 0 ? mismatchEvidence : evidence]
        }
      ],
      findings
    };
  }
};

/** Reported reserves above this multiple of the real balance are reported at all. */
const POOL_RESERVE_TOLERANCE_RATIO = 1.05;
/** Reported reserves above this multiple are treated as a staged drain, not drift. */
const POOL_RESERVE_CRITICAL_RATIO = 10;

/** Router/factory selectors a plain ERC-20 has no reason to embed or call. */
const dexInteractionSelectors = {
  poolControl: [
    { selector: "c45a0155", label: "factory()" },
    { selector: "c9c65396", label: "createPair(address,address)" },
    { selector: "f305d719", label: "addLiquidityETH(...)" },
    { selector: "e8e33700", label: "addLiquidity(...)" },
    { selector: "baa2abde", label: "removeLiquidity(...)" },
    { selector: "02751cec", label: "removeLiquidityETH(...)" }
  ],
  swap: [
    { selector: "791ac947", label: "swapExactTokensForETHSupportingFeeOnTransferTokens(...)" },
    { selector: "b6f9de95", label: "swapExactETHForTokensSupportingFeeOnTransferTokens(...)" },
    { selector: "38ed1739", label: "swapExactTokensForTokens(...)" },
    { selector: "18cbafe5", label: "swapExactTokensForETH(...)" }
  ]
} as const;

/**
 * Reports DEX router/factory call surfaces embedded in a token's own bytecode. Like the other
 * selector-surface detectors, this describes what the contract is wired to do and does not
 * claim exploitability.
 *
 * Swap selectors alone are common in tax tokens that auto-swap fees, so they are reported at
 * MEDIUM. Pool-control selectors (createPair / addLiquidity / removeLiquidity) are a much
 * stronger signal: a token that can create or modify its own pool can also desync or drain it.
 */
export const dexInteractionSurfaceDetector: SecurityDetector<BytecodeDetectorInput> = {
  metadata: {
    id: "dex-interaction-surface",
    version: detectorVersion,
    name: "DEX interaction surface",
    description:
      "Detects DEX router and factory call surfaces embedded in the token's own bytecode."
  },

  async run(input, context) {
    await Promise.resolve();
    const bytecode = input.bytecode.toLowerCase();
    const found = (group: readonly { selector: string; label: string }[]) =>
      group.filter((entry) => bytecode.includes(entry.selector)).map((entry) => entry.label);

    const poolControl = found(dexInteractionSelectors.poolControl);
    const swap = found(dexInteractionSelectors.swap);
    const evidence: FindingEvidence = {
      type: "BYTECODE",
      summary: "DEX router/factory selectors present in token bytecode",
      address: context.address,
      data: { poolControlSurfaces: poolControl, swapSurfaces: swap }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    const findings: SecurityFinding[] = [];
    if (poolControl.length > 0) {
      findings.push(
        createFinding({
          code: "TOKEN_POOL_CONTROL_SURFACE",
          detector: this.metadata,
          title: "Token bytecode can create or modify its own liquidity pool",
          severity: "HIGH",
          category: "LIQUIDITY_SAFETY",
          confidence: "MEDIUM",
          description:
            "The token embeds DEX factory or liquidity-management selectors, so the contract itself is wired to create pairs or add and remove liquidity.",
          technicalExplanation: `Pool-control selectors found in bytecode: ${poolControl.join(", ")}. A standard ERC-20 never needs to call a factory or router.`,
          evidence: [evidence],
          recommendation:
            "Confirm who can trigger these paths. A token that manages its own pool can move or withdraw liquidity independently of the LP holders."
        })
      );
    }
    if (swap.length > 0) {
      findings.push(
        createFinding({
          code: "TOKEN_ROUTER_SWAP_SURFACE",
          detector: this.metadata,
          title: "Token bytecode calls a DEX router to swap",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description:
            "The token embeds router swap selectors, typically used to auto-swap collected fees. This is common in fee-taking tokens but means the contract trades on its own behalf.",
          technicalExplanation: `Router swap selectors found in bytecode: ${swap.join(", ")}.`,
          evidence: [evidence],
          recommendation:
            "Check the fee rate and where swapped proceeds are sent; this path routes value out of the contract during ordinary transfers."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: findings.length > 0 ? "DEX_INTERACTION_SURFACE_PRESENT" : "DEX_INTERACTION_SURFACE_ABSENT",
          outcome: findings.length > 0 ? "DETECTED" : "PASSED",
          confidence: "MEDIUM",
          evidence: [evidence]
        }
      ],
      findings
    };
  }
};

export interface TransferGateDetectorInput {
  bytecode: `0x${string}`;
  /** Runtime code at an address, or null when it has none (a plain EOA). */
  resolveCode(address: `0x${string}`): Promise<`0x${string}` | null>;
  /**
   * Calls `address` with empty calldata from `origin` and resolves true when the call
   * succeeds. Empty calldata hits receive()/fallback(), which is what a token's transfer hook
   * triggers, so a revert here means that origin would not be allowed to transfer.
   */
  probeCall(address: `0x${string}`, origin: `0x${string}`): Promise<boolean>;
  /** Synthetic origins used for probing; none of them should be pre-authorized by an operator. */
  probeOrigins: `0x${string}`[];
  /** Whether ownership currently reads as renounced, for the residual-control finding. */
  ownershipRenounced?: boolean | null;
  /** Addresses that are expected constants (router, factory, WETH, pools, chain infrastructure). */
  ignoredAddresses?: `0x${string}`[];
}

/** EIP-7702 sets an EOA's code to this prefix followed by the delegate address. */
const eip7702CodePrefix = "0xef0100";
/** Bounds the number of hardcoded addresses probed, so a large contract can't fan out reads. */
const transferGateCandidateLimit = 12;

interface TransferGateCandidate {
  address: `0x${string}`;
  delegatedTo: `0x${string}` | null;
  blocksSyntheticOrigins: boolean;
}

/**
 * Finds addresses hardcoded into a token's bytecode that behave like a transfer gate.
 *
 * The pattern this exists for: a token calls a hardcoded address on every transfer, and that
 * address is an EOA whose code was set via EIP-7702 to an allowlist contract that reverts
 * unless `flags[tx.origin]` is set. Only wallets the operator pre-authorized can transact, so
 * ordinary buyers cannot sell — and because the gate lives outside the token, reading the
 * token's own source or selectors never reveals it.
 *
 * A 7702-delegated EOA hardcoded into a token is itself a strong signal: legitimate tokens
 * hardcode routers, factories and wrapped-native contracts, which are ordinary contracts.
 * Callers pass those (and chain infrastructure) in `ignoredAddresses` so they are not reported.
 */
export const transferGateDetector: SecurityDetector<TransferGateDetectorInput> = {
  metadata: {
    id: "transfer-gate-surface",
    version: detectorVersion,
    name: "Transfer gate surface",
    description:
      "Resolves addresses hardcoded in token bytecode and detects EIP-7702 delegated allowlist gates that can block transfers."
  },

  async run(input, context) {
    const ignored = new Set(
      (input.ignoredAddresses ?? []).map((address) => address.toLowerCase())
    );
    ignored.add(context.address.toLowerCase());
    ignored.add(`0x${"0".repeat(40)}`);

    const candidates = extractHardcodedAddresses(input.bytecode)
      .filter((address) => !ignored.has(address.toLowerCase()))
      .slice(0, transferGateCandidateLimit);

    const gates: TransferGateCandidate[] = [];
    for (const address of candidates) {
      const code = await input.resolveCode(address);
      if (!code || !code.toLowerCase().startsWith(eip7702CodePrefix)) continue;

      // Code layout is the 3-byte prefix followed by the 20-byte delegate address.
      const delegate = `0x${code.slice(eip7702CodePrefix.length)}`.toLowerCase();
      const results = await Promise.all(
        input.probeOrigins.map((origin) => input.probeCall(address, origin))
      );
      gates.push({
        address,
        delegatedTo: /^0x[0-9a-f]{40}$/u.test(delegate) ? (delegate as `0x${string}`) : null,
        // Every synthetic origin being rejected is what separates an allowlist gate from a
        // contract that simply has no receive() — a plain rejection would be uniform anyway,
        // so this is reported as a gate surface, and the allowlist reading is what the
        // finding text claims only when combined with the 7702 delegation above.
        blocksSyntheticOrigins: results.length > 0 && results.every((allowed) => !allowed)
      });
    }

    const evidence: FindingEvidence = {
      type: "BYTECODE",
      summary: "Hardcoded addresses in token bytecode resolved for EIP-7702 delegation",
      address: context.address,
      data: { candidateCount: candidates.length, gates }
    };
    if (context.blockNumber !== undefined) {
      evidence.blockNumber = context.blockNumber;
    }

    const findings: SecurityFinding[] = [];
    const blocking = gates.filter((gate) => gate.blocksSyntheticOrigins);

    if (blocking.length > 0) {
      findings.push(
        createFinding({
          code: "TRANSFER_GATE_ALLOWLIST",
          detector: this.metadata,
          title: "Transfers route through an allowlist gate that rejects ordinary wallets",
          severity: "CRITICAL",
          category: "TRADING_SAFETY",
          confidence: "HIGH",
          description:
            "The token has a hardcoded EIP-7702 delegated account that rejected every unaffiliated wallet we tested. If transfers call it, only wallets the operator pre-authorized can trade.",
          technicalExplanation: `Hardcoded address(es) ${blocking.map((gate) => gate.address).join(", ")} carry EIP-7702 delegated code and reverted an empty call from every synthetic origin probed. The gate lives outside the token, so the token's own source or selectors do not reveal it.`,
          evidence: [evidence],
          recommendation:
            "Do not assume you will be able to sell. Treat a passing buy/sell simulation as inconclusive, since the operator controls the allowlist and can change it per wallet at any time."
        })
      );
    } else if (gates.length > 0) {
      findings.push(
        createFinding({
          code: "TRANSFER_GATE_DELEGATED_ACCOUNT",
          detector: this.metadata,
          title: "Token hardcodes an EIP-7702 delegated account",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description:
            "An address hardcoded in the token's bytecode is an EOA whose code was set via EIP-7702, meaning its behavior is controlled by a delegate contract and can be changed by its owner.",
          technicalExplanation: `Hardcoded address(es) ${gates.map((gate) => `${gate.address} -> ${gate.delegatedTo ?? "unresolved"}`).join(", ")} return EIP-7702 delegation code. Routers, factories and wrapped-native contracts are ordinary contracts, so this is not a normal constant for a token to embed.`,
          evidence: [evidence],
          recommendation:
            "Review what the token calls this address for. Its code can be swapped by whoever controls the account, so behavior verified today is not guaranteed tomorrow."
        })
      );
    }

    if (gates.length > 0 && input.ownershipRenounced === true) {
      findings.push(
        createFinding({
          code: "RENOUNCED_BUT_EXTERNALLY_GATED",
          detector: this.metadata,
          title: "Ownership reads as renounced while control remains through a hardcoded gate",
          severity: "HIGH",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description:
            "owner() reports no owner, but the token still defers to a hardcoded externally-controlled account, so renouncement does not mean control was given up.",
          technicalExplanation:
            "Ownership renouncement only removes the owner() role. A hardcoded address whose code is controlled by someone else retains influence over transfers regardless of what owner() returns.",
          evidence: [evidence],
          recommendation:
            "Do not treat this token as ownerless. Judge it by what the hardcoded gate can do, not by the renouncement."
        })
      );
    }

    return {
      detector: this.metadata,
      checks: [
        {
          code: gates.length > 0 ? "TRANSFER_GATE_DETECTED" : "TRANSFER_GATE_ABSENT",
          outcome: gates.length > 0 ? "DETECTED" : "PASSED",
          confidence: gates.length > 0 ? "HIGH" : "MEDIUM",
          evidence: [evidence]
        }
      ],
      findings
    };
  }
};

/**
 * Recovers address constants stored in a contract's data section, where Solidity places
 * immutables and hardcoded addresses as 20 bytes left-padded into a 32-byte word.
 *
 * Search bound, stated plainly: this reads the padded-word form only. Scanning for PUSH20
 * immediates as well was tried and rejected — because a byte scan crosses instruction
 * boundaries it produced 268 candidates on an ordinary router versus 13 here, which is too
 * noisy to resolve. The cost is that an address embedded solely as a PUSH20 immediate is not
 * recovered, so a null result means "no padded constant found", never "no gate exists".
 *
 * Measured on real Robinhood Chain contracts: 1 candidate for the uhood token (exactly its real
 * gate), 0 for WETH, 2-5 for ordinary tokens, 13 for a 21KB router.
 */
function extractHardcodedAddresses(bytecode: string): `0x${string}`[] {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2).toLowerCase() : bytecode.toLowerCase();
  const zeroPadding = "0".repeat(24);
  const found = new Set<`0x${string}`>();

  for (let index = 0; index + 64 <= hex.length; index += 2) {
    if (hex.slice(index, index + 24) !== zeroPadding) continue;
    // Only take the start of a zero run. Without this a single padded word matches at every
    // offset inside its padding and one constant becomes dozens of phantom candidates.
    if (index >= 2 && hex.slice(index - 2, index) === "00") continue;

    const candidate = hex.slice(index + 24, index + 64);
    if (/^0+$/u.test(candidate) || /^f+$/u.test(candidate)) continue;
    // A 20-byte run of printable ASCII is a string fragment, not an address.
    if (isPrintableAsciiRun(candidate)) continue;
    found.add(`0x${candidate}`);
  }

  return [...found];
}

function isPrintableAsciiRun(hex: string): boolean {
  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16);
    if (!Number.isFinite(byte) || byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

function parseRawAmount(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function createEmptyDetectorResult(metadata: DetectorMetadata): DetectorResult {
  return {
    detector: metadata,
    checks: [],
    findings: []
  };
}

export async function runFoundationDetectors(
  input: BytecodeDetectorInput &
    TokenMetadataDetectorInput &
    OwnerAddressDetectorInput &
    StorageReaderDetectorInput,
  context: DetectorContext
): Promise<DetectorResult[]> {
  const bytecodeInput = { bytecode: input.bytecode };
  const storageInput = { getStorageAt: (slot: `0x${string}`) => input.getStorageAt(slot) };
  return [
    await contractCodeExistenceDetector.run(bytecodeInput, context),
    await erc20MetadataDetector.run(input, context),
    await ownershipStatusDetector.run(input, context),
    await eip1967ProxyDetector.run(storageInput, context),
    await dangerousOpcodeDetector.run(bytecodeInput, context),
    ...(await Promise.all(
      selectorPatternDetectors.map((detector) => detector.run(bytecodeInput, context))
    ))
  ];
}

/**
 * Deterministic, versioned risk scoring (Milestone 7). Always returns an assessment — an empty
 * finding set produces an explicit `UNABLE_TO_ASSESS`/`score: null` result rather than no
 * assessment at all, so "no evidence yet" is never silently indistinguishable from "no risk
 * found." Evidence gaps (unsupported/unavailable/inconclusive/failed checks) are surfaced as
 * `unableToAssessReasons` alongside any numeric score, since a token can have real findings in
 * one category and missing evidence in another at the same time.
 *
 * Per-finding weight and per-category aggregation are unchanged in spirit from the prior
 * version: severity/confidence weighted, capped at 100 per category, overall score is the
 * maximum category score (not a cross-category sum) — see docs/architecture/risk-model.md for
 * why this avoids pushing every token toward 100 and for worked examples of why one category's
 * good news (e.g. renounced ownership, locked liquidity, a successful sell simulation) does not
 * erase a different category's finding.
 */
export function scoreFindings(
  detectorResults: DetectorResult[],
  scannerVersion: string
): ScoredRiskAssessment {
  const findings = detectorResults.flatMap((result) => result.findings);
  const unableToAssessReasons = collectUnableToAssessReasons(detectorResults);

  if (findings.length === 0) {
    return {
      score: null,
      level: "UNABLE_TO_ASSESS",
      confidence: "LOW",
      categoryScores: [],
      findingContributions: [],
      unableToAssessReasons:
        unableToAssessReasons.length > 0
          ? unableToAssessReasons
          : ["No detector findings were produced for this scan."],
      scannerVersion,
      scoringVersion,
      explanation:
        "No detector findings were available to score. This reflects missing or inconclusive evidence, not confirmed safety."
    };
  }

  const findingContributions: FindingContribution[] = findings.map((finding) => ({
    code: finding.code,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    weight: findingWeight(finding)
  }));

  const categoryScores = uniqueCategories(findings).map((category) => {
    const categoryFindings = findings.filter((finding) => finding.category === category);
    const score = Math.min(
      100,
      categoryFindings.reduce((total, finding) => total + findingWeight(finding), 0)
    );
    const topFinding = [...categoryFindings].sort(
      (a, b) => findingWeight(b) - findingWeight(a)
    )[0];

    return {
      category,
      score,
      confidence: strongestConfidence(categoryFindings.map((finding) => finding.confidence)),
      ...(topFinding
        ? {
            explanation: `${categoryFindings.length} finding(s) in this category; highest-weighted is ${topFinding.code} (${topFinding.severity} severity, ${topFinding.confidence} confidence).`
          }
        : {})
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
    findingContributions,
    unableToAssessReasons,
    scannerVersion,
    scoringVersion,
    explanation:
      "Risk Score is derived only from persisted detector findings, weighted by severity and confidence within each category. The overall score is the highest category score, not a sum across categories, so one severe finding cannot be diluted by many minor ones nor can unrelated categories compound into an inflated total. Unable-to-assess reasons list evidence gaps that were not treated as low risk."
  };
}

function collectUnableToAssessReasons(detectorResults: DetectorResult[]): string[] {
  const reasons: string[] = [];
  for (const result of detectorResults) {
    for (const check of result.checks) {
      if (
        check.outcome === "UNSUPPORTED" ||
        check.outcome === "DATA_UNAVAILABLE" ||
        check.outcome === "INCONCLUSIVE" ||
        check.outcome === "FAILED"
      ) {
        reasons.push(
          `${result.detector.id}/${check.code}: ${check.outcome}${check.errorMessage ? ` — ${check.errorMessage}` : ""}`
        );
      }
    }
  }
  return reasons;
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
  const matches: Array<{ filename: string; pattern: string; snippet: string; benignNote?: string }> = [];
  for (const file of sourceFiles) {
    const source = stripInterfaceBlocks(stripSolidityComments(file.sourceCode));
    for (const { regex, classifyMatch } of rule.patterns) {
      const match = regex.exec(source);
      if (match?.index !== undefined) {
        const classification = classifyMatch?.(source, match.index, match[0]);
        matches.push({
          filename: file.filename,
          pattern: regex.source,
          snippet: sourceSnippet(source, match.index),
          ...(classification ? { benignNote: classification.note } : {})
        });
      }
    }
  }

  return matches.slice(0, 10);
}

function stripSolidityComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/**
 * Blanks out the body of every `interface X { ... }` declaration before rule matching. Solidity
 * forbids function bodies inside interfaces — an interface can only ever describe a call
 * signature for some OTHER contract this one calls, never a capability it implements itself.
 * Matching risk patterns against interface text attributes a different contract's ABI to the one
 * being scanned. Verified against a real false positive: PonsLauncherToken was flagged for
 * "mint or supply-control functions" solely because its own imported ILaunchpad.sol interface
 * declares Uniswap V3's position-manager signature
 * `function mint(MintParams calldata params) external payable returns (...)` — used only to call
 * the position manager, never implemented or callable on the token itself.
 */
function stripInterfaceBlocks(source: string): string {
  let result = "";
  let cursor = 0;
  const declPattern = /\binterface\s+\w+(?:\s+is\s+[\w,\s]+)?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = declPattern.exec(source))) {
    if (match.index < cursor) continue;

    const braceStart = match.index + match[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;

    result += source.slice(cursor, braceStart + 1);
    result += " ".repeat(end - braceStart - 1);
    result += "}";
    cursor = end + 1;
    declPattern.lastIndex = end + 1;
  }
  result += source.slice(cursor);
  return result;
}

/**
 * Scopes source-file scanning to the deployed contract's own file plus its real import
 * closure, using `contractName` (reported by the explorer) to find the file that declares
 * `contract|abstract contract|library|interface <contractName>`. Falls back to scanning every
 * returned file when the contract can't be identified this way — under-scoping (scanning
 * unrelated files) produces false positives, but over-scoping (missing a file that's genuinely
 * part of the contract) could hide a real one, so an unresolved case defers to the wider scan
 * rather than guessing.
 */
function relevantSourceFilesFor(
  sourceFiles: ContractSourceFile[],
  contractName: string | null
): ContractSourceFile[] {
  if (!contractName || sourceFiles.length <= 1) {
    return sourceFiles;
  }

  const declarationPattern = new RegExp(
    `\\b(?:contract|abstract\\s+contract|library|interface)\\s+${escapeRegExp(contractName)}\\b`
  );
  const entryFile = sourceFiles.find((file) =>
    declarationPattern.test(stripSolidityComments(file.sourceCode))
  );
  if (!entryFile) {
    return sourceFiles;
  }

  const byFilename = new Map(sourceFiles.map((file) => [file.filename, file]));
  const visited = new Set<string>();
  const queue = [entryFile.filename];
  const relevant: ContractSourceFile[] = [];

  while (queue.length > 0) {
    const filename = queue.shift();
    if (!filename || visited.has(filename)) continue;
    visited.add(filename);

    const file = byFilename.get(filename);
    if (!file) continue;
    relevant.push(file);

    for (const importPath of extractImportPaths(stripSolidityComments(file.sourceCode))) {
      const resolved = resolveImportPath(filename, importPath);
      if (byFilename.has(resolved)) {
        queue.push(resolved);
        continue;
      }
      // Fallback for import styles that don't resolve to an exact filename match (e.g. a
      // remapped path): match by trailing path segments instead of dropping the import.
      const bySuffix = sourceFiles.find((candidate) =>
        candidate.filename.endsWith(importPath.replace(/^(\.\.?\/)+/, ""))
      );
      if (bySuffix) {
        queue.push(bySuffix.filename);
      }
    }
  }

  return relevant;
}

function extractImportPaths(source: string): string[] {
  const paths: string[] = [];
  const importPattern = /import\s+(?:\{[^}]*\}\s+from\s+|[\w*\s]+from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

function resolveImportPath(fromFile: string, importPath: string): string {
  if (!importPath.startsWith(".")) {
    return importPath;
  }

  const resolved = fromFile.split("/").slice(0, -1);
  for (const segment of importPath.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
