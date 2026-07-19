import { describe, expect, it } from "vitest";
import { checkPostgres, toScanProgress, toScanResultView } from "./index.js";

describe("database readiness", () => {
  it("exposes a postgres dependency check", () => {
    expect(typeof checkPostgres).toBe("function");
  });

  it("maps scans without adding risk output", () => {
    const scan = toScanProgress({
      id: "scan-1",
      chainId: 4663,
      tokenId: null,
      targetAddress: "0x0000000000000000000000000000000000000001",
      state: "QUEUED",
      scannerVersion: "0.1.0-foundation",
      idempotencyKeyHash: "hash",
      requestedBy: null,
      scanBlockNumber: null,
      scanBlockTimestamp: null,
      queuedAt: new Date("2026-07-11T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      failureSummary: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z")
    });

    expect(scan).toMatchObject({ scanId: "scan-1", state: "QUEUED" });
    expect(JSON.stringify(scan)).not.toContain("riskScore");
  });

  it("maps persisted findings and evidence for public scan results", () => {
    const scan = toScanResultView({
      id: "scan-1",
      chainId: 4663,
      tokenId: null,
      targetAddress: "0x0000000000000000000000000000000000000001",
      state: "PARTIALLY_COMPLETED",
      scannerVersion: "0.1.0-foundation",
      idempotencyKeyHash: "hash",
      requestedBy: null,
      scanBlockNumber: 123n,
      scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
      queuedAt: new Date("2026-07-11T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      failureSummary: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
      token: null,
      riskAssessment: null,
      simulationRuns: [],
      detectorResults: [],
      findings: [
        {
          id: "finding-1",
          scanId: "scan-1",
          detectorResultId: "detector-result-1",
          code: "MINT_CAPABILITY_SURFACE",
          detectorId: "mint-selector-patterns",
          detectorVersion: "0.1.0",
          title: "Mint capability surface detected",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description: "A mint selector was found.",
          technicalExplanation: "Selector presence is not proof of exploitability.",
          recommendation: null,
          createdAt: new Date("2026-07-11T00:00:00.000Z"),
          evidence: [
            {
              id: "evidence-1",
              findingId: "finding-1",
              type: "FUNCTION",
              summary: "mint(address,uint256)",
              data: { selector: "0x40c10f19" },
              blockNumber: 123n,
              transactionHash: null,
              address: "0x0000000000000000000000000000000000000001",
              createdAt: new Date("2026-07-11T00:00:00.000Z")
            }
          ]
        }
      ]
    });

    expect(scan.findings[0]?.evidence[0]).toMatchObject({
      blockNumber: "123",
      address: "0x0000000000000000000000000000000000000001"
    });
    expect(scan.risk).toMatchObject({
      status: "UNABLE_TO_ASSESS",
      score: null
    });
    expect(scan.liquidity).toMatchObject({
      status: "UNSUPPORTED",
      pools: []
    });
    expect(scan.holders).toMatchObject({
      status: "UNSUPPORTED",
      snapshots: []
    });
  });

  it("surfaces renounced ownership from persisted detector checks", () => {
    const scan = toScanResultView({
      id: "scan-owner",
      chainId: 4663,
      tokenId: null,
      targetAddress: "0x0000000000000000000000000000000000000001",
      state: "PARTIALLY_COMPLETED",
      scannerVersion: "0.1.0-foundation",
      idempotencyKeyHash: "hash",
      requestedBy: null,
      scanBlockNumber: 123n,
      scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
      queuedAt: new Date("2026-07-11T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      failureSummary: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
      token: null,
      riskAssessment: null,
      simulationRuns: [],
      findings: [],
      detectorResults: [
        {
          id: "detector-result-owner",
          scanId: "scan-owner",
          detectorId: "ownership-status",
          detectorVersion: "0.1.0",
          startedAt: new Date("2026-07-11T00:00:00.000Z"),
          completedAt: new Date("2026-07-11T00:00:00.000Z"),
          outcome: "PASSED",
          errorMessage: null,
          metadata: null,
          checks: [
            {
              id: "detector-check-owner",
              detectorResultId: "detector-result-owner",
              code: "OWNERSHIP_RENOUNCED",
              outcome: "PASSED",
              confidence: "HIGH",
              evidence: {
                evidence: [
                  {
                    type: "FUNCTION",
                    summary: "owner() read result",
                    address: "0x0000000000000000000000000000000000000001",
                    blockNumber: "123",
                    data: {
                      owner: "0x000000000000000000000000000000000000dead"
                    }
                  }
                ]
              },
              errorMessage: null,
              createdAt: new Date("2026-07-11T00:00:00.000Z")
            }
          ]
        }
      ]
    });

    expect(scan.token).toMatchObject({
      ownershipStatus: "RENOUNCED",
      ownerAddress: "0x000000000000000000000000000000000000dead"
    });
    expect(scan.detectorChecks[0]).toMatchObject({
      detectorId: "ownership-status",
      code: "OWNERSHIP_RENOUNCED",
      outcome: "PASSED"
    });
  });

  it("maps persisted token intelligence fields into public scan results", () => {
    const scan = toScanResultView({
      id: "scan-token-intel",
      chainId: 4663,
      tokenId: "token-1",
      targetAddress: "0x0000000000000000000000000000000000000001",
      state: "PARTIALLY_COMPLETED",
      scannerVersion: "0.1.0-foundation",
      idempotencyKeyHash: "hash",
      requestedBy: null,
      scanBlockNumber: 123n,
      scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
      queuedAt: new Date("2026-07-11T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      failureSummary: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
      token: {
        id: "token-1",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        name: "Token",
        symbol: "TOK",
        decimals: 18,
        totalSupply: "1000000000000000000",
        holderCount: 10,
        sourceVerified: true,
        deployerAddress: "0x0000000000000000000000000000000000000002",
        contractCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
        creationTxHash: "0x1234",
        tokenType: "ERC-20",
        iconUrl: "https://example.com/token.png",
        reputation: "ok",
        priceUsd: "1.25",
        marketCapUsd: "1250000",
        volume24hUsd: "50000",
        dexPaid: true,
        metadataBlock: 123n,
        metadataUpdatedAt: new Date("2026-07-11T00:00:00.000Z"),
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        updatedAt: new Date("2026-07-11T00:00:00.000Z")
      },
      riskAssessment: null,
      simulationRuns: [],
      findings: [],
      detectorResults: []
    });

    expect(scan.token).toMatchObject({
      name: "Token",
      symbol: "TOK",
      deployerAddress: "0x0000000000000000000000000000000000000002",
      contractCreatedAt: "2026-07-01T00:00:00.000Z",
      creationTxHash: "0x1234",
      tokenType: "ERC-20",
      iconUrl: "https://example.com/token.png",
      reputation: "ok",
      priceUsd: "1.25"
    });
  });

  it("maps persisted risk assessments as available risk snapshots", () => {
    const scan = toScanResultView({
      id: "scan-2",
      chainId: 4663,
      tokenId: null,
      targetAddress: "0x0000000000000000000000000000000000000001",
      state: "PARTIALLY_COMPLETED",
      scannerVersion: "0.1.0-foundation",
      idempotencyKeyHash: "hash",
      requestedBy: null,
      scanBlockNumber: 123n,
      scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
      queuedAt: new Date("2026-07-11T00:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      failureSummary: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
      token: null,
      findings: [],
      detectorResults: [],
      simulationRuns: [
        {
          id: "simulation-1",
          scanId: "scan-2",
          kind: "BUY",
          outcome: "UNSUPPORTED",
          blockNumber: 123n,
          input: {
            kind: "BUY"
          },
          result: {
            status: "UNSUPPORTED"
          },
          revertReason: null,
          gasUsed: null,
          simulationTool: "0.1.0-unsupported",
          createdAt: new Date("2026-07-11T00:00:00.000Z")
        }
      ],
      riskAssessment: {
        id: "risk-1",
        scanId: "scan-2",
        score: 60,
        level: "HIGH",
        confidence: "MEDIUM",
        scannerVersion: "0.1.0-foundation",
        scoringVersion: "0.1.0-finding-weighted",
        explanation: "Detector-based score.",
        contributions: [],
        unableToAssessReasons: [],
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        categoryScores: [
          {
            id: "category-score-1",
            riskAssessmentId: "risk-1",
            category: "CONTRACT_CONTROL",
            score: 60,
            confidence: "MEDIUM",
            explanation: null
          }
        ]
      }
    });

    expect(scan.risk).toMatchObject({
      status: "AVAILABLE",
      level: "HIGH",
      score: 60,
      categoryScores: [{ category: "CONTRACT_CONTROL", score: 60 }]
    });
    expect(scan.simulations[0]).toMatchObject({
      kind: "BUY",
      outcome: "UNSUPPORTED",
      blockNumber: "123"
    });
  });

  it("maps persisted liquidity pools into scan results", () => {
    const scan = toScanResultView(
      {
        id: "scan-3",
        chainId: 4663,
        tokenId: null,
        targetAddress: "0x0000000000000000000000000000000000000001",
        state: "PARTIALLY_COMPLETED",
        scannerVersion: "0.1.0-foundation",
        idempotencyKeyHash: "hash",
        requestedBy: null,
        scanBlockNumber: 123n,
        scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
        queuedAt: new Date("2026-07-11T00:00:00.000Z"),
        startedAt: null,
        completedAt: null,
        failureSummary: null,
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        updatedAt: new Date("2026-07-11T00:00:00.000Z"),
        token: null,
        findings: [],
        detectorResults: [],
        simulationRuns: [],
        riskAssessment: null
      },
      [
        {
          id: "pool-1",
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          poolAddress: "0x0000000000000000000000000000000000000002",
          dex: "Example DEX",
          quoteTokenAddress: "0x0000000000000000000000000000000000000003",
          firstObservedBlock: 123n,
          lastObservedBlock: 124n,
          liquidityData: { source: "fixture" },
          createdAt: new Date("2026-07-11T00:00:00.000Z"),
          updatedAt: new Date("2026-07-11T00:00:00.000Z")
        }
      ],
      []
    );

    expect(scan.liquidity).toMatchObject({
      status: "AVAILABLE",
      pools: [
        {
          poolAddress: "0x0000000000000000000000000000000000000002",
          dex: "Example DEX",
          firstObservedBlock: "123"
        }
      ]
    });
  });

  it("maps persisted holder snapshots into scan results", () => {
    const scan = toScanResultView(
      {
        id: "scan-4",
        chainId: 4663,
        tokenId: null,
        targetAddress: "0x0000000000000000000000000000000000000001",
        state: "PARTIALLY_COMPLETED",
        scannerVersion: "0.1.0-foundation",
        idempotencyKeyHash: "hash",
        requestedBy: null,
        scanBlockNumber: 123n,
        scanBlockTimestamp: new Date("2026-07-11T00:00:00.000Z"),
        queuedAt: new Date("2026-07-11T00:00:00.000Z"),
        startedAt: null,
        completedAt: null,
        failureSummary: null,
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        updatedAt: new Date("2026-07-11T00:00:00.000Z"),
        token: null,
        findings: [],
        detectorResults: [],
        simulationRuns: [],
        riskAssessment: null
      },
      [],
      [
        {
          id: "holder-snapshot-1",
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          blockNumber: 123n,
          holderCount: 10,
          topHolders: {
            holders: []
          },
          concentration: {
            top10Percent: 42
          },
          createdAt: new Date("2026-07-11T00:00:00.000Z")
        }
      ]
    );

    expect(scan.holders).toMatchObject({
      status: "AVAILABLE",
      snapshots: [
        {
          blockNumber: "123",
          holderCount: 10,
          concentration: {
            top10Percent: 42
          }
        }
      ]
    });
  });
});
