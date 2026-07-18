import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import {
  contractCodeExistenceDetector,
  createUnsupportedHolderAnalysis,
  createUnsupportedLiquidityDiscovery,
  createUnsupportedTradeSimulations,
  createEmptyDetectorResult,
  dangerousOpcodeDetector,
  deployerHistoryDetector,
  eip1967ProxyDetector,
  genesispadLaunchDetector,
  liveTradingStateDetector,
  ownershipRolesAbiDetector,
  ownershipStatusDetector,
  runFoundationDetectors,
  scoreFindings,
  selectorPatternDetectors,
  sourceCodeRiskDetector,
  type DetectorMetadata
} from "./index.js";

const noOwner = () => Promise.resolve(null);
const zeroSlot = `0x${"0".repeat(64)}` as const;
const noStorage = () => Promise.resolve(zeroSlot);

const context = {
  scanId: "scan-1",
  chainId: 4663,
  address: "0x0000000000000000000000000000000000000001" as const,
  scannerVersion: "0.1.0-foundation",
  blockNumber: 123n
};

describe("detector contracts", () => {
  it("creates empty detector results without implying a passed check", () => {
    const detector: DetectorMetadata = {
      id: "contract-code-existence",
      version: "0.1.0",
      name: "Contract code existence",
      description: "Checks whether bytecode exists at the target address."
    };

    const result = createEmptyDetectorResult(detector);

    expect(result.findings).toEqual([]);
    expect(result.checks).toEqual([]);
    expect(result.detector.id).toBe("contract-code-existence");
  });
});

describe("foundation detectors", () => {
  it("detects absent bytecode with bytecode evidence", async () => {
    const result = await contractCodeExistenceDetector.run({ bytecode: "0x" }, context);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "CONTRACT_CODE_ABSENT",
      severity: "HIGH"
    });
    expect(result.findings[0]?.evidence[0]).toMatchObject({
      type: "BYTECODE",
      blockNumber: 123n
    });
  });

  it("passes code existence when bytecode is present", async () => {
    const result = await contractCodeExistenceDetector.run({ bytecode: "0x6000" }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ outcome: "PASSED" });
  });

  it("detects mint selector surface without claiming exploitability", async () => {
    const mintDetector = selectorPatternDetectors.find(
      (detector) => detector.metadata.id === "mint-selector-patterns"
    );

    const result = await mintDetector!.run({ bytecode: "0x6340c10f196000" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "MINT_CAPABILITY_SURFACE",
      confidence: "MEDIUM"
    });
    expect(result.findings[0]?.technicalExplanation).toContain("Selector presence");
  });

  it("retrieves metadata and runs all foundation detectors", async () => {
    const results = await runFoundationDetectors(
      {
        bytecode: "0x6000",
        async getTokenMetadata() {
          await Promise.resolve();
          return {
            name: "Token",
            symbol: "TOK",
            decimals: 18
          };
        },
        getOwnerAddress: noOwner,
        getStorageAt: noStorage
      },
      context
    );

    expect(results.map((result) => result.detector.id)).toContain("erc20-metadata");
    expect(results.map((result) => result.detector.id)).toContain("ownership-status");
    expect(results.flatMap((result) => result.findings)).toEqual([]);
  });

  it("flags incomplete ERC-20 metadata as a low-severity review signal", async () => {
    const results = await runFoundationDetectors(
      {
        bytecode: "0x6000",
        async getTokenMetadata() {
          await Promise.resolve();
          return {
            name: null,
            symbol: "TOK",
            decimals: null
          };
        },
        getOwnerAddress: noOwner,
        getStorageAt: noStorage
      },
      context
    );

    const finding = results
      .flatMap((result) => result.findings)
      .find((item) => item.code === "ERC20_METADATA_INCOMPLETE");
    expect(finding).toMatchObject({
      severity: "LOW",
      category: "REPUTATION_RISK"
    });
  });
});

