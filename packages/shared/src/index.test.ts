import { describe, expect, it } from "vitest";
import {
  assertRiskScore,
  buildTokenSecuritySummary,
  createHealth,
  createScanId,
  liquidityHealthTier,
  normalizeEvmAddress,
  scannerVersion,
  selectPrimaryLiquidityPool,
  type LiquidityPoolView,
  type ScanResultView
} from "./index.js";

describe("shared foundation contracts", () => {
  it("creates stable service health metadata", () => {
    const health = createHealth("api");

    expect(health.status).toBe("ok");
    expect(health.service).toBe("api");
    expect(health.version).toBe(scannerVersion);
  });

  it("normalizes addresses in foundation scan ids", () => {
    expect(createScanId(4663, "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", "request-1")).toContain(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    );
  });

  it("normalizes EVM addresses for persistence keys", () => {
    expect(normalizeEvmAddress("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    );
  });

  it("rejects out-of-range risk scores", () => {
    expect(() => assertRiskScore(101)).toThrow("Risk score");
  });
});

describe("liquidityHealthTier", () => {
  it("flags negligible absolute liquidity as low even with no market cap to compute a ratio", () => {
    // Reproduces $UHOOD's real drained pool: $0.175 total liquidity, no market cap data.
    expect(liquidityHealthTier(0.175, null, null)).toBe("low");
  });

  it("returns null when liquidity isn't negligible but no market cap exists to rank it", () => {
    expect(liquidityHealthTier(10_000, null, null)).toBeNull();
  });

  it("applies stricter thresholds to an ultra-low-cap token than a $5M+ token", () => {
    expect(liquidityHealthTier(12_000, 15, 80_000)).toBe("medium");
    expect(liquidityHealthTier(750_000, 15, 10_000_000)).toBe("healthy");
  });
});

describe("selectPrimaryLiquidityPool", () => {
  it("picks the pool with the highest real liquidity, not the first in the list", () => {
    // Reproduces $CASHCAT's real pools: pool 0 was near-empty, the real pool held $2.7M.
    const pools: LiquidityPoolView[] = [
      {
        chainId: 4663,
        tokenAddress: "0x1111111111111111111111111111111111111111",
        poolAddress: "0x1111111111111111111111111111111111111111",
        liquidityData: { totalLiquidityUsd: 0.0000000000000037 }
      },
      {
        chainId: 4663,
        tokenAddress: "0x1111111111111111111111111111111111111111",
        poolAddress: "0x2222222222222222222222222222222222222222",
        liquidityData: { totalLiquidityUsd: 2_712_302.89 }
      }
    ];

    expect(selectPrimaryLiquidityPool(pools)?.poolAddress).toBe(
      "0x2222222222222222222222222222222222222222"
    );
  });

  it("returns undefined for an empty pool list", () => {
    expect(selectPrimaryLiquidityPool([])).toBeUndefined();
  });
});

describe("buildTokenSecuritySummary", () => {
  it("returns partner-friendly Yes/No/Unknown signals without borrowing another product name", () => {
    const scanResult: ScanResultView = {
      scan: {
        scanId: "scan-1",
        chainId: 4663,
        address: "0x1111111111111111111111111111111111111111",
        state: "COMPLETED",
        scannerVersion,
        submittedAt: "2026-07-20T00:00:00.000Z",
        completedAt: "2026-07-20T00:01:00.000Z",
        message: "Complete."
      },
      token: {
        chainId: 4663,
        address: "0x1111111111111111111111111111111111111111",
        ownershipStatus: "ACTIVE",
        deployerAddress: "0x2222222222222222222222222222222222222222"
      },
      detectorChecks: [
        {
          id: "check-1",
          detectorResultId: "detector-result-1",
          detectorId: "blacklist-selector-patterns",
          detectorVersion: "1.0.0",
          code: "BLACKLIST_SELECTORS_PRESENT",
          outcome: "DETECTED",
          confidence: "HIGH",
          evidence: []
        },
        {
          id: "check-2",
          detectorResultId: "detector-result-2",
          detectorId: "mint-selector-patterns",
          detectorVersion: "1.0.0",
          code: "MINT_SELECTORS_PRESENT",
          outcome: "PASSED",
          confidence: "MEDIUM",
          evidence: []
        },
        {
          id: "check-3",
          detectorResultId: "detector-result-3",
          detectorId: "source-code-risk-patterns",
          detectorVersion: "1.0.0",
          code: "SOURCE_OBFUSCATED_ADDRESS_DETECTED",
          outcome: "DETECTED",
          confidence: "MEDIUM",
          evidence: []
        },
        {
          id: "check-4",
          detectorResultId: "detector-result-4",
          detectorId: "deployer-history",
          detectorVersion: "1.0.0",
          code: "WALLET_CLUSTERING_EDGES_FOUND",
          outcome: "DETECTED",
          confidence: "HIGH",
          evidence: [
            {
              type: "EXTERNAL_SOURCE",
              summary: "Related-wallet edges derived from on-chain evidence",
              data: {
                edges: [
                  {
                    type: "TRANSFERRED_SUPPLY_TO",
                    address: "0x3333333333333333333333333333333333333333",
                    confidence: "HIGH",
                    evidence: "Deployer transferred 4.5% of total supply to this address.",
                    source: "erc20-transfer-log-scan"
                  }
                ]
              }
            }
          ]
        }
      ],
      findings: [],
      liquidity: {
        status: "UNSUPPORTED",
        pools: [],
        message: "Liquidity discovery was not run."
      },
      holders: {
        status: "AVAILABLE",
        snapshots: [
          {
            chainId: 4663,
            tokenAddress: "0x1111111111111111111111111111111111111111",
            blockNumber: "1",
            holderCount: 10,
            topHolders: {
              holders: [
                { address: "0x2222222222222222222222222222222222222222", totalSupplyPct: 1.25 },
                { address: "0x3333333333333333333333333333333333333333", totalSupplyPct: 4.5 }
              ]
            },
            concentration: {},
            createdAt: "2026-07-20T00:01:00.000Z"
          }
        ],
        message: "Holder analysis is available."
      },
      simulations: [
        {
          id: "simulation-1",
          kind: "SELL",
          outcome: "PASSED",
          input: {},
          result: { isHoneypot: false },
          simulationTool: "test",
          createdAt: "2026-07-20T00:01:00.000Z"
        }
      ],
      risk: {
        chainId: 4663,
        address: "0x1111111111111111111111111111111111111111",
        scannerVersion,
        status: "AVAILABLE",
        level: "MODERATE",
        score: 33,
        confidence: "MEDIUM",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: {
          INFO: 0,
          LOW: 0,
          MEDIUM: 0,
          HIGH: 0,
          CRITICAL: 0
        },
        message: "Persisted risk assessment is available for this scan."
      }
    };

    const summary = buildTokenSecuritySummary(scanResult, {
      webAppUrl: "https://sentinel.genesispad.app/"
    });

    expect(summary.product).toBe("Genesis Sentinel");
    expect(summary.fullAnalysisUrl).toBe(
      "https://sentinel.genesispad.app/token/4663/0x1111111111111111111111111111111111111111"
    );
    expect(summary.devCluster).toMatchObject({
      walletCount: 2,
      knownHoldingPct: 5.75,
      unknownHoldingWalletCount: 0
    });
    expect(JSON.stringify(summary)).not.toContain(["Quick", "Intel"].join(" "));
    expect(summary.signals.find((signal) => signal.id === "can_block_wallets")).toMatchObject({
      label: "Can block wallets",
      answer: "YES"
    });
    expect(summary.signals.find((signal) => signal.id === "honeypot")).toMatchObject({
      label: "Honeypot",
      answer: "NO"
    });
    expect(summary.signals.find((signal) => signal.id === "can_create_more_tokens")).toMatchObject({
      label: "Can create more tokens",
      answer: "NO"
    });
    expect(summary.signals.find((signal) => signal.id === "obfuscated_address")).toMatchObject({
      answer: "YES",
      source: "DETECTOR"
    });
    expect(summary.signals.find((signal) => signal.id === "dev_cluster")).toMatchObject({
      label: "Dev cluster",
      answer: "YES",
      value: "5.75% across 2 linked wallet(s)"
    });
  });
});
