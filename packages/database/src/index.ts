import pg from "pg";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type Scan } from "@prisma/client";
import type {
  DetectorResult,
  ScoredRiskAssessment,
  SimulationResult
} from "@genesis-sentinel/security-engine";
import {
  normalizeEvmAddress,
  scannerVersion,
  type ApiKeyView,
  type ApiUsageKind,
  type BytecodeReuseView,
  type CheckOutcome,
  type DeployerHistoryView,
  type DetectorCheckView,
  type FindingContribution,
  type FindingEvidenceView,
  type FindingSeverity,
  type HolderSnapshotView,
  type HolderSummaryView,
  type LiquidityPoolView,
  type LiquiditySummaryView,
  type RecentScanView,
  type RiskSnapshot,
  type ScanResultView,
  type ScanProgress,
  type ScanState,
  type ScanStageStatus,
  type TokenProfileView,
  type OwnershipStatus,
  type PublicAnalyticsView,
  type SecurityFindingView,
  type SimulationRunView
} from "@genesis-sentinel/shared";

export interface DependencyCheck {
  name: "postgres";
  status: "ok" | "error";
  message?: string;
}

export async function checkPostgres(databaseUrl: string): Promise<DependencyCheck> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2000
  });

  try {
    await client.connect();
    await client.query("select 1");
    return { name: "postgres", status: "ok" };
  } catch (error) {
    return {
      name: "postgres",
      status: "error",
      message: error instanceof Error ? error.message : "unknown postgres error"
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export type PrismaDatabase = PrismaClient | Prisma.TransactionClient;

export interface CreateScanInput {
  id: string;
  chainId: number;
  address: `0x${string}`;
  idempotencyKeyHash: string;
  requestedBy?: string;
}

export interface ScanRepository {
  createOrGetQueuedScan(input: CreateScanInput): Promise<{ scan: ScanProgress; created: boolean }>;
  getScan(scanId: string): Promise<ScanProgress | null>;
  getScanResult(scanId: string): Promise<ScanResultView | null>;
  /** Latest scan result for a token, regardless of which scanId it lives under — used by the
   * public token page so it reflects current state instead of being pinned to whichever scan
   * an idempotency key first resolved to. */
  getLatestScanResult(chainId: number, address: `0x${string}`): Promise<ScanResultView | null>;
  /** Public "recent detections" feed — most recent scan per token, newest first, limited to
   * scans with a real persisted numeric score. */
  getRecentScans(limit: number): Promise<RecentScanView[]>;
  getPublicAnalytics?(): Promise<PublicAnalyticsView>;
  recordAnalyticsVisit?(visitorHash: string): Promise<void>;
  getTokenFindings(chainId: number, address: `0x${string}`): Promise<SecurityFindingView[]>;
  getRiskSnapshot(chainId: number, address: `0x${string}`): Promise<RiskSnapshot | null>;
  getScanTarget(scanId: string): Promise<ScanTarget | null>;
  getDeployerHistory(
    chainId: number,
    deployerAddress: `0x${string}`,
    excludeAddress: `0x${string}`
  ): Promise<DeployerHistoryView>;
  getBytecodeReuse(
    chainId: number,
    bytecodeHash: string,
    excludeAddress: `0x${string}`
  ): Promise<BytecodeReuseView>;
  updateScanState(input: UpdateScanStateInput): Promise<void>;
  recordScanBlock(input: RecordScanBlockInput): Promise<void>;
  recordStage(input: RecordStageInput): Promise<void>;
  recordContractObservation(input: RecordContractObservationInput): Promise<void>;
  recordTokenProfile(input: RecordTokenProfileInput): Promise<void>;
  recordDetectorResult(input: RecordDetectorResultInput): Promise<void>;
  recordRiskAssessment(input: RecordRiskAssessmentInput): Promise<void>;
  recordSimulationRun(input: RecordSimulationRunInput): Promise<void>;
  recordLiquidityPool(input: RecordLiquidityPoolInput): Promise<void>;
  recordHolderSnapshot(input: RecordHolderSnapshotInput): Promise<void>;
}

export interface TelegramChatIdentity {
  telegramChatId: bigint;
  type: string;
  title?: string;
}

export interface TrackTelegramAddressInput {
  chat: TelegramChatIdentity;
  chainId: number;
  address: `0x${string}`;
}

export interface TrackedTelegramAddress {
  chainId: number;
  address: `0x${string}`;
  createdAt: string;
}

export interface TelegramTrackingRepository {
  trackAddress(
    input: TrackTelegramAddressInput
  ): Promise<{ item: TrackedTelegramAddress; created: boolean }>;
  untrackAddress(input: TrackTelegramAddressInput): Promise<{ removed: boolean }>;
  listTrackedAddresses(chat: TelegramChatIdentity): Promise<TrackedTelegramAddress[]>;
}

export interface ScanTarget {
  scanId: string;
  chainId: number;
  address: `0x${string}`;
  state: ScanState;
  scanBlockNumber: bigint | null;
}

export interface UpdateScanStateInput {
  scanId: string;
  state: ScanState;
  failureSummary?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RecordScanBlockInput {
  scanId: string;
  blockNumber: bigint;
  blockTimestamp: Date;
}

export interface RecordStageInput {
  scanId: string;
  name: ScanState;
  status: ScanStageStatus;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface RecordContractObservationInput {
  chainId: number;
  address: `0x${string}`;
  blockNumber: bigint;
  bytecode: `0x${string}`;
}

export interface RecordTokenProfileInput {
  chainId: number;
  address: `0x${string}`;
  blockNumber?: bigint;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupply?: string | null;
  holderCount?: number | null;
  sourceVerified?: boolean | null;
  deployerAddress?: `0x${string}` | null;
  contractCreatedAt?: Date | null;
  creationTxHash?: `0x${string}` | null;
  tokenType?: string | null;
  iconUrl?: string | null;
  reputation?: string | null;
  priceUsd?: string | null;
  marketCapUsd?: string | null;
  volume24hUsd?: string | null;
  dexPaid?: boolean | null;
}

export interface RecordDetectorResultInput {
  scanId: string;
  result: DetectorResult;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RecordRiskAssessmentInput {
  scanId: string;
  assessment: ScoredRiskAssessment;
}

export interface RecordSimulationRunInput {
  scanId: string;
  simulation: SimulationResult;
}

export interface RecordLiquidityPoolInput {
  chainId: number;
  tokenAddress: `0x${string}`;
  poolAddress: `0x${string}`;
  blockNumber: bigint;
  dex?: string;
  quoteTokenAddress?: `0x${string}`;
  liquidityData?: Record<string, unknown>;
}

export interface RecordHolderSnapshotInput {
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: bigint;
  holderCount?: number | null;
  topHolders: Record<string, unknown>;
  concentration?: Record<string, unknown>;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg(databaseUrl);

  return new PrismaClient({
    adapter
  });
}

const scanResultInclude = Prisma.validator<Prisma.ScanInclude>()({
  token: true,
  findings: {
    include: {
      evidence: {
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  },
  detectorResults: {
    include: {
      checks: {
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    orderBy: {
      startedAt: "asc"
    }
  },
  riskAssessment: {
    include: {
      categoryScores: {
        orderBy: {
          category: "asc"
        }
      }
    }
  },
  simulationRuns: {
    orderBy: {
      createdAt: "asc"
    }
  }
});

type ScanResultRecord = Prisma.ScanGetPayload<{ include: typeof scanResultInclude }>;

export function createScanRepository(db: PrismaDatabase): ScanRepository {
  return {
    async createOrGetQueuedScan(input) {
      const normalizedAddress = normalizeEvmAddress(input.address);

      const existing = await db.scan.findUnique({
        where: {
          chainId_targetAddress_idempotencyKeyHash: {
            chainId: input.chainId,
            targetAddress: normalizedAddress,
            idempotencyKeyHash: input.idempotencyKeyHash
          }
        }
      });

      if (existing) {
        return { scan: toScanProgress(existing), created: false };
      }

      await db.chain.upsert({
        where: { chainId: input.chainId },
        update: {},
        create: {
          chainId: input.chainId,
          name: input.chainId === 4663 ? "Robinhood Chain" : `EVM Chain ${input.chainId}`
        }
      });

      const token = await db.token.upsert({
        where: {
          chainId_address: {
            chainId: input.chainId,
            address: normalizedAddress
          }
        },
        update: {},
        create: {
          chainId: input.chainId,
          address: normalizedAddress
        }
      });

      const createData: Prisma.ScanUncheckedCreateInput = {
        id: input.id,
        chainId: input.chainId,
        tokenId: token.id,
        targetAddress: normalizedAddress,
        scannerVersion,
        idempotencyKeyHash: input.idempotencyKeyHash
      };

      if (input.requestedBy) {
        createData.requestedBy = input.requestedBy;
      }

      try {
        const scan = await db.scan.create({
          data: createData
        });

        return { scan: toScanProgress(scan), created: true };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const scan = await db.scan.findUniqueOrThrow({
            where: {
              chainId_targetAddress_idempotencyKeyHash: {
                chainId: input.chainId,
                targetAddress: normalizedAddress,
                idempotencyKeyHash: input.idempotencyKeyHash
              }
            }
          });

          return { scan: toScanProgress(scan), created: false };
        }

        throw error;
      }
    },

    async getScan(scanId) {
      const scan = await db.scan.findUnique({
        where: { id: scanId }
      });

      return scan ? toScanProgress(scan) : null;
    },

    async getScanResult(scanId) {
      const scan = await db.scan.findUnique({
        where: { id: scanId },
        include: scanResultInclude
      });
      if (!scan) {
        return null;
      }

      return toScanResultView(
        scan,
        await findLiquidityPools(db, scan.chainId, scan.targetAddress),
        await findHolderSnapshots(db, scan.chainId, scan.targetAddress),
        await findFirstTokenScanTimestamp(db, scan.chainId, scan.targetAddress as `0x${string}`)
      );
    },

    async getLatestScanResult(chainId, address) {
      const latestScan = await findLatestTokenScan(db, chainId, address);
      if (!latestScan) {
        return null;
      }

      return toScanResultView(
        latestScan,
        await findLiquidityPools(db, latestScan.chainId, latestScan.targetAddress),
        await findHolderSnapshots(db, latestScan.chainId, latestScan.targetAddress),
        await findFirstTokenScanTimestamp(db, chainId, address)
      );
    },

    async getRecentScans(limit) {
      const scans = await db.scan.findMany({
        where: {
          state: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
          riskAssessment: { score: { not: null } }
        },
        distinct: ["chainId", "targetAddress"],
        orderBy: { completedAt: "desc" },
        take: limit,
        include: { token: true, riskAssessment: true }
      });

      return scans.flatMap((scan): RecentScanView[] => {
        const score = scan.riskAssessment?.score;
        if (score === null || score === undefined) {
          return [];
        }

        return [
          {
            chainId: scan.chainId,
            address: scan.targetAddress as `0x${string}`,
            name: scan.token?.name ?? null,
            symbol: scan.token?.symbol ?? null,
            riskScore: score,
            riskLevel:
              scan.riskAssessment?.level === "UNABLE_TO_VERIFY"
                ? "UNABLE_TO_ASSESS"
                : (scan.riskAssessment?.level ?? "UNABLE_TO_ASSESS"),
            scannedAt: (scan.completedAt ?? scan.queuedAt).toISOString()
          }
        ];
      });
    },

    async getPublicAnalytics() {
      return buildPublicAnalytics(db);
    },

    async recordAnalyticsVisit(visitorHash) {
      await db.analyticsVisitor.upsert({
        where: { id: visitorHash },
        create: { id: visitorHash },
        update: { visitCount: { increment: 1 } }
      });
    },

    async getTokenFindings(chainId, address) {
      const latestScan = await findLatestTokenScan(db, chainId, address);

      return latestScan ? latestScan.findings.map(toSecurityFindingView) : [];
    },

    async getRiskSnapshot(chainId, address) {
      const latestScan = await findLatestTokenScan(db, chainId, address);

      return latestScan ? toRiskSnapshot(latestScan) : null;
    },

    async getScanTarget(scanId) {
      const scan = await db.scan.findUnique({
        where: { id: scanId },
        select: {
          id: true,
          chainId: true,
          targetAddress: true,
          state: true,
          scanBlockNumber: true
        }
      });

      if (!scan) {
        return null;
      }

      return {
        scanId: scan.id,
        chainId: scan.chainId,
        address: scan.targetAddress as `0x${string}`,
        state: scan.state,
        scanBlockNumber: scan.scanBlockNumber
      };
    },

    async updateScanState(input) {
      const data: Prisma.ScanUpdateInput = {
        state: input.state
      };

      if (input.failureSummary) {
        data.failureSummary = input.failureSummary;
      }

      if (input.startedAt) {
        data.startedAt = input.startedAt;
      }

      if (input.completedAt) {
        data.completedAt = input.completedAt;
      }

      await db.scan.update({
        where: { id: input.scanId },
        data
      });
    },

    async recordScanBlock(input) {
      await db.scan.update({
        where: { id: input.scanId },
        data: {
          scanBlockNumber: input.blockNumber,
          scanBlockTimestamp: input.blockTimestamp
        }
      });
    },

    async recordStage(input) {
      const data: Prisma.ScanStageUncheckedCreateInput = {
        scanId: input.scanId,
        name: input.name,
        status: input.status
      };
      const update: Prisma.ScanStageUncheckedUpdateInput = {
        status: input.status
      };

      if (input.startedAt) {
        data.startedAt = input.startedAt;
        update.startedAt = input.startedAt;
      }

      if (input.completedAt) {
        data.completedAt = input.completedAt;
        update.completedAt = input.completedAt;
      }

      if (input.errorCode) {
        data.errorCode = input.errorCode;
        update.errorCode = input.errorCode;
      }

      if (input.errorMessage) {
        data.errorMessage = input.errorMessage;
        update.errorMessage = input.errorMessage;
      }

      if (input.metadata) {
        data.metadata = input.metadata;
        update.metadata = input.metadata;
      }

      await db.scanStage.upsert({
        where: {
          scanId_name: {
            scanId: input.scanId,
            name: input.name
          }
        },
        create: data,
        update
      });
    },

    async recordContractObservation(input) {
      const normalizedAddress = normalizeEvmAddress(input.address);
      const bytecodeHash = input.bytecode === "0x" ? null : hashHex(input.bytecode);

      await db.contract.upsert({
        where: {
          chainId_address: {
            chainId: input.chainId,
            address: normalizedAddress
          }
        },
        update: {
          lastBytecodeBlock: input.blockNumber,
          bytecodeHash
        },
        create: {
          chainId: input.chainId,
          address: normalizedAddress,
          firstObservedBlock: input.blockNumber,
          lastBytecodeBlock: input.blockNumber,
          bytecodeHash
        }
      });
    },

    async recordTokenProfile(input) {
      const normalizedAddress = normalizeEvmAddress(input.address);
      const now = new Date();
      const createData: Prisma.TokenUncheckedCreateInput = {
        chainId: input.chainId,
        address: normalizedAddress,
        name: input.name ?? null,
        symbol: input.symbol ?? null,
        decimals: input.decimals ?? null,
        totalSupply: input.totalSupply ?? null,
        holderCount: input.holderCount ?? null,
        sourceVerified: input.sourceVerified ?? null,
        deployerAddress: input.deployerAddress ? normalizeEvmAddress(input.deployerAddress) : null,
        contractCreatedAt: input.contractCreatedAt ?? null,
        creationTxHash: input.creationTxHash ?? null,
        tokenType: input.tokenType ?? null,
        iconUrl: input.iconUrl ?? null,
        reputation: input.reputation ?? null,
        priceUsd: input.priceUsd ?? null,
        marketCapUsd: input.marketCapUsd ?? null,
        volume24hUsd: input.volume24hUsd ?? null,
        dexPaid: input.dexPaid ?? null,
        metadataUpdatedAt: now
      };
      const updateData: Prisma.TokenUncheckedUpdateInput = {
        metadataUpdatedAt: now
      };

      if (input.blockNumber !== undefined) {
        createData.metadataBlock = input.blockNumber;
        updateData.metadataBlock = input.blockNumber;
      }

      if (input.name !== undefined) updateData.name = input.name;
      if (input.symbol !== undefined) updateData.symbol = input.symbol;
      if (input.decimals !== undefined) updateData.decimals = input.decimals;
      if (input.totalSupply !== undefined) updateData.totalSupply = input.totalSupply;
      if (input.holderCount !== undefined) updateData.holderCount = input.holderCount;
      if (input.sourceVerified !== undefined) updateData.sourceVerified = input.sourceVerified;
      if (input.deployerAddress !== undefined) {
        updateData.deployerAddress = input.deployerAddress
          ? normalizeEvmAddress(input.deployerAddress)
          : null;
      }
      if (input.contractCreatedAt !== undefined)
        updateData.contractCreatedAt = input.contractCreatedAt;
      if (input.creationTxHash !== undefined) updateData.creationTxHash = input.creationTxHash;
      if (input.tokenType !== undefined) updateData.tokenType = input.tokenType;
      if (input.iconUrl !== undefined) updateData.iconUrl = input.iconUrl;
      if (input.reputation !== undefined) updateData.reputation = input.reputation;
      if (input.priceUsd !== undefined) updateData.priceUsd = input.priceUsd;
      if (input.marketCapUsd !== undefined) updateData.marketCapUsd = input.marketCapUsd;
      if (input.volume24hUsd !== undefined) updateData.volume24hUsd = input.volume24hUsd;
      if (input.dexPaid !== undefined) updateData.dexPaid = input.dexPaid;

      await db.chain.upsert({
        where: { chainId: input.chainId },
        update: {},
        create: {
          chainId: input.chainId,
          name: input.chainId === 4663 ? "Robinhood Chain" : `EVM Chain ${input.chainId}`
        }
      });

      await db.token.upsert({
        where: {
          chainId_address: {
            chainId: input.chainId,
            address: normalizedAddress
          }
        },
        create: createData,
        update: updateData
      });
    },

    async recordDetectorResult(input) {
      await db.detector.upsert({
        where: {
          id: input.result.detector.id
        },
        update: {
          name: input.result.detector.name,
          description: input.result.detector.description
        },
        create: {
          id: input.result.detector.id,
          name: input.result.detector.name,
          description: input.result.detector.description
        }
      });

      const detectorResultData: Prisma.DetectorResultUncheckedCreateInput = {
        scanId: input.scanId,
        detectorId: input.result.detector.id,
        detectorVersion: input.result.detector.version,
        metadata: toJsonValue({
          checks: input.result.checks.map((check) => {
            const checkMetadata: Record<string, unknown> = {
              code: check.code,
              outcome: check.outcome,
              confidence: check.confidence
            };

            if (check.errorMessage) {
              checkMetadata.errorMessage = check.errorMessage;
            }

            return checkMetadata;
          })
        })
      };
      const outcome =
        input.result.findings.length > 0 ? "DETECTED" : firstCheckOutcome(input.result);

      if (input.startedAt) {
        detectorResultData.startedAt = input.startedAt;
      }

      if (input.completedAt) {
        detectorResultData.completedAt = input.completedAt;
      }

      if (outcome) {
        detectorResultData.outcome = outcome;
      }

      const detectorResult = await db.detectorResult.create({
        data: detectorResultData
      });

      if (input.result.checks.length > 0) {
        await db.detectorCheck.createMany({
          data: input.result.checks.map((check) => ({
            detectorResultId: detectorResult.id,
            code: check.code,
            outcome: check.outcome,
            confidence: check.confidence,
            evidence: toJsonValue({
              evidence: check.evidence.map((evidence) => ({
                type: evidence.type,
                summary: evidence.summary,
                data: evidence.data,
                blockNumber: evidence.blockNumber?.toString(),
                transactionHash: evidence.transactionHash,
                address: evidence.address ? normalizeEvmAddress(evidence.address) : undefined
              }))
            }),
            errorMessage: check.errorMessage ?? null
          }))
        });
      }

      for (const finding of input.result.findings) {
        const findingData: Prisma.FindingUncheckedCreateInput = {
          scanId: input.scanId,
          detectorResultId: detectorResult.id,
          code: finding.code,
          detectorId: finding.detectorId,
          detectorVersion: finding.detectorVersion,
          title: finding.title,
          severity: finding.severity,
          category: finding.category,
          confidence: finding.confidence,
          description: finding.description,
          technicalExplanation: finding.technicalExplanation
        };

        if (finding.recommendation) {
          findingData.recommendation = finding.recommendation;
        }

        const savedFinding = await db.finding.create({
          data: findingData
        });

        const evidenceRows = finding.evidence.map((evidence) => {
          const evidenceData: Prisma.FindingEvidenceUncheckedCreateInput = {
            findingId: savedFinding.id,
            type: evidence.type,
            summary: evidence.summary,
            data: toJsonValue(evidence.data)
          };

          if (evidence.blockNumber !== undefined) {
            evidenceData.blockNumber = evidence.blockNumber;
          }

          if (evidence.transactionHash) {
            evidenceData.transactionHash = evidence.transactionHash;
          }

          if (evidence.address) {
            evidenceData.address = normalizeEvmAddress(evidence.address);
          }

          return evidenceData;
        });

        await Promise.all(
          evidenceRows.map((evidenceData) =>
            db.findingEvidence.create({
              data: evidenceData
            })
          )
        );
      }
    },

    async recordRiskAssessment(input) {
      const existing = await db.riskAssessment.findUnique({
        where: {
          scanId: input.scanId
        },
        select: {
          id: true
        }
      });

      const contributions = toJsonValue(input.assessment.findingContributions);
      const data: Prisma.RiskAssessmentUncheckedCreateInput = {
        scanId: input.scanId,
        score: input.assessment.score,
        level: input.assessment.level,
        confidence: input.assessment.confidence,
        scannerVersion: input.assessment.scannerVersion,
        scoringVersion: input.assessment.scoringVersion,
        explanation: input.assessment.explanation,
        contributions,
        unableToAssessReasons: input.assessment.unableToAssessReasons
      };
      const update: Prisma.RiskAssessmentUncheckedUpdateInput = {
        score: input.assessment.score,
        level: input.assessment.level,
        confidence: input.assessment.confidence,
        scannerVersion: input.assessment.scannerVersion,
        scoringVersion: input.assessment.scoringVersion,
        explanation: input.assessment.explanation,
        contributions,
        unableToAssessReasons: input.assessment.unableToAssessReasons
      };

      const riskAssessment = existing
        ? await db.riskAssessment.update({
            where: {
              scanId: input.scanId
            },
            data: update
          })
        : await db.riskAssessment.create({
            data
          });

      await db.categoryScore.deleteMany({
        where: {
          riskAssessmentId: riskAssessment.id
        }
      });
      await db.categoryScore.createMany({
        data: input.assessment.categoryScores.map((categoryScore) => ({
          riskAssessmentId: riskAssessment.id,
          category: categoryScore.category,
          score: categoryScore.score,
          confidence: categoryScore.confidence,
          explanation: categoryScore.explanation ?? null
        }))
      });
    },

    async recordSimulationRun(input) {
      const data: Prisma.SimulationRunUncheckedCreateInput = {
        scanId: input.scanId,
        kind: input.simulation.kind,
        outcome: input.simulation.outcome,
        input: toJsonValue(input.simulation.input),
        simulationTool: input.simulation.simulationTool
      };

      if (input.simulation.blockNumber !== undefined) {
        data.blockNumber = input.simulation.blockNumber;
      }

      if (input.simulation.result) {
        data.result = toJsonValue(input.simulation.result);
      }

      if (input.simulation.revertReason) {
        data.revertReason = input.simulation.revertReason;
      }

      if (input.simulation.gasUsed !== undefined) {
        data.gasUsed = input.simulation.gasUsed;
      }

      await db.simulationRun.create({
        data
      });
    },

    async recordLiquidityPool(input) {
      const tokenAddress = normalizeEvmAddress(input.tokenAddress);
      const poolAddress = normalizeEvmAddress(input.poolAddress);
      const liquidityData = input.liquidityData ? toJsonValue(input.liquidityData) : undefined;

      const createData: Prisma.LiquidityPoolUncheckedCreateInput = {
        chainId: input.chainId,
        tokenAddress,
        poolAddress,
        firstObservedBlock: input.blockNumber,
        lastObservedBlock: input.blockNumber
      };
      const updateData: Prisma.LiquidityPoolUncheckedUpdateInput = {
        lastObservedBlock: input.blockNumber
      };

      if (input.dex) {
        createData.dex = input.dex;
        updateData.dex = input.dex;
      }

      if (input.quoteTokenAddress) {
        const quoteTokenAddress = normalizeEvmAddress(input.quoteTokenAddress);
        createData.quoteTokenAddress = quoteTokenAddress;
        updateData.quoteTokenAddress = quoteTokenAddress;
      }

      if (liquidityData) {
        createData.liquidityData = liquidityData;
        updateData.liquidityData = liquidityData;
      }

      await db.liquidityPool.upsert({
        where: {
          chainId_poolAddress: {
            chainId: input.chainId,
            poolAddress
          }
        },
        create: createData,
        update: updateData
      });
    },

    async recordHolderSnapshot(input) {
      const tokenAddress = normalizeEvmAddress(input.tokenAddress);
      const createData: Prisma.HolderSnapshotUncheckedCreateInput = {
        chainId: input.chainId,
        tokenAddress,
        blockNumber: input.blockNumber,
        topHolders: toJsonValue(input.topHolders)
      };
      const updateData: Prisma.HolderSnapshotUncheckedUpdateInput = {
        topHolders: toJsonValue(input.topHolders)
      };

      if (input.holderCount !== undefined && input.holderCount !== null) {
        createData.holderCount = input.holderCount;
        updateData.holderCount = input.holderCount;
      }

      if (input.concentration) {
        const concentration = toJsonValue(input.concentration);
        createData.concentration = concentration;
        updateData.concentration = concentration;
      }

      await db.holderSnapshot.upsert({
        where: {
          chainId_tokenAddress_blockNumber: {
            chainId: input.chainId,
            tokenAddress,
            blockNumber: input.blockNumber
          }
        },
        create: createData,
        update: updateData
      });
    },

    async getDeployerHistory(chainId, deployerAddress, excludeAddress) {
      const normalizedDeployer = normalizeEvmAddress(deployerAddress);
      const normalizedExclude = normalizeEvmAddress(excludeAddress);

      const tokens = await db.token.findMany({
        where: {
          chainId,
          deployerAddress: normalizedDeployer,
          address: { not: normalizedExclude }
        },
        include: {
          scans: {
            where: { state: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] } },
            orderBy: { completedAt: "desc" },
            take: 1,
            include: {
              riskAssessment: true,
              findings: {
                where: { severity: { in: ["HIGH", "CRITICAL"] } },
                select: { id: true }
              }
            }
          }
        }
      });

      const entries = tokens.flatMap((token) => {
        const scan = token.scans[0];
        if (!scan) {
          return [];
        }

        return [
          {
            chainId: token.chainId,
            tokenAddress: token.address as `0x${string}`,
            scanId: scan.id,
            riskLevel: scan.riskAssessment
              ? scan.riskAssessment.level === "UNABLE_TO_VERIFY"
                ? ("UNABLE_TO_ASSESS" as const)
                : scan.riskAssessment.level
              : null,
            riskScore: scan.riskAssessment?.score ?? null,
            highOrCriticalFindingCount: scan.findings.length,
            scannedAt: (scan.completedAt ?? scan.createdAt).toISOString()
          }
        ];
      });

      return {
        deployerAddress: normalizedDeployer,
        previousTokenCount: entries.length,
        previousHighOrCriticalCount: entries.filter((entry) => entry.highOrCriticalFindingCount > 0)
          .length,
        entries
      };
    },

    async getBytecodeReuse(chainId, bytecodeHash, excludeAddress) {
      const normalizedExclude = normalizeEvmAddress(excludeAddress);
      const contracts = await db.contract.findMany({
        where: {
          chainId,
          bytecodeHash,
          address: { not: normalizedExclude }
        },
        select: { address: true },
        take: 25
      });

      return {
        bytecodeHash,
        reusedByCount: contracts.length,
        reusedByAddresses: contracts.map((contract) => contract.address as `0x${string}`)
      };
    }
  };
}

type AnalyticsAggregateRow = {
  tokens_analyzed: bigint;
  scans_completed: bigint;
  unique_contracts: bigint;
  high_risk_tokens: bigint;
  risk_signals: bigint;
  honeypots: bigint;
  high_tax_tokens: bigint;
  dangerous_liquidity_tokens: bigint;
  concentrated_holder_tokens: bigint;
  privileged_control_tokens: bigint;
  analyzed_liquidity_usd: number | null;
  unique_users: bigint;
  total_visits: bigint;
  first_scan_at: Date | null;
  last_24_hours: bigint;
  last_7_days: bigint;
  previous_7_days: bigint;
  last_30_days: bigint;
  previous_30_days: bigint;
};

async function buildPublicAnalytics(db: PrismaDatabase): Promise<PublicAnalyticsView> {
  const [aggregate] = await db.$queryRaw<AnalyticsAggregateRow[]>(Prisma.sql`
    WITH completed AS (
      SELECT * FROM "Scan" WHERE state IN ('COMPLETED', 'PARTIALLY_COMPLETED')
    ), latest AS (
      SELECT DISTINCT ON ("chainId", "targetAddress") *
      FROM completed ORDER BY "chainId", "targetAddress", COALESCE("completedAt", "queuedAt") DESC
    ), latest_holders AS (
      SELECT DISTINCT ON ("chainId", "tokenAddress") * FROM "HolderSnapshot"
      ORDER BY "chainId", "tokenAddress", "blockNumber" DESC
    )
    SELECT
      (SELECT COUNT(DISTINCT ("chainId", "targetAddress")) FROM completed) AS tokens_analyzed,
      (SELECT COUNT(*) FROM completed) AS scans_completed,
      (SELECT COUNT(DISTINCT ("chainId", address)) FROM "Contract" WHERE "bytecodeHash" IS NOT NULL) AS unique_contracts,
      (SELECT COUNT(*) FROM latest l JOIN "RiskAssessment" r ON r."scanId" = l.id WHERE r.level IN ('HIGH', 'CRITICAL')) AS high_risk_tokens,
      (SELECT COUNT(*) FROM "Finding" f JOIN latest l ON l.id = f."scanId" WHERE f.severity <> 'INFO') AS risk_signals,
      (SELECT COUNT(DISTINCT (s."chainId", s."targetAddress")) FROM "SimulationRun" sr JOIN latest s ON s.id = sr."scanId" WHERE (sr.result->>'isHoneypot')::boolean IS TRUE) AS honeypots,
      (SELECT COUNT(DISTINCT (s."chainId", s."targetAddress")) FROM "SimulationRun" sr JOIN latest s ON s.id = sr."scanId" WHERE COALESCE((sr.result->>'buyTaxBps')::numeric, 0) > 500 OR COALESCE((sr.result->>'sellTaxBps')::numeric, 0) > 500 OR COALESCE((sr.result->>'transferTaxBps')::numeric, 0) > 500) AS high_tax_tokens,
      (SELECT COUNT(DISTINCT ("chainId", "tokenAddress")) FROM "LiquidityPool" WHERE ("liquidityData" ? 'totalLiquidityUsd' AND ("liquidityData"->>'totalLiquidityUsd')::numeric < 1000) OR ("liquidityData" ? 'lpBurnedOrLockedPct' AND ("liquidityData"->>'lpBurnedOrLockedPct')::numeric < 80)) AS dangerous_liquidity_tokens,
      (SELECT COUNT(*) FROM latest_holders WHERE COALESCE((concentration->>'top10Pct')::numeric, 0) >= 35) AS concentrated_holder_tokens,
      (SELECT COUNT(DISTINCT (l."chainId", l."targetAddress")) FROM "Finding" f JOIN latest l ON l.id = f."scanId" WHERE f.code ~ '(MINT|BLACKLIST|PAUSE|TAX|TRADING|PROXY|UPGRADE|WHITELIST)') AS privileged_control_tokens,
      (SELECT COALESCE(SUM(("liquidityData"->>'totalLiquidityUsd')::numeric), 0) FROM "LiquidityPool" WHERE "liquidityData" ? 'totalLiquidityUsd') AS analyzed_liquidity_usd,
      (SELECT COUNT(*) FROM "AnalyticsVisitor") AS unique_users,
      (SELECT COALESCE(SUM("visitCount"), 0) FROM "AnalyticsVisitor") AS total_visits,
      (SELECT MIN(COALESCE("completedAt", "queuedAt")) FROM completed) AS first_scan_at,
      (SELECT COUNT(*) FROM completed WHERE COALESCE("completedAt", "queuedAt") >= NOW() - INTERVAL '24 hours') AS last_24_hours,
      (SELECT COUNT(*) FROM completed WHERE COALESCE("completedAt", "queuedAt") >= NOW() - INTERVAL '7 days') AS last_7_days,
      (SELECT COUNT(*) FROM completed WHERE COALESCE("completedAt", "queuedAt") >= NOW() - INTERVAL '14 days' AND COALESCE("completedAt", "queuedAt") < NOW() - INTERVAL '7 days') AS previous_7_days,
      (SELECT COUNT(*) FROM completed WHERE COALESCE("completedAt", "queuedAt") >= NOW() - INTERVAL '30 days') AS last_30_days,
      (SELECT COUNT(*) FROM completed WHERE COALESCE("completedAt", "queuedAt") >= NOW() - INTERVAL '60 days' AND COALESCE("completedAt", "queuedAt") < NOW() - INTERVAL '30 days') AS previous_30_days
  `);

  if (!aggregate) throw new Error("Analytics aggregate query returned no row.");

  const [daily, categories, risks, trending, coverage] = await Promise.all([
    db.$queryRaw<Array<{ date: Date; scans: bigint }>>(Prisma.sql`
      SELECT day::date AS date, COUNT(s.id) AS scans
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') day
      LEFT JOIN "Scan" s ON DATE(COALESCE(s."completedAt", s."queuedAt")) = day::date AND s.state IN ('COMPLETED', 'PARTIALLY_COMPLETED')
      GROUP BY day ORDER BY day
    `),
    db.$queryRaw<Array<{ key: string; count: bigint }>>(Prisma.sql`
      WITH latest AS (SELECT DISTINCT ON ("chainId", "targetAddress") id FROM "Scan" WHERE state IN ('COMPLETED', 'PARTIALLY_COMPLETED') ORDER BY "chainId", "targetAddress", COALESCE("completedAt", "queuedAt") DESC)
      SELECT f.category::text AS key, COUNT(*) AS count FROM "Finding" f JOIN latest l ON l.id = f."scanId" WHERE f.severity <> 'INFO' GROUP BY f.category ORDER BY count DESC
    `),
    db.$queryRaw<Array<{ key: string; label: string; count: bigint }>>(Prisma.sql`
      WITH latest AS (SELECT DISTINCT ON ("chainId", "targetAddress") id FROM "Scan" WHERE state IN ('COMPLETED', 'PARTIALLY_COMPLETED') ORDER BY "chainId", "targetAddress", COALESCE("completedAt", "queuedAt") DESC)
      SELECT f.code AS key, MAX(f.title) AS label, COUNT(*) AS count FROM "Finding" f JOIN latest l ON l.id = f."scanId" WHERE f.severity <> 'INFO' GROUP BY f.code ORDER BY count DESC LIMIT 8
    `),
    db.$queryRaw<
      Array<{
        chainId: number;
        address: string;
        name: string | null;
        symbol: string | null;
        scans: bigint;
        lastScannedAt: Date;
      }>
    >(Prisma.sql`
      SELECT s."chainId", s."targetAddress" AS address, MAX(t.name) AS name, MAX(t.symbol) AS symbol, COUNT(*) AS scans, MAX(COALESCE(s."completedAt", s."queuedAt")) AS "lastScannedAt"
      FROM "Scan" s LEFT JOIN "Token" t ON t.id = s."tokenId" WHERE COALESCE(s."completedAt", s."queuedAt") >= NOW() - INTERVAL '30 days'
      GROUP BY s."chainId", s."targetAddress" ORDER BY scans DESC, "lastScannedAt" DESC LIMIT 8
    `),
    db.$queryRaw<Array<{ key: string; count: bigint }>>(Prisma.sql`
      WITH latest AS (SELECT DISTINCT ON ("chainId", "targetAddress") * FROM "Scan" WHERE state IN ('COMPLETED', 'PARTIALLY_COMPLETED') ORDER BY "chainId", "targetAddress", COALESCE("completedAt", "queuedAt") DESC)
      SELECT 'contracts' AS key, COUNT(*) FROM latest WHERE EXISTS (SELECT 1 FROM "Contract" c WHERE c."chainId" = latest."chainId" AND c.address = latest."targetAddress")
      UNION ALL SELECT 'liquidity', COUNT(*) FROM latest WHERE EXISTS (SELECT 1 FROM "LiquidityPool" p WHERE p."chainId" = latest."chainId" AND p."tokenAddress" = latest."targetAddress")
      UNION ALL SELECT 'holders', COUNT(*) FROM latest WHERE EXISTS (SELECT 1 FROM "HolderSnapshot" h WHERE h."chainId" = latest."chainId" AND h."tokenAddress" = latest."targetAddress")
      UNION ALL SELECT 'simulations', COUNT(*) FROM latest WHERE EXISTS (SELECT 1 FROM "SimulationRun" r WHERE r."scanId" = latest.id AND r."simulationTool" <> '0.1.0-uniswap-v2-route-quote')
      UNION ALL SELECT 'source', COUNT(*) FROM latest JOIN "Token" t ON t.id = latest."tokenId" WHERE t."sourceVerified" IS TRUE
    `)
  ]);

  const n = (value: bigint) => Number(value);
  const growth = (current: bigint, previous: bigint) =>
    n(previous) === 0 ? null : Math.round(((n(current) - n(previous)) / n(previous)) * 1000) / 10;
  const daysLive = aggregate.first_scan_at
    ? Math.max(1, Math.ceil((Date.now() - aggregate.first_scan_at.getTime()) / 86_400_000))
    : 1;
  const labels: Record<string, string> = {
    CONTRACT_CONTROL: "Contract controls",
    TRADING_SAFETY: "Trading safety",
    LIQUIDITY_SAFETY: "Liquidity",
    DISTRIBUTION_RISK: "Holder distribution",
    REPUTATION_RISK: "Reputation",
    contracts: "Contract bytecode",
    liquidity: "Liquidity",
    holders: "Holder analysis",
    simulations: "Executed simulations",
    source: "Verified source"
  };

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      tokensAnalyzed: n(aggregate.tokens_analyzed),
      scansCompleted: n(aggregate.scans_completed),
      uniqueContracts: n(aggregate.unique_contracts),
      highRiskTokens: n(aggregate.high_risk_tokens),
      riskSignals: n(aggregate.risk_signals),
      honeypots: n(aggregate.honeypots),
      highTaxTokens: n(aggregate.high_tax_tokens),
      dangerousLiquidityTokens: n(aggregate.dangerous_liquidity_tokens),
      concentratedHolderTokens: n(aggregate.concentrated_holder_tokens),
      privilegedControlTokens: n(aggregate.privileged_control_tokens),
      analyzedLiquidityUsd: Number(aggregate.analyzed_liquidity_usd ?? 0),
      uniqueUsers: n(aggregate.unique_users),
      totalVisits: n(aggregate.total_visits)
    },
    activity: {
      last24Hours: n(aggregate.last_24_hours),
      last7Days: n(aggregate.last_7_days),
      last30Days: n(aggregate.last_30_days),
      averagePerDay: Math.round((n(aggregate.scans_completed) / daysLive) * 10) / 10,
      sevenDayGrowthPct: growth(aggregate.last_7_days, aggregate.previous_7_days),
      thirtyDayGrowthPct: growth(aggregate.last_30_days, aggregate.previous_30_days),
      daily: daily.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        scans: n(row.scans)
      }))
    },
    riskCategories: categories.map((row) => ({
      key: row.key,
      label: labels[row.key] ?? row.key,
      count: n(row.count)
    })),
    frequentRisks: risks.map((row) => ({ key: row.key, label: row.label, count: n(row.count) })),
    trendingTokens: trending.map((row) => ({
      chainId: row.chainId,
      address: row.address as `0x${string}`,
      name: row.name,
      symbol: row.symbol,
      scans: n(row.scans),
      lastScannedAt: row.lastScannedAt.toISOString()
    })),
    coverage: coverage.map((row) => ({
      key: row.key,
      label: labels[row.key] ?? row.key,
      count: n(row.count)
    }))
  };
}

export function createTelegramTrackingRepository(db: PrismaDatabase): TelegramTrackingRepository {
  return {
    async trackAddress(input) {
      const watchlist = await findOrCreateTelegramWatchlist(db, input.chat);
      const address = normalizeEvmAddress(input.address);

      const existing = await db.watchlistItem.findUnique({
        where: {
          watchlistId_chainId_address: {
            watchlistId: watchlist.id,
            chainId: input.chainId,
            address
          }
        }
      });

      if (existing) {
        return { item: toTrackedTelegramAddress(existing), created: false };
      }

      try {
        const item = await db.watchlistItem.create({
          data: {
            watchlistId: watchlist.id,
            chainId: input.chainId,
            address
          }
        });

        return { item: toTrackedTelegramAddress(item), created: true };
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const item = await db.watchlistItem.findUniqueOrThrow({
          where: {
            watchlistId_chainId_address: {
              watchlistId: watchlist.id,
              chainId: input.chainId,
              address
            }
          }
        });

        return { item: toTrackedTelegramAddress(item), created: false };
      }
    },

    async untrackAddress(input) {
      const watchlist = await findTelegramWatchlist(db, input.chat);
      if (!watchlist) {
        return { removed: false };
      }

      const result = await db.watchlistItem.deleteMany({
        where: {
          watchlistId: watchlist.id,
          chainId: input.chainId,
          address: normalizeEvmAddress(input.address)
        }
      });

      return { removed: result.count > 0 };
    },

    async listTrackedAddresses(chat) {
      const watchlist = await findTelegramWatchlist(db, chat);
      if (!watchlist) {
        return [];
      }

      const items = await db.watchlistItem.findMany({
        where: {
          watchlistId: watchlist.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 25
      });

      return items.map(toTrackedTelegramAddress);
    }
  };
}

export interface CreateApiKeyRecordInput {
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
}

export interface RecordApiUsageInput {
  apiKeyId: string | null;
  route: string;
  method: string;
  status: number;
  kind: ApiUsageKind;
  units?: number;
}

export interface ApiKeyRepository {
  createApiKey(input: CreateApiKeyRecordInput): Promise<ApiKeyView>;
  getApiKeyByHash(keyHash: string): Promise<ApiKeyView | null>;
  touchApiKeyLastUsed(id: string): Promise<void>;
  revokeApiKey(id: string): Promise<ApiKeyView | null>;
  recordApiUsage(input: RecordApiUsageInput): Promise<void>;
  /** Lightweight audit trail for API-key lifecycle events (creation/revocation), reusing the
   * existing generic SecurityEvent table rather than a dedicated audit-log model. */
  recordAuditEvent(input: {
    type: string;
    subject?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

function toApiKeyView(record: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  enabled: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): ApiKeyView {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    rateLimitPerMinute: record.rateLimitPerMinute,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null
  };
}

export function createApiKeyRepository(db: PrismaDatabase): ApiKeyRepository {
  return {
    async createApiKey(input) {
      const record = await db.aPIKey.create({
        data: {
          name: input.name,
          keyHash: input.keyHash,
          prefix: input.prefix,
          scopes: input.scopes,
          rateLimitPerMinute: input.rateLimitPerMinute
        }
      });

      return toApiKeyView(record);
    },

    async getApiKeyByHash(keyHash) {
      const record = await db.aPIKey.findUnique({ where: { keyHash } });
      return record ? toApiKeyView(record) : null;
    },

    async touchApiKeyLastUsed(id) {
      await db.aPIKey.update({
        where: { id },
        data: { lastUsedAt: new Date() }
      });
    },

    async revokeApiKey(id) {
      const existing = await db.aPIKey.findUnique({ where: { id } });
      if (!existing || existing.revokedAt) {
        return existing ? toApiKeyView(existing) : null;
      }

      const record = await db.aPIKey.update({
        where: { id },
        data: { revokedAt: new Date(), enabled: false }
      });

      return toApiKeyView(record);
    },

    async recordApiUsage(input) {
      await db.aPIUsage.create({
        data: {
          apiKeyId: input.apiKeyId,
          route: input.route,
          method: input.method,
          status: input.status,
          kind: input.kind,
          units: input.units ?? 1
        }
      });
    },

    async recordAuditEvent(input) {
      await db.securityEvent.create({
        data: {
          type: input.type,
          severity: "info",
          subject: input.subject ?? null,
          ...(input.metadata ? { metadata: toJsonValue(input.metadata) } : {})
        }
      });
    }
  };
}

export function toScanProgress(scan: Scan, firstScannedAt?: Date | null): ScanProgress {
  const progress: ScanProgress = {
    scanId: scan.id,
    chainId: scan.chainId,
    address: scan.targetAddress as `0x${string}`,
    state: scan.state,
    scannerVersion: scan.scannerVersion,
    submittedAt: scan.queuedAt.toISOString(),
    message:
      scan.state === "QUEUED"
        ? "Scan is queued for worker orchestration."
        : `Scan state is ${scan.state}.`
  };

  if (scan.completedAt) {
    progress.completedAt = scan.completedAt.toISOString();
  }

  if (scan.scanBlockNumber !== null) {
    progress.scanBlockNumber = scan.scanBlockNumber.toString();
  }

  if (firstScannedAt) {
    progress.firstScannedAt = firstScannedAt.toISOString();
  }

  return progress;
}

export function toScanResultView(
  scan: ScanResultRecord,
  liquidityPools: LiquidityPoolRecord[] = [],
  holderSnapshots: HolderSnapshotRecord[] = [],
  firstScannedAt?: Date | null
): ScanResultView {
  return {
    scan: toScanProgress(scan, firstScannedAt),
    token: toTokenProfileView(scan),
    detectorChecks: scan.detectorResults.flatMap(toDetectorCheckViews),
    findings: scan.findings.map(toSecurityFindingView),
    liquidity: toLiquiditySummary(liquidityPools),
    holders: toHolderSummary(holderSnapshots),
    simulations: scan.simulationRuns.map(toSimulationRunView),
    risk: toRiskSnapshot(scan)
  };
}

function toTokenProfileView(scan: ScanResultRecord): TokenProfileView {
  const profile: TokenProfileView = {
    chainId: scan.chainId,
    address: scan.targetAddress as `0x${string}`
  };
  const ownership = deriveOwnershipProfile(scan);

  if (scan.token?.name) {
    profile.name = scan.token.name;
  }

  if (scan.token?.symbol) {
    profile.symbol = scan.token.symbol;
  }

  if (scan.token?.decimals !== null && scan.token?.decimals !== undefined) {
    profile.decimals = scan.token.decimals;
  }

  if (scan.token?.totalSupply) {
    profile.totalSupply = scan.token.totalSupply;
  }

  if (scan.token?.holderCount !== null && scan.token?.holderCount !== undefined) {
    profile.holderCount = scan.token.holderCount;
  }

  if (scan.token?.sourceVerified !== null && scan.token?.sourceVerified !== undefined) {
    profile.sourceVerified = scan.token.sourceVerified;
  }

  if (scan.token?.deployerAddress) {
    profile.deployerAddress = scan.token.deployerAddress as `0x${string}`;
  }

  if (scan.token?.contractCreatedAt) {
    profile.contractCreatedAt = scan.token.contractCreatedAt.toISOString();
  }

  if (scan.token?.creationTxHash) {
    profile.creationTxHash = scan.token.creationTxHash as `0x${string}`;
  }

  if (scan.token?.tokenType) {
    profile.tokenType = scan.token.tokenType;
  }

  if (scan.token?.iconUrl) {
    profile.iconUrl = scan.token.iconUrl;
  }

  if (scan.token?.reputation) {
    profile.reputation = scan.token.reputation;
  }

  if (ownership.ownerAddress) {
    profile.ownerAddress = ownership.ownerAddress;
  }

  if (ownership.ownershipStatus) {
    profile.ownershipStatus = ownership.ownershipStatus;
  }

  if (scan.token?.priceUsd) {
    profile.priceUsd = scan.token.priceUsd;
  }

  if (scan.token?.marketCapUsd) {
    profile.marketCapUsd = scan.token.marketCapUsd;
  }

  if (scan.token?.volume24hUsd) {
    profile.volume24hUsd = scan.token.volume24hUsd;
  }

  if (scan.token?.dexPaid !== null && scan.token?.dexPaid !== undefined) {
    profile.dexPaid = scan.token.dexPaid;
  }

  if (scan.token?.metadataUpdatedAt) {
    profile.metadataUpdatedAt = scan.token.metadataUpdatedAt.toISOString();
  }

  return profile;
}

function deriveOwnershipProfile(scan: ScanResultRecord): {
  ownerAddress?: `0x${string}`;
  ownershipStatus?: OwnershipStatus;
} {
  const ownershipResult = scan.detectorResults.find(
    (result) => result.detectorId === "ownership-status"
  );
  const check = ownershipResult?.checks[0];
  if (!check) {
    return {};
  }

  const evidence = toDetectorCheckEvidenceViews(check)[0];
  const owner = typeof evidence?.data.owner === "string" ? evidence.data.owner : null;
  const ownerAddress =
    owner && /^0x[a-fA-F0-9]{40}$/.test(owner)
      ? normalizeEvmAddress(owner as `0x${string}`)
      : undefined;

  if (check.code === "OWNERSHIP_RENOUNCED") {
    return {
      ...(ownerAddress ? { ownerAddress } : {}),
      ownershipStatus: "RENOUNCED"
    };
  }

  if (check.code === "OWNERSHIP_ACTIVE") {
    return {
      ...(ownerAddress ? { ownerAddress } : {}),
      ownershipStatus: "ACTIVE"
    };
  }

  if (check.code === "OWNER_READ_UNAVAILABLE") {
    return {
      ownershipStatus: "UNKNOWN"
    };
  }

  return {};
}

function toDetectorCheckViews(
  result: ScanResultRecord["detectorResults"][number]
): DetectorCheckView[] {
  return result.checks.map((check) => {
    const view: DetectorCheckView = {
      id: check.id,
      detectorResultId: result.id,
      detectorId: result.detectorId,
      detectorVersion: result.detectorVersion,
      code: check.code,
      outcome: check.outcome,
      confidence: check.confidence,
      evidence: toDetectorCheckEvidenceViews(check)
    };

    if (check.errorMessage) {
      view.errorMessage = check.errorMessage;
    }

    return view;
  });
}

function toDetectorCheckEvidenceViews(
  check: ScanResultRecord["detectorResults"][number]["checks"][number]
): FindingEvidenceView[] {
  const record = toRecord(check.evidence);
  const evidenceRows = Array.isArray(record.evidence) ? record.evidence : [];

  return evidenceRows
    .filter(
      (evidence): evidence is Record<string, unknown> =>
        typeof evidence === "object" && evidence !== null
    )
    .map((evidence) => {
      const data =
        typeof evidence.data === "object" && evidence.data !== null && !Array.isArray(evidence.data)
          ? (evidence.data as Record<string, unknown>)
          : {};
      const view: FindingEvidenceView = {
        type: isEvidenceType(evidence.type) ? evidence.type : "EXTERNAL_SOURCE",
        summary:
          typeof evidence.summary === "string" ? evidence.summary : "Detector check evidence",
        data
      };

      if (typeof evidence.blockNumber === "string") {
        view.blockNumber = evidence.blockNumber;
      }

      if (
        typeof evidence.transactionHash === "string" &&
        evidence.transactionHash.startsWith("0x")
      ) {
        view.transactionHash = evidence.transactionHash as `0x${string}`;
      }

      if (typeof evidence.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(evidence.address)) {
        view.address = normalizeEvmAddress(evidence.address as `0x${string}`);
      }

      return view;
    });
}

async function upsertTelegramChat(db: PrismaDatabase, chat: TelegramChatIdentity): Promise<void> {
  const createData: Prisma.TelegramChatCreateInput = {
    telegramChatId: chat.telegramChatId,
    type: chat.type
  };
  const updateData: Prisma.TelegramChatUpdateInput = {
    type: chat.type
  };

  if (chat.title) {
    createData.title = chat.title;
    updateData.title = chat.title;
  }

  await db.telegramChat.upsert({
    where: {
      telegramChatId: chat.telegramChatId
    },
    create: createData,
    update: updateData
  });
}

async function findTelegramWatchlist(db: PrismaDatabase, chat: TelegramChatIdentity) {
  await upsertTelegramChat(db, chat);

  return db.watchlist.findFirst({
    where: {
      name: telegramWatchlistName(chat.telegramChatId)
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function findOrCreateTelegramWatchlist(db: PrismaDatabase, chat: TelegramChatIdentity) {
  const existing = await findTelegramWatchlist(db, chat);
  if (existing) {
    return existing;
  }

  return db.watchlist.create({
    data: {
      name: telegramWatchlistName(chat.telegramChatId)
    }
  });
}

function telegramWatchlistName(telegramChatId: bigint): string {
  return `telegram:${telegramChatId.toString()}`;
}

function toTrackedTelegramAddress(item: {
  chainId: number;
  address: string;
  createdAt: Date;
}): TrackedTelegramAddress {
  return {
    chainId: item.chainId,
    address: item.address as `0x${string}`,
    createdAt: item.createdAt.toISOString()
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Exported so callers (e.g. the worker's deployer/bytecode-history lookup) can compute the
 * exact same hash `recordContractObservation` persists, without re-deriving the algorithm. */
export function hashBytecode(value: `0x${string}`): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashHex(value: `0x${string}`): string {
  return hashBytecode(value);
}

function firstCheckOutcome(result: DetectorResult): CheckOutcome | undefined {
  return result.checks[0]?.outcome;
}

async function findLatestTokenScan(
  db: PrismaDatabase,
  chainId: number,
  address: `0x${string}`
): Promise<ScanResultRecord | null> {
  return db.scan.findFirst({
    where: {
      chainId,
      targetAddress: normalizeEvmAddress(address)
    },
    include: scanResultInclude,
    orderBy: {
      queuedAt: "desc"
    }
  });
}

/**
 * The earliest scan ever recorded for this token (across every scan, not just completed ones —
 * a token that has only ever failed or been queued still has a real "first seen" moment). A
 * lightweight `select`-only query, not the full `scanResultInclude` join, since only the
 * timestamp is needed here.
 */
async function findFirstTokenScanTimestamp(
  db: PrismaDatabase,
  chainId: number,
  address: `0x${string}`
): Promise<Date | null> {
  const earliest = await db.scan.findFirst({
    where: {
      chainId,
      targetAddress: normalizeEvmAddress(address)
    },
    orderBy: {
      queuedAt: "asc"
    },
    select: {
      queuedAt: true,
      completedAt: true
    }
  });

  return earliest?.completedAt ?? earliest?.queuedAt ?? null;
}

type LiquidityPoolRecord = Awaited<ReturnType<typeof findLiquidityPools>>[number];
type HolderSnapshotRecord = Awaited<ReturnType<typeof findHolderSnapshots>>[number];

async function findLiquidityPools(db: PrismaDatabase, chainId: number, address: string) {
  return db.liquidityPool.findMany({
    where: {
      chainId,
      tokenAddress: normalizeEvmAddress(address as `0x${string}`)
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function findHolderSnapshots(db: PrismaDatabase, chainId: number, address: string) {
  return db.holderSnapshot.findMany({
    where: {
      chainId,
      tokenAddress: normalizeEvmAddress(address as `0x${string}`)
    },
    orderBy: {
      blockNumber: "desc"
    },
    take: 5
  });
}

function toSecurityFindingView(finding: ScanResultRecord["findings"][number]): SecurityFindingView {
  const view: SecurityFindingView = {
    id: finding.id,
    code: finding.code,
    detectorId: finding.detectorId,
    detectorVersion: finding.detectorVersion,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    confidence: finding.confidence,
    description: finding.description,
    technicalExplanation: finding.technicalExplanation,
    evidence: finding.evidence.map((evidence) => {
      const evidenceView = {
        type: evidence.type,
        summary: evidence.summary,
        data: toRecord(evidence.data)
      };

      return withOptionalEvidenceFields(evidenceView, evidence);
    })
  };

  if (finding.recommendation) {
    view.recommendation = finding.recommendation;
  }

  return view;
}

function toRiskSnapshot(scan: ScanResultRecord): RiskSnapshot {
  const findingCounts = createFindingCounts(scan.findings.map((finding) => finding.severity));

  if (scan.riskAssessment) {
    const unableToAssessReasons = scan.riskAssessment.unableToAssessReasons;
    return {
      chainId: scan.chainId,
      address: scan.targetAddress as `0x${string}`,
      scannerVersion: scan.riskAssessment.scannerVersion,
      status: scan.riskAssessment.score === null ? "UNABLE_TO_ASSESS" : "AVAILABLE",
      level:
        scan.riskAssessment.level === "UNABLE_TO_VERIFY"
          ? "UNABLE_TO_ASSESS"
          : scan.riskAssessment.level,
      score: scan.riskAssessment.score,
      confidence: scan.riskAssessment.confidence,
      categoryScores: scan.riskAssessment.categoryScores.map((categoryScore) => ({
        category: categoryScore.category,
        score: categoryScore.score,
        confidence: categoryScore.confidence,
        ...(categoryScore.explanation ? { explanation: categoryScore.explanation } : {})
      })),
      findingContributions: toFindingContributions(scan.riskAssessment.contributions),
      unableToAssessReasons,
      findingCounts,
      message:
        scan.riskAssessment.score === null
          ? unableToAssessReasons.length > 0
            ? `Overall risk scoring is not available yet: ${unableToAssessReasons.join("; ")}`
            : "Overall risk scoring is not available yet. Review persisted findings and evidence instead."
          : "Persisted risk assessment is available for this scan."
    };
  }

  return {
    chainId: scan.chainId,
    address: scan.targetAddress as `0x${string}`,
    scannerVersion: scan.scannerVersion,
    status: "UNABLE_TO_ASSESS",
    level: "UNABLE_TO_ASSESS",
    score: null,
    confidence: "LOW",
    categoryScores: [],
    findingContributions: [],
    unableToAssessReasons: ["No risk assessment has been recorded for this scan yet."],
    findingCounts,
    message:
      "Overall risk scoring is not available yet. Review persisted findings and evidence instead."
  };
}

function toLiquiditySummary(pools: LiquidityPoolRecord[]): LiquiditySummaryView {
  if (pools.length === 0) {
    return {
      status: "UNSUPPORTED",
      pools: [],
      message:
        "Liquidity discovery is not configured yet. No pool search was executed for this scan."
    };
  }

  return {
    status: "AVAILABLE",
    pools: pools.map(toLiquidityPoolView),
    message: "Persisted liquidity pools are available for this token."
  };
}

function toLiquidityPoolView(pool: LiquidityPoolRecord): LiquidityPoolView {
  const view: LiquidityPoolView = {
    chainId: pool.chainId,
    tokenAddress: pool.tokenAddress as `0x${string}`,
    poolAddress: pool.poolAddress as `0x${string}`
  };

  if (pool.dex) {
    view.dex = pool.dex;
  }

  if (pool.quoteTokenAddress) {
    view.quoteTokenAddress = pool.quoteTokenAddress as `0x${string}`;
  }

  if (pool.firstObservedBlock !== null) {
    view.firstObservedBlock = pool.firstObservedBlock.toString();
  }

  if (pool.lastObservedBlock !== null) {
    view.lastObservedBlock = pool.lastObservedBlock.toString();
  }

  if (pool.liquidityData) {
    view.liquidityData = toRecord(pool.liquidityData);
  }

  return view;
}

function toHolderSummary(snapshots: HolderSnapshotRecord[]): HolderSummaryView {
  if (snapshots.length === 0) {
    return {
      status: "UNSUPPORTED",
      snapshots: [],
      message:
        "Holder analysis is not configured yet. No holder snapshot was generated for this scan."
    };
  }

  return {
    status: "AVAILABLE",
    snapshots: snapshots.map(toHolderSnapshotView),
    message: "Persisted holder snapshots are available for this token."
  };
}

function toHolderSnapshotView(snapshot: HolderSnapshotRecord): HolderSnapshotView {
  const view: HolderSnapshotView = {
    chainId: snapshot.chainId,
    tokenAddress: snapshot.tokenAddress as `0x${string}`,
    blockNumber: snapshot.blockNumber.toString(),
    topHolders: toRecord(snapshot.topHolders),
    createdAt: snapshot.createdAt.toISOString()
  };

  if (snapshot.holderCount !== null) {
    view.holderCount = snapshot.holderCount;
  }

  if (snapshot.concentration) {
    view.concentration = toRecord(snapshot.concentration);
  }

  return view;
}

function toSimulationRunView(
  simulation: ScanResultRecord["simulationRuns"][number]
): SimulationRunView {
  const view: SimulationRunView = {
    id: simulation.id,
    kind: simulation.kind as SimulationRunView["kind"],
    outcome: simulation.outcome,
    input: toRecord(simulation.input),
    simulationTool: simulation.simulationTool,
    createdAt: simulation.createdAt.toISOString()
  };

  if (simulation.blockNumber !== null) {
    view.blockNumber = simulation.blockNumber.toString();
  }

  if (simulation.result) {
    view.result = toRecord(simulation.result);
  }

  if (simulation.revertReason) {
    view.revertReason = simulation.revertReason;
  }

  if (simulation.gasUsed !== null) {
    view.gasUsed = simulation.gasUsed.toString();
  }

  return view;
}

function createFindingCounts(severities: FindingSeverity[]): Record<FindingSeverity, number> {
  return {
    INFO: severities.filter((severity) => severity === "INFO").length,
    LOW: severities.filter((severity) => severity === "LOW").length,
    MEDIUM: severities.filter((severity) => severity === "MEDIUM").length,
    HIGH: severities.filter((severity) => severity === "HIGH").length,
    CRITICAL: severities.filter((severity) => severity === "CRITICAL").length
  };
}

function withOptionalEvidenceFields(
  evidenceView: {
    type: ScanResultRecord["findings"][number]["evidence"][number]["type"];
    summary: string;
    data: Record<string, unknown>;
  },
  evidence: ScanResultRecord["findings"][number]["evidence"][number]
) {
  const view = evidenceView as {
    type: ScanResultRecord["findings"][number]["evidence"][number]["type"];
    summary: string;
    data: Record<string, unknown>;
    blockNumber?: string;
    transactionHash?: `0x${string}`;
    address?: `0x${string}`;
  };

  if (evidence.blockNumber !== null) {
    view.blockNumber = evidence.blockNumber.toString();
  }

  if (evidence.transactionHash) {
    view.transactionHash = evidence.transactionHash as `0x${string}`;
  }

  if (evidence.address) {
    view.address = evidence.address as `0x${string}`;
  }

  return view;
}

function toFindingContributions(value: Prisma.JsonValue): FindingContribution[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): FindingContribution[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.code !== "string" ||
      typeof record.category !== "string" ||
      typeof record.severity !== "string" ||
      typeof record.confidence !== "string" ||
      typeof record.weight !== "number"
    ) {
      return [];
    }

    return [
      {
        code: record.code,
        category: record.category as FindingContribution["category"],
        severity: record.severity as FindingContribution["severity"],
        confidence: record.confidence as FindingContribution["confidence"],
        weight: record.weight
      }
    ];
  });
}

function toRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }

  return { value };
}

function isEvidenceType(value: unknown): value is FindingEvidenceView["type"] {
  return (
    value === "FUNCTION" ||
    value === "EVENT" ||
    value === "STORAGE" ||
    value === "BYTECODE" ||
    value === "TRANSACTION_TRACE" ||
    value === "SIMULATION" ||
    value === "HOLDER_DATA" ||
    value === "LIQUIDITY_DATA" ||
    value === "EXTERNAL_SOURCE"
  );
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  ) as Prisma.InputJsonValue;
}
