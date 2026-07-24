import { describe, expect, it } from "vitest";
import {
  effectiveFindingsAfterOwnershipRenouncement,
  assertRiskScore,
  buildDexScreenerUrl,
  buildMarketChartUrl,
  buildTokenSecuritySummary,
  chainMarketSlug,
  createHealth,
  createScanId,
  formatCompactUsd,
  formatHumanDateTime,
  formatSupplyPercentage,
  liquidityHealthTier,
  normalizeEvmAddress,
  scannerVersion,
  selectPrimaryLiquidityPool,
  type LiquidityPoolView,
  type ScanResultView
} from "./index.js";

describe("shared foundation contracts", () => {
  it("neutralizes owner-only findings after renouncement but preserves alternate authority", () => {
    const ownerOnly = { code: "BLACKLIST_CAPABILITY_SURFACE" };
    expect(effectiveFindingsAfterOwnershipRenouncement([ownerOnly], true)).toEqual([]);
    expect(
      effectiveFindingsAfterOwnershipRenouncement(
        [ownerOnly, { code: "SOURCE_PRIVILEGED_ROLE_CONTROL" }],
        true
      )
    ).toHaveLength(2);
  });

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

describe("formatCompactUsd", () => {
  it("abbreviates millions and thousands instead of printing every digit", () => {
    expect(formatCompactUsd(25_000_000)).toBe("$25m");
    expect(formatCompactUsd(50_500)).toBe("$50.5k");
  });

  it("abbreviates billions", () => {
    expect(formatCompactUsd(1_250_000_000)).toBe("$1.25b");
  });

  it("uses ordinary currency formatting under $1,000", () => {
    expect(formatCompactUsd(123.45)).toBe("$123.45");
  });

  it("keeps extra precision for sub-dollar values instead of rounding them to $0", () => {
    expect(formatCompactUsd(0.0000005)).toBe("$0.0000005");
  });

  it("handles zero and negative values", () => {
    expect(formatCompactUsd(0)).toBe("$0");
    expect(formatCompactUsd(-25_000_000)).toBe("-$25m");
  });

  it("parses numeric strings and returns null for unusable input", () => {
    expect(formatCompactUsd("25000000")).toBe("$25m");
    expect(formatCompactUsd(null)).toBeNull();
    expect(formatCompactUsd(undefined)).toBeNull();
    expect(formatCompactUsd("not-a-number")).toBeNull();
  });
});

describe("formatHumanDateTime", () => {
  it("formats an ISO timestamp as a human-readable absolute date and time", () => {
    expect(formatHumanDateTime("2026-07-23T01:28:00.000Z")).toBe("Jul 23, 2026, 1:28 AM UTC");
  });

  it("returns null for missing or invalid input instead of a raw string", () => {
    expect(formatHumanDateTime(null)).toBeNull();
    expect(formatHumanDateTime(undefined)).toBeNull();
    expect(formatHumanDateTime("not-a-date")).toBeNull();
  });
});

describe("buildDexScreenerUrl", () => {
  it("builds a Robinhood Chain DexScreener pair URL", () => {
    expect(buildDexScreenerUrl("robinhood", "0x10cc6bd38112cac182db90b6a71d8bb5939526ba")).toBe(
      "https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
  });

  it("builds an Arc Chain DexScreener pair URL", () => {
    expect(buildDexScreenerUrl("arc", "0x10cc6bd38112cac182db90b6a71d8bb5939526ba")).toBe(
      "https://dexscreener.com/arc/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
  });
});

describe("chainMarketSlug", () => {
  it("maps every chain the API implements to the slug DexScreener/GeckoTerminal/the web app share", () => {
    expect(chainMarketSlug(4663)).toBe("robinhood");
    expect(chainMarketSlug(5042)).toBe("arc");
    expect(chainMarketSlug(988)).toBe("stable");
  });

  it("falls back to the numeric chain id for an unrecognized chain", () => {
    expect(chainMarketSlug(1)).toBe("1");
  });
});

describe("formatSupplyPercentage", () => {
  it("does not present a tiny non-zero holding as zero", () => {
    expect(formatSupplyPercentage(0.000629)).toBe("<0.01%");
    expect(formatSupplyPercentage(0)).toBe("0%");
    expect(formatSupplyPercentage(6.3)).toBe("6.30%");
  });
});

describe("buildMarketChartUrl", () => {
  it("builds a Robinhood Chain GeckoTerminal pool URL", () => {
    expect(buildMarketChartUrl("robinhood", "0x10cc6bd38112cac182db90b6a71d8bb5939526ba")).toBe(
      "https://www.geckoterminal.com/robinhood/pools/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
  });

  it("builds a Stable Chain GeckoTerminal pool URL", () => {
    expect(buildMarketChartUrl("stable", "0x10cc6bd38112cac182db90b6a71d8bb5939526ba")).toBe(
      "https://www.geckoterminal.com/stable/pools/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
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
      findings: [
        {
          id: "finding-proxy",
          code: "EIP1167_MINIMAL_PROXY_DETECTED",
          detectorId: "dangerous-opcode-surface",
          detectorVersion: "1.0.0",
          title: "Standard EIP-1167 minimal proxy detected",
          severity: "INFO",
          category: "CONTRACT_CONTROL",
          confidence: "HIGH",
          description: "Canonical clone runtime.",
          technicalExplanation: "The implementation address is fixed in bytecode.",
          evidence: []
        }
      ],
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
          result: { isHoneypot: false, sellTaxBps: 1_250 },
          simulationTool: "test",
          createdAt: "2026-07-20T00:01:00.000Z"
        },
        {
          id: "simulation-2",
          kind: "BUY",
          outcome: "PASSED",
          input: {},
          result: { buyTaxBps: 300 },
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
    expect(summary.taxes).toMatchObject({
      status: "AVAILABLE",
      buyTaxBps: 300,
      buyTaxPct: 3,
      sellTaxBps: 1250,
      sellTaxPct: 12.5
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
    expect(summary.signals.find((signal) => signal.id === "proxy_contract")).toMatchObject({
      answer: "YES",
      severity: "INFO"
    });
    expect(summary.signals.find((signal) => signal.id === "buy_tax")).toMatchObject({
      label: "Buy tax",
      answer: "YES",
      value: "3%"
    });
    expect(summary.signals.find((signal) => signal.id === "sell_tax")).toMatchObject({
      label: "Sell tax",
      answer: "YES",
      severity: "WARN",
      value: "12.5%"
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
