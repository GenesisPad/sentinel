import { z } from "zod";
import { CHAIN_IDS } from "./chains";

export const chainIdSchema = z.enum(CHAIN_IDS as [string, ...string[]]);

export const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "warning",
  "failed",
  "inconclusive",
  "skipped",
  "unsupported"
]);

export const stageKeySchema = z.enum([
  "resolving_chain",
  "fetching_contract",
  "analyzing_contract",
  "discovering_markets",
  "analyzing_holders",
  "simulating_trades",
  "scoring"
]);

export const scanStageSchema = z.object({
  key: stageKeySchema,
  label: z.string(),
  status: stageStatusSchema,
  detail: z.string().optional()
});

export const findingSchema = z.object({
  id: z.string(),
  severity: severitySchema,
  title: z.string(),
  summary: z.string(),
  detail: z.string(),
  technical: z.string().optional(),
  affectedFunction: z.string().optional(),
  controller: z.string().optional(),
  block: z.number().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  recommendation: z.string().optional(),
  detectorId: z.string().optional(),
  detectorVersion: z.string().optional(),
  evidence: z.string().optional()
});

export const tokenMetaSchema = z.object({
  chainId: chainIdSchema,
  address: z.string(),
  // The API only surfaces name/symbol/decimals when ERC-20 metadata reads are incomplete
  // (evidence is attached to the resulting finding); when metadata is fully readable the
  // detector currently records a passed check without exposing the values publicly. Until
  // that's wired through, these stay nullable rather than showing fabricated values.
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  decimals: z.number().nullable(),
  verified: z.boolean().nullable(),
  totalSupply: z.string().optional(),
  holders: z.number().optional(),
  priceUsd: z.string().optional(),
  marketCapUsd: z.string().optional(),
  volume24hUsd: z.string().optional(),
  createdAt: z.string().optional(),
  deployer: z.string().optional(),
  creationTxHash: z.string().optional(),
  tokenType: z.string().optional(),
  iconUrl: z.string().optional(),
  reputation: z.string().optional(),
  ownerAddress: z.string().optional(),
  ownershipStatus: z.enum(["renounced", "active", "unknown"]).optional()
});

export const detectorCheckSchema = z.object({
  detectorId: z.string(),
  code: z.string(),
  outcome: z.enum(["detected", "passed", "unsupported", "failed", "inconclusive", "unavailable"]),
  confidence: z.enum(["low", "medium", "high"]).optional()
});

export const scanReportSchema = z.object({
  scanId: z.string(),
  status: z.enum(["queued", "running", "completed", "partial", "failed"]),
  token: tokenMetaSchema,
  // null when the backend risk assessment is UNABLE_TO_ASSESS (no numeric assessment available).
  riskScore: z.number().min(0).max(100).nullable(),
  scoreExplanation: z.string(),
  checks: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    passed: z.number()
  }),
  stages: z.array(scanStageSchema),
  findings: z.array(findingSchema),
  controls: z.object({
    ownershipRenounced: z.boolean().nullable(),
    canMint: z.boolean().nullable(),
    canBlacklist: z.boolean().nullable(),
    canPause: z.boolean().nullable(),
    canChangeTaxes: z.boolean().nullable(),
    isProxy: z.boolean().nullable(),
    upgradeable: z.boolean().nullable(),
    canLimitTransactions: z.boolean().nullable(),
    canDisableTrading: z.boolean().nullable(),
    hasFeeWhitelist: z.boolean().nullable()
  }),
  simulation: z.object({
    buyTaxBps: z.number().optional(),
    sellTaxBps: z.number().optional(),
    transferTaxBps: z.number().optional(),
    maxSellTaxBps: z.number().optional(),
    maxWalletBps: z.number().optional(),
    isHoneypot: z.boolean().nullable(),
    canBuy: z.boolean().nullable(),
    canSell: z.boolean().nullable(),
    results: z.array(
      z.object({
        label: z.string(),
        status: z.enum(["passed", "failed", "inconclusive"]),
        detail: z.string().optional()
      })
    )
  }),
  liquidity: z.object({
    totalUsd: z.number().nullable(),
    locked: z.boolean().nullable(),
    lockedUntil: z.string().optional(),
    deployerControlledPct: z.number().optional(),
    burnedPct: z.number().optional(),
    lockedPct: z.number().optional(),
    lpOwner: z.string().optional(),
    poolAddress: z.string().optional(),
    dex: z.string().optional()
  }),
  holders: z.object({
    // Holder-distribution discovery is an unsupported stub on the backend today
    // (packages/security-engine createUnsupportedHolderAnalysis) — no fake percentages.
    top1Pct: z.number().nullable(),
    top5Pct: z.number().nullable(),
    top10Pct: z.number().nullable(),
    holderCount: z.number().optional(),
    clusteredWithDeployer: z.number().optional(),
    devClusterPct: z.number().nullable().optional(),
    devClusterWalletCount: z.number().optional(),
    devClusterUnknownHoldingWalletCount: z.number().optional()
  }),
  devCluster: z.object({
    walletCount: z.number(),
    knownHoldingPct: z.number().nullable(),
    unknownHoldingWalletCount: z.number()
  }),
  scannerVersion: z.string(),
  block: z.number().nullable(),
  dataSource: z.string(),
  scannedAt: z.string(),
  cachedAt: z.string().optional(),
  incomplete: z.array(z.string()).optional(),
  detectorChecks: z.array(detectorCheckSchema)
});

export const scanJobSchema = z.object({
  scanId: z.string(),
  status: z.enum(["queued", "running", "completed", "partial", "failed"]),
  stages: z.array(scanStageSchema),
  token: tokenMetaSchema.partial().optional()
});

export const recentScanSchema = z.object({
  chainId: chainIdSchema,
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  riskScore: z.number(),
  scannedAt: z.string()
});

export const recentScansSchema = z.array(recentScanSchema);

export const createScanBodySchema = z.object({
  chainId: chainIdSchema.optional(),
  address: z.string(),
  fresh: z.boolean().optional()
});

export type ScanReportDTO = z.infer<typeof scanReportSchema>;
export type ScanJobDTO = z.infer<typeof scanJobSchema>;