describe("ownership status detector", () => {
  it("treats a burn-address owner as renounced, not just absence of a selector", async () => {
    const result = await ownershipStatusDetector.run(
      { getOwnerAddress: () => Promise.resolve("0x000000000000000000000000000000000000dead") },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "OWNERSHIP_RENOUNCED", outcome: "PASSED" });
  });

  it("flags an active owner address as not renounced", async () => {
    const result = await ownershipStatusDetector.run(
      { getOwnerAddress: () => Promise.resolve("0x1111111111111111111111111111111111111a") },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "OWNERSHIP_NOT_RENOUNCED",
      severity: "MEDIUM",
      category: "CONTRACT_CONTROL"
    });
  });

  it("reports data-unavailable rather than guessing when owner() can't be read", async () => {
    const result = await ownershipStatusDetector.run({ getOwnerAddress: noOwner }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "OWNER_READ_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });
});

describe("eip1967 proxy storage detector", () => {
  it("reports absence when every EIP-1967 slot is zero, not just no selector match", async () => {
    const result = await eip1967ProxyDetector.run({ getStorageAt: noStorage }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "EIP1967_PROXY_ABSENT", outcome: "PASSED" });
  });

  it("detects a proxy from the real implementation storage slot value", async () => {
    const implementationSlotValue =
      `0x${"0".repeat(24)}1111111111111111111111111111111111111111` as const;
    const result = await eip1967ProxyDetector.run(
      {
        getStorageAt: (slot) =>
          Promise.resolve(
            slot === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb"
              ? implementationSlotValue
              : zeroSlot
          )
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "EIP1967_PROXY_DETECTED",
      severity: "HIGH",
      category: "CONTRACT_CONTROL"
    });
    expect(result.findings[0]?.description).toContain("1111111111111111111111111111111111111111");
  });

  it("detects a beacon proxy when only the beacon slot is set", async () => {
    const beaconSlotValue =
      `0x${"0".repeat(24)}2222222222222222222222222222222222222222` as const;
    const result = await eip1967ProxyDetector.run(
      {
        getStorageAt: (slot) =>
          Promise.resolve(
            slot === "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"
              ? beaconSlotValue
              : zeroSlot
          )
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "EIP1967_BEACON_PROXY_DETECTED" });
  });
});

describe("dangerous opcode detector", () => {
  it("passes when neither DELEGATECALL nor SELFDESTRUCT appear as real instructions", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x600035" }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "DANGEROUS_OPCODES_ABSENT", outcome: "PASSED" });
  });

  it("does not flag a byte that only appears as PUSH immediate data", async () => {
    // PUSH2 0xf400 pushes the bytes f4 00 as data, not as instructions.
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x61f40000" }, context);

    expect(result.findings).toEqual([]);
  });

  it("detects a real DELEGATECALL instruction", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x6000f4" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "DELEGATECALL_OPCODE_PRESENT",
      severity: "MEDIUM"
    });
  });

  it("detects a real SELFDESTRUCT instruction", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x6000ff" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "SELFDESTRUCT_OPCODE_PRESENT",
      severity: "HIGH"
    });
  });
});

describe("new selector-pattern detectors", () => {
  it("detects max-transaction/max-wallet selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "max-transaction-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("setMaxTxAmount(uint256)").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "MAX_TRANSACTION_CAPABILITY_SURFACE",
      category: "TRADING_SAFETY"
    });
  });

  it("detects trading-control selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "trading-control-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("enableTrading()").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CONTROL_SURFACE", severity: "HIGH" });
  });

  it("detects fee-exclusion (whitelist) selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "fee-exclusion-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("excludeFromFees(address,bool)").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "FEE_EXCLUSION_CAPABILITY_SURFACE" });
  });
});

