import { describe, expect, it } from "vitest";
import type { ScanResultView, SecurityFindingView } from "@genesis-sentinel/shared";
import { mapProgressToJob, mapResultToReport } from "./adapt";

const ADDRESS = "0x32758ae8e02b0a2cb6b802b6aaeaf74158c169f7" as const;

function baseView(overrides: Partial<ScanResultView> = {}): ScanResultView {
  return {
    scan: {
      scanId: "4663:0xabc:key",
      chainId: 4663,
      address: ADDRESS,
      state: "COMPLETED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan state is COMPLETED.",
      scanBlockNumber: "6942713",
      completedAt: "2026-07-11T00:01:00.000Z"
    },
    token: {
      chainId: 4663,
      address: ADDRESS
    },
    detectorChecks: [],
    findings: [],
    liquidity: {
      status: "UNSUPPORTED",
      pools: [],
      message: "Liquidity discovery is not configured."
    },
    holders: {
      status: "UNSUPPORTED",
      snapshots: [],
      message: "Holder analysis is not configured."
    },
    simulations: [],
    risk: {
      chainId: 4663,
      address: ADDRESS,
      scannerVersion: "0.1.0-foundation",
      status: "AVAILABLE",
      level: "LOW",
      score: 12,
      confidence: "HIGH",
      categoryScores: [],
      findingContributions: [],
      unableToAssessReasons: [],
      findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      message: "No findings detected."
    },
    ...overrides
  };
}

