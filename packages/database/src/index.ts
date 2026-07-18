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
  type BytecodeReuseView,
  type CheckOutcome,
  type DeployerHistoryView,
  type DetectorCheckView,
  type FindingEvidenceView,
  type FindingSeverity,
  type HolderSnapshotView,
  type HolderSummaryView,
  type LiquidityPoolView,
  type LiquiditySummaryView,
  type RiskSnapshot,
  type ScanResultView,
  type ScanProgress,
  type ScanState,
  type ScanStageStatus,
  type TokenProfileView,
  type OwnershipStatus,
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

      return scan
        ? toScanResultView(
            scan,
            await findLiquidityPools(db, scan.chainId, scan.targetAddress),
            await findHolderSnapshots(db, scan.chainId, scan.targetAddress)
          )
        : null;
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

      const data: Prisma.RiskAssessmentUncheckedCreateInput = {
        scanId: input.scanId,
        score: input.assessment.score,
        level: input.assessment.level,
        confidence: input.assessment.confidence,
        scannerVersion: input.assessment.scannerVersion,
        scoringVersion: input.assessment.scoringVersion,
        explanation: input.assessment.explanation
      };
      const update: Prisma.RiskAssessmentUncheckedUpdateInput = {
        score: input.assessment.score,
        level: input.assessment.level,
        confidence: input.assessment.confidence,
        scannerVersion: input.assessment.scannerVersion,
        scoringVersion: input.assessment.scoringVersion,
        explanation: input.assessment.explanation
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
          confidence: categoryScore.confidence
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

export function toScanProgress(scan: Scan): ScanProgress {
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

  return progress;
}

export function toScanResultView(
  scan: ScanResultRecord,
  liquidityPools: LiquidityPoolRecord[] = [],
  holderSnapshots: HolderSnapshotRecord[] = []
): ScanResultView {
  return {
    scan: toScanProgress(scan),
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
    return {
      chainId: scan.chainId,
      address: scan.targetAddress as `0x${string}`,
      scannerVersion: scan.riskAssessment.scannerVersion,
      status: "AVAILABLE",
      level:
        scan.riskAssessment.level === "UNABLE_TO_VERIFY"
          ? "UNABLE_TO_ASSESS"
          : scan.riskAssessment.level,
      score: scan.riskAssessment.score,
      confidence: scan.riskAssessment.confidence,
      categoryScores: scan.riskAssessment.categoryScores.map((categoryScore) => ({
        category: categoryScore.category,
        score: categoryScore.score,
        confidence: categoryScore.confidence
      })),
      findingCounts,
      message: "Persisted risk assessment is available for this scan."
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

function toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  ) as Prisma.InputJsonValue;
}
