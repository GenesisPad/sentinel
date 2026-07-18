import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import {
  contractCodeExistenceDetector,
  createUnsupportedHolderAnalysis,
  createUnsupportedLiquidityDiscovery,
  createUnsupportedTradeSimulations,
  createEmptyDetectorResult,
  ownershipStatusDetector,
  runFoundationDetectors,
  scoreFindings,
  selectorPatternDetectors,
  sourceCodeRiskDetector,
  type DetectorMetadata
} from "./index.js";

const noOwner = () => Promise.resolve(null);

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
        getOwnerAddress: noOwner
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
        getOwnerAddress: noOwner
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