describe("mapResultToReport", () => {
  it("keeps the backend's canonical Risk Score direction", () => {
    const report = mapResultToReport(baseView());
    // backend score 12 means low detected risk; higher score means greater risk.
    expect(report.riskScore).toBe(12);
  });

  it("keeps riskScore null when the backend can't assess risk yet", () => {
    const report = mapResultToReport(
      baseView({
        risk: {
          chainId: 4663,
          address: ADDRESS,
          scannerVersion: "0.1.0-foundation",
          status: "UNABLE_TO_ASSESS",
          level: "UNABLE_TO_ASSESS",
          score: null,
          confidence: "LOW",
          categoryScores: [],
          findingContributions: [],
          unableToAssessReasons: ["No detector findings were produced for this scan."],
          findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          message: "Not enough evidence yet."
        }
      })
    );
    expect(report.riskScore).toBeNull();
  });

  it("derives contract controls from selector-pattern findings once contract analysis has run", () => {
    const mintFinding: SecurityFindingView = {
      id: "f1",
      code: "MINT_CAPABILITY_SURFACE",
      detectorId: "mint-selector-patterns",
      detectorVersion: "1.0.0",
      title: "Mint capability surface detected",
      severity: "MEDIUM",
      category: "CONTRACT_CONTROL",
      confidence: "MEDIUM",
      description: "The bytecode contains selectors commonly associated with token minting.",
      technicalExplanation: "Selector presence only, not proof of exploitability.",
      evidence: []
    };
    const report = mapResultToReport(baseView({ findings: [mintFinding] }));
    expect(report.controls.canMint).toBe(true);
    expect(report.controls.canPause).toBe(false);
  });

  it("leaves contract controls unknown before contract analysis has run", () => {
    const report = mapResultToReport(
      baseView({
        scan: {
          scanId: "4663:0xabc:key",
          chainId: 4663,
          address: ADDRESS,
          state: "QUEUED",
          scannerVersion: "0.1.0-foundation",
          submittedAt: "2026-07-11T00:00:00.000Z",
          message: "Scan is queued for worker orchestration."
        }
      })
    );
    expect(report.controls.canMint).toBeNull();
    expect(report.controls.isProxy).toBeNull();
  });

  it("surfaces unsupported liquidity/holders as incomplete notes, not fake data", () => {
    const report = mapResultToReport(baseView());
    expect(report.holders.top1Pct).toBeNull();
    expect(report.liquidity.totalUsd).toBeNull();
    expect(report.incomplete).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Liquidity"),
        expect.stringContaining("Holder analysis")
      ])
    );
  });

  it("maps a real discovered pool into liquidity info instead of the unsupported stub", () => {
    const report = mapResultToReport(
      baseView({
        liquidity: {
          status: "AVAILABLE",
          message: "Persisted liquidity pools are available for this token.",
          pools: [
            {
              chainId: 4663,
              tokenAddress: ADDRESS,
              poolAddress: "0x1234567890123456789012345678901234567890",
              dex: "Uniswap V2",
              liquidityData: {
                lpBurnedOrLockedPct: 99.5,
                totalLiquidityUsd: 90_300
              }
            }
          ]
        }
      })
    );
    expect(report.liquidity.totalUsd).toBe(90_300);
    expect(report.liquidity.locked).toBe(true);
    expect(report.liquidity.burnedPct).toBe(99.5);
  });

  it("does not claim liquidity is locked when burned/locked pct is low", () => {
    const report = mapResultToReport(
      baseView({
        liquidity: {
          status: "AVAILABLE",
          message: "Persisted liquidity pools are available for this token.",
          pools: [
            {
              chainId: 4663,
              tokenAddress: ADDRESS,
              poolAddress: "0x1234567890123456789012345678901234567890",
              liquidityData: { lpBurnedOrLockedPct: 5, totalLiquidityUsd: 10_000 }
            }
          ]
        }
      })
    );
    expect(report.liquidity.locked).toBe(false);
  });

  it("maps real holder concentration snapshots instead of the unsupported stub", () => {
    const report = mapResultToReport(
      baseView({
        holders: {
          status: "AVAILABLE",
          message: "Persisted holder snapshots are available for this token.",
          snapshots: [
            {
              chainId: 4663,
              tokenAddress: ADDRESS,
              blockNumber: "6942713",
              topHolders: {},
              concentration: { top1Pct: 18.4, top5Pct: 41.7, top10Pct: 63.2 },
              createdAt: "2026-07-11T00:00:00.000Z"
            }
          ]
        }
      })
    );
    expect(report.holders.top1Pct).toBe(18.4);
    expect(report.holders.top10Pct).toBe(63.2);
  });

  it("flags ownership as not-renounced from the backend's on-chain owner() read", () => {
    const report = mapResultToReport(
      baseView({ token: { chainId: 4663, address: ADDRESS, ownershipStatus: "ACTIVE" } })
    );
    expect(report.controls.ownershipRenounced).toBe(false);
    expect(report.token.ownershipStatus).toBe("active");
  });

  it("positively confirms ownership renounced — something a finding-absence heuristic could never assert", () => {
    const report = mapResultToReport(
      baseView({ token: { chainId: 4663, address: ADDRESS, ownershipStatus: "RENOUNCED" } })
    );
    expect(report.controls.ownershipRenounced).toBe(true);
    expect(report.token.ownershipStatus).toBe("renounced");
  });

  it("leaves ownership unknown when the backend hasn't resolved owner() yet", () => {
    const report = mapResultToReport(baseView());
    expect(report.controls.ownershipRenounced).toBeNull();
    expect(report.token.ownershipStatus).toBeUndefined();
  });

  it("derives the new trading-safety controls from their selector detectors", () => {
    const tradingControlFinding: SecurityFindingView = {
      id: "f3",
      code: "TRADING_CONTROL_SURFACE",
      detectorId: "trading-control-selector-patterns",
      detectorVersion: "0.1.0",
      title: "Trading enable/disable control surface detected",
      severity: "HIGH",
      category: "TRADING_SAFETY",
      confidence: "MEDIUM",
      description: "d",
      technicalExplanation: "t",
      evidence: []
    };
    const report = mapResultToReport(baseView({ findings: [tradingControlFinding] }));
    expect(report.controls.canDisableTrading).toBe(true);
    expect(report.controls.canLimitTransactions).toBe(false);
    expect(report.controls.hasFeeWhitelist).toBe(false);
  });

  it("derives honeypot status and tax bps from simulation results instead of always reporting null", () => {
    const report = mapResultToReport(
      baseView({
        simulations: [
          {
            id: "sim-buy",
            kind: "BUY",
            outcome: "PASSED",
            input: {},
            result: { isHoneypot: false, buyTaxBps: 300 },
            simulationTool: "0.1.0-ganache-fork",
            createdAt: "2026-07-11T00:00:00.000Z"
          },
          {
            id: "sim-sell",
            kind: "SELL",
            outcome: "FAILED",
            input: {},
            result: { isHoneypot: true, sellTaxBps: 10_000 },
            simulationTool: "0.1.0-ganache-fork",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      })
    );

    expect(report.simulation.isHoneypot).toBe(true);
    expect(report.simulation.buyTaxBps).toBe(300);
    expect(report.simulation.sellTaxBps).toBe(10_000);
  });

  it("keeps honeypot status null when neither leg produced a real verdict", () => {
    const report = mapResultToReport(
      baseView({
        simulations: [
          {
            id: "sim-buy",
            kind: "BUY",
            outcome: "UNSUPPORTED",
            input: {},
            result: { isRouteAvailable: false },
            simulationTool: "0.1.0-unsupported",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      })
    );

    expect(report.simulation.isHoneypot).toBeNull();
  });

  it("extracts wallet-clustering edges from the WALLET_CLUSTERING_EDGES_FOUND check", () => {
    const report = mapResultToReport(
      baseView({
        detectorChecks: [
          {
            id: "check-1",
            detectorResultId: "result-1",
            detectorId: "deployer-history",
            detectorVersion: "0.1.0",
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
                      address: "0x00000000000000000000000000000000000d31",
                      confidence: "HIGH",
                      evidence: "Deployer transferred 20% of supply to this address.",
                      source: "erc20-transfer-log-scan"
                    },
                    { type: "NOT_A_REAL_TYPE", address: "0x1", confidence: "HIGH", evidence: "x", source: "y" }
                  ]
                }
              }
            ]
          }
        ]
      })
    );

    expect(report.walletCluster).toEqual([
      {
        type: "TRANSFERRED_SUPPLY_TO",
        address: "0x00000000000000000000000000000000000d31",
        confidence: "high",
        evidence: "Deployer transferred 20% of supply to this address.",
        source: "erc20-transfer-log-scan"
      }
    ]);
  });

  it("returns an empty wallet cluster when no clustering check is present", () => {
    const report = mapResultToReport(baseView());
    expect(report.walletCluster).toEqual([]);
  });
});

describe("mapProgressToJob", () => {
  it("marks the current backend state as the running stage", () => {
    const job = mapProgressToJob({
      scanId: "s1",
      chainId: 4663,
      address: ADDRESS,
      state: "ANALYZING_CONTRACT",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan state is ANALYZING_CONTRACT."
    });
    const running = job.stages.filter((s) => s.status === "running");
    expect(running).toHaveLength(1);
    expect(running[0]?.key).toBe("analyzing_contract");
    expect(job.stages.find((s) => s.key === "fetching_contract")?.status).toBe("passed");
    expect(job.stages.find((s) => s.key === "scoring")?.status).toBe("pending");
  });
});
