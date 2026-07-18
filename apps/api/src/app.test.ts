import { describe, expect, it } from "vitest";
import { loadEnv } from "@genesis-sentinel/config";
import type { ScanRepository } from "@genesis-sentinel/database";
import { createLogger } from "@genesis-sentinel/observability";
import type { RiskSnapshot, ScanProgress, ScanResultView } from "@genesis-sentinel/shared";
import { buildApp } from "./app.js";

describe("api foundation", () => {
  const scans = new Map<string, ScanProgress>();
  const createUnableRisk = (scan: ScanProgress): RiskSnapshot => ({
    chainId: scan.chainId,
    address: scan.address,
    scannerVersion: scan.scannerVersion,
    status: "UNABLE_TO_ASSESS",
    level: "UNABLE_TO_ASSESS",
    score: null,
    confidence: "LOW",
    categoryScores: [],
    findingCounts: {
      INFO: 0,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0
    },
    message:
      "Overall risk scoring is not available yet. Review persisted findings and evidence instead."
  });

  const scanRepository: ScanRepository = {
    async createOrGetQueuedScan(input: {
      id: string;
      chainId: number;
      address: `0x${string}`;
      idempotencyKeyHash: string;
    }) {
      await Promise.resolve();
      const existing = scans.get(input.id);
      if (existing) {
        return { scan: existing, created: false };
      }

      const scan: ScanProgress = {
        scanId: input.id,
        chainId: input.chainId,
        address: input.address,
        state: "QUEUED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-11T00:00:00.000Z",
        message: "Scan is queued. Queue orchestration and detectors are not implemented yet."
      };

      scans.set(input.id, scan);
      return { scan, created: true };
    },
    async getScan(scanId: string) {
      await Promise.resolve();
      return scans.get(scanId) ?? null;
    },
    async getScanResult(scanId: string): Promise<ScanResultView | null> {
      await Promise.resolve();
      const scan = scans.get(scanId);
      return scan
        ? {
            scan,
            token: {
              chainId: scan.chainId,
              address: scan.address
            },
            detectorChecks: [],
            findings: [],
            liquidity: {
              status: "UNSUPPORTED",
              pools: [],
              message: "Liquidity discovery is not configured yet."
            },
            holders: {
              status: "UNSUPPORTED",
              snapshots: [],
              message: "Holder analysis is not configured yet."
            },
            simulations: [],
            risk: createUnableRisk(scan)
          }
        : null;
    },
    async getTokenFindings() {
      await Promise.resolve();
      return [];
    },
    async getRiskSnapshot(_chainId: number, address: `0x${string}`) {
      await Promise.resolve();
      const scan = [...scans.values()].find((item) => item.address === address);
      return scan ? createUnableRisk(scan) : null;
    },
    async getScanTarget() {
      await Promise.resolve();
      return null;
    },
    async updateScanState() {
      await Promise.resolve();
    },
    async recordScanBlock() {
      await Promise.resolve();
    },
    async recordStage() {
      await Promise.resolve();
    },
    async recordContractObservation() {
      await Promise.resolve();
    },
    async recordTokenProfile() {
      await Promise.resolve();
    },
    async recordDetectorResult() {
      await Promise.resolve();
    },
    async recordRiskAssessment() {
      await Promise.resolve();
    },
    async recordSimulationRun() {
      await Promise.resolve();
    },
    async recordLiquidityPool() {
      await Promise.resolve();
    },
    async recordHolderSnapshot() {
      await Promise.resolve();
    }
  };
  const enqueuedScanIds: string[] = [];
  const scanQueue = {
    async enqueueScan(input: { scanId: string }) {
      await Promise.resolve();
      enqueuedScanIds.push(input.scanId);
      return { jobId: input.scanId };
    },
    async close() {
      await Promise.resolve();
    }
  };

  it("responds to health checks", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "api" });
  }, 10_000);

  it("accepts a valid foundation scan request without returning findings", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/scans",
      headers: { "idempotency-key": "test-key" },
      payload: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      chainId: 4663,
      state: "QUEUED",
      scannerVersion: "0.1.0-foundation"
    });
    expect(response.body).not.toContain("riskScore");
    expect(enqueuedScanIds).toContain(response.json<{ scanId: string }>().scanId);
  });

  it("returns existing scans for duplicate idempotency keys", async () => {
    enqueuedScanIds.length = 0;
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const request = {
      method: "POST" as const,
      url: "/v1/scans",
      headers: { "idempotency-key": "duplicate-key" },
      payload: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002"
      }
    };

    const first = await app.inject(request);
    const second = await app.inject(request);
    await app.close();

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json<{ scanId: string }>();
    expect(second.json()).toMatchObject({ scanId: firstBody.scanId });
    expect(enqueuedScanIds).toEqual([firstBody.scanId]);
  });

  it("returns persisted scan results without inventing a score", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/scans",
      headers: { "idempotency-key": "result-key" },
      payload: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000003"
      }
    });
    const scan = created.json<ScanProgress>();
    const response = await app.inject({
      method: "GET",
      url: `/v1/scans/${encodeURIComponent(scan.scanId)}/result`
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json<ScanResultView>().risk).toMatchObject({
      status: "UNABLE_TO_ASSESS",
      score: null
    });
  });

  it("returns quick risk for the latest token scan", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/risk/4663/0x0000000000000000000000000000000000000003"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json<RiskSnapshot>()).toMatchObject({
      level: "UNABLE_TO_ASSESS",
      score: null
    });
  });

  it("rejects Telegram webhooks with an invalid secret token", async () => {
    const app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        TELEGRAM_BOT_TOKEN: "123:test-token",
        TELEGRAM_WEBHOOK_SECRET: "expected-secret"
      }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue
    });

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong-secret"
      },
      payload: {}
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "telegram_webhook_unauthorized"
    });
  });
});