describe("source-code risk detector", () => {
  it("reports data unavailable when verified source is missing", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "UNAVAILABLE",
        address: context.address,
        sourceFiles: []
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "SOURCE_CODE_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });

  it("detects blacklist, trading gates, tax controls, and minting in verified source", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "RiskyToken",
        compilerVersion: "v0.8.26",
        language: "solidity",
        sourceFiles: [
          {
            filename: "RiskyToken.sol",
            sourceCode: `
              contract RiskyToken {
                mapping(address => bool) public isBlacklisted;
                bool public tradingEnabled;
                uint256 public buyTax;
                function enableTrading() external onlyOwner { tradingEnabled = true; }
                function setBlacklist(address account, bool value) external onlyOwner { isBlacklisted[account] = value; }
                function setBuyFee(uint256 value) external onlyOwner { buyTax = value; }
                function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "SOURCE_BLACKLIST_CONTROL",
        "SOURCE_TRADING_TOGGLE",
        "SOURCE_TAX_OR_LIMIT_CONTROL",
        "SOURCE_MINT_OR_SUPPLY_CONTROL"
      ])
    );
    expect(result.findings[0]?.evidence[0]).toMatchObject({ type: "EXTERNAL_SOURCE" });
  });

  it("detects ownership recovery and forced-transfer surfaces in verified source", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "HiddenOwner.sol",
            sourceCode: `
              contract HiddenOwner {
                address private _owner;
                function reclaimOwnership() external { _owner = msg.sender; }
                function forceTransfer(address from, address to, uint256 amount) external onlyOwner {
                  _transfer(from, to, amount);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["SOURCE_OWNERSHIP_RECOVERY_SURFACE", "SOURCE_ADMIN_TRANSFER_SURFACE"])
    );
    expect(
      result.findings.find((finding) => finding.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({
      severity: "CRITICAL"
    });
  });

  it("detects router/pair replacement and arbitrary low-level external calls", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Sketchy.sol",
            sourceCode: `
              contract Sketchy {
                function setRouter(address newRouter) external onlyOwner { router = newRouter; }
                function sweep(address target, bytes calldata data) external onlyOwner {
                  (bool ok, ) = target.call(data);
                  require(ok);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["SOURCE_ROUTER_OR_PAIR_REPLACEMENT", "SOURCE_ARBITRARY_EXTERNAL_CALL"])
    );
  });
});

describe("ownership/roles ABI detector", () => {
  it("reports data unavailable without a verified ABI", async () => {
    const result = await ownershipRolesAbiDetector.run(
      { status: "UNAVAILABLE", address: context.address, sourceFiles: [] },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "ABI_UNAVAILABLE", outcome: "DATA_UNAVAILABLE" });
  });

  it("detects two-step ownership from real ABI function names", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [
          { type: "function", name: "pendingOwner" },
          { type: "function", name: "acceptOwnership" }
        ]
      },
      context
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "TWO_STEP_OWNERSHIP_PATTERN",
      severity: "INFO"
    });
  });

  it("detects AccessControl roles from real ABI function names", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [
          { type: "function", name: "hasRole" },
          { type: "function", name: "grantRole" }
        ]
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "ACCESS_CONTROL_ROLE_SURFACE",
      severity: "MEDIUM",
      confidence: "HIGH"
    });
  });

  it("passes when neither pattern is present in the ABI", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [{ type: "function", name: "transfer" }]
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "OWNERSHIP_ROLE_ABI_ABSENT", outcome: "PASSED" });
  });
});

describe("live trading state detector", () => {
  it("reports unavailable when neither state function can be read", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(null),
        readTradingOpenState: () => Promise.resolve(null)
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "LIVE_TRADING_STATE_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });

  it("flags a currently-paused contract from a live read, not just selector presence", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(true),
        readTradingOpenState: () => Promise.resolve(null)
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CURRENTLY_PAUSED", severity: "HIGH" });
  });

  it("flags trading currently disabled from a live read", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(false),
        readTradingOpenState: () => Promise.resolve(false)
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CURRENTLY_DISABLED", severity: "HIGH" });
  });

  it("passes when both live reads succeed and show trading is open", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(false),
        readTradingOpenState: () => Promise.resolve(true)
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "LIVE_TRADING_STATE_OPEN", outcome: "PASSED" });
  });
});

describe("genesispad launch detector", () => {
  it("passes with no finding when the registry has no record for this token", async () => {
    const result = await genesispadLaunchDetector.run({ launch: null }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "GENESISPAD_LAUNCH_NOT_FOUND",
      outcome: "PASSED"
    });
  });

  it("reports a confirmed launch with permanently locked liquidity", async () => {
    const result = await genesispadLaunchDetector.run(
      {
        launch: {
          originalCreator: "0x0000000000000000000000000000000000000002",
          pool: "0x0000000000000000000000000000000000000003",
          positionManager: "0x0000000000000000000000000000000000000004",
          locker: "0x0000000000000000000000000000000000000005",
          positionTokenId: "42",
          permanentlyLocked: true,
          verified: true,
          launchTimestamp: new Date("2026-07-15T00:00:00.000Z")
        }
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "GENESISPAD_CONFIRMED_LAUNCH",
      severity: "INFO",
      category: "REPUTATION_RISK"
    });
    expect(result.findings[0]?.recommendation).toBeUndefined();
  });

  it("reports a confirmed launch without a permanent-lock recommendation when not locked", async () => {
    const result = await genesispadLaunchDetector.run(
      {
        launch: {
          originalCreator: "0x0000000000000000000000000000000000000002",
          pool: "0x0000000000000000000000000000000000000003",
          positionManager: "0x0000000000000000000000000000000000000004",
          locker: "0x0000000000000000000000000000000000000005",
          positionTokenId: "42",
          permanentlyLocked: false,
          verified: false,
          launchTimestamp: new Date("2026-07-15T00:00:00.000Z")
        }
      },
      context
    );

    expect(result.findings[0]?.recommendation).toBeTruthy();
  });
});

describe("deployer history detector", () => {
  it("reports data unavailable when no deployer address is known", async () => {
    const result = await deployerHistoryDetector.run(
      { deployerHistory: null, bytecodeReuse: null },
      context
    );

    expect(result.findings).toEqual([]);
    const deployerCheck = result.checks.find((check) => check.code === "DEPLOYER_HISTORY_UNAVAILABLE");
    expect(deployerCheck).toMatchObject({ outcome: "DATA_UNAVAILABLE" });
  });

  it("passes without a finding when the deployer has no prior tokens", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 0,
          previousHighOrCriticalCount: 0,
          entries: []
        },
        bytecodeReuse: null
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "DEPLOYER_HISTORY_ABSENT", outcome: "PASSED" });
  });

  it("escalates severity when prior tokens had high/critical findings", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 5,
          previousHighOrCriticalCount: 3,
          entries: []
        },
        bytecodeReuse: null
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "DEPLOYER_PRIOR_SCAN_HISTORY",
      severity: "HIGH",
      category: "REPUTATION_RISK"
    });
    expect(result.findings[0]?.description).toContain("5 other token(s)");
    expect(result.findings[0]?.description).toContain("3 of those scans");
  });

  it("reports INFO severity when prior tokens had no high/critical findings", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 2,
          previousHighOrCriticalCount: 0,
          entries: []
        },
        bytecodeReuse: null
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ severity: "INFO" });
  });

  it("flags reused bytecode across other scanned contracts", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: null,
        bytecodeReuse: {
          bytecodeHash: "abc123",
          reusedByCount: 2,
          reusedByAddresses: [
            "0x0000000000000000000000000000000000000003",
            "0x0000000000000000000000000000000000000004"
          ]
        }
      },
      context
    );

    expect(result.findings.some((finding) => finding.code === "BYTECODE_REUSED_ACROSS_SCANS")).toBe(
      true
    );
  });
});

describe("risk scoring", () => {
  it("returns no numeric assessment when no detector findings are present", () => {
    const assessment = scoreFindings([], "0.1.0-foundation");

    expect(assessment).toBeNull();
  });

  it("scores detected findings without claiming broad safety", async () => {
    const mintDetector = selectorPatternDetectors.find(
      (detector) => detector.metadata.id === "mint-selector-patterns"
    );
    const result = await mintDetector!.run({ bytecode: "0x6340c10f196000" }, context);
    const assessment = scoreFindings(result.findings, "0.1.0-foundation");

    expect(assessment).toMatchObject({
      score: 60,
      level: "HIGH",
      confidence: "MEDIUM",
      scoringVersion: "0.1.0-finding-weighted"
    });
    expect(assessment?.categoryScores[0]).toMatchObject({
      category: "CONTRACT_CONTROL",
      score: 60
    });
    expect(assessment?.explanation.toLowerCase()).not.toContain("safe");
  });
});

describe("simulation foundation", () => {
  it("creates explicit unsupported trade simulation results", () => {
    const simulations = createUnsupportedTradeSimulations({
      chainId: 4663,
      tokenAddress: context.address,
      blockNumber: 123n
    });

    expect(simulations.map((simulation) => simulation.kind)).toEqual(["BUY", "SELL", "TRANSFER"]);
    expect(simulations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "BUY",
          outcome: "UNSUPPORTED",
          blockNumber: 123n,
          simulationTool: "0.1.0-unsupported"
        })
      ])
    );
    expect(
      simulations
        .map((simulation) => simulation.result?.reason)
        .join(" ")
        .toLowerCase()
    ).not.toContain("safe");
  });
});

describe("liquidity discovery foundation", () => {
  it("creates an explicit unsupported liquidity discovery result", () => {
    const discovery = createUnsupportedLiquidityDiscovery();

    expect(discovery).toMatchObject({
      status: "UNSUPPORTED",
      discoveryTool: "0.1.0-unsupported",
      checkedDexes: [],
      pools: []
    });
    expect(discovery.reason.toLowerCase()).not.toContain("safe");
  });
});

describe("holder analysis foundation", () => {
  it("creates an explicit unsupported holder analysis result", () => {
    const analysis = createUnsupportedHolderAnalysis();

    expect(analysis).toMatchObject({
      status: "UNSUPPORTED",
      analysisTool: "0.1.0-unsupported",
      dataSources: [],
      snapshots: []
    });
    expect(analysis.reason.toLowerCase()).not.toContain("safe");
  });
});
