import { describe, expect, it } from "vitest";
import { loadEnv } from "@genesis-sentinel/config";
import type { ApiKeyRepository, ScanRepository } from "@genesis-sentinel/database";
import { createLogger } from "@genesis-sentinel/observability";
import type { MarketDataProvider } from "@genesis-sentinel/providers";
import type {
  ApiKeyView,
  ApiUsageKind,
  RiskSnapshot,
  ScanProgress,
  ScanResultView,
  TokenSecuritySummaryView
} from "@genesis-sentinel/shared";
import { buildApp, findExternalTokenChain } from "./app.js";

describe("findExternalTokenChain", () => {
  it("identifies a matching Ethereum token without treating it as a Robinhood wallet", async () => {
    const address = "0xc668695dcbcf682de106da94bde65c9bc79362d3" as const;
    const chain = await findExternalTokenChain(address, () =>
      Promise.resolve(
        Response.json({
          pairs: [{ chainId: "ethereum", baseToken: { address } }]
        })
      )
    );

    expect(chain).toBe("Ethereum");
  });

  it("does not classify a pair whose base token does not match the submitted address", async () => {
    const chain = await findExternalTokenChain(
      "0xc668695dcbcf682de106da94bde65c9bc79362d3",
      () =>
        Promise.resolve(
          Response.json({
            pairs: [
              {
                chainId: "ethereum",
                baseToken: { address: "0x0000000000000000000000000000000000000001" }
              }
            ]
          })
        )
    );

    expect(chain).toBeNull();
  });
});

function createInMemoryApiKeyRepository() {
  const keysByHash = new Map<string, string>();
  const recordsById = new Map<string, ApiKeyView>();
  const usageEvents: Array<{ apiKeyId: string | null; route: string; kind: ApiUsageKind }> = [];
  const auditEvents: Array<{ type: string; subject?: string }> = [];
  let nextId = 1;

  const repository: ApiKeyRepository = {
    async createApiKey(input) {
      await Promise.resolve();
      const id = `key-${nextId++}`;
      const record: ApiKeyView = {
        id,
        name: input.name,
        prefix: input.prefix,
        scopes: input.scopes,
        rateLimitPerMinute: input.rateLimitPerMinute,
        enabled: true,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null
      };
      keysByHash.set(input.keyHash, id);
      recordsById.set(id, record);
      return record;
    },
    async getApiKeyByHash(keyHash) {
      await Promise.resolve();
      const id = keysByHash.get(keyHash);
      return id ? (recordsById.get(id) ?? null) : null;
    },
    async touchApiKeyLastUsed(id) {
      await Promise.resolve();
      const record = recordsById.get(id);
      if (record) record.lastUsedAt = new Date().toISOString();
    },
    async revokeApiKey(id) {
      await Promise.resolve();
      const record = recordsById.get(id);
      if (!record) return null;
      record.revokedAt = new Date().toISOString();
      record.enabled = false;
      return record;
    },
    async recordApiUsage(input) {
      await Promise.resolve();
      usageEvents.push({ apiKeyId: input.apiKeyId, route: input.route, kind: input.kind });
    },
    async recordAuditEvent(input) {
      await Promise.resolve();
      auditEvents.push({ type: input.type, ...(input.subject ? { subject: input.subject } : {}) });
    }
  };

  return { repository, usageEvents, auditEvents };
}

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
    findingContributions: [],
    unableToAssessReasons: ["No detector findings were produced for this scan."],
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
    async getLatestScanResult(chainId: number, address: `0x${string}`) {
      await Promise.resolve();
      const scan = [...scans.values()]
        .reverse()
        .find((item) => item.chainId === chainId && item.address === address);
      return scan ? await this.getScanResult(scan.scanId) : null;
    },
    async getRecentScans() {
      await Promise.resolve();
      return [];
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
    },
    async getDeployerHistory(_chainId, deployerAddress) {
      await Promise.resolve();
      return {
        deployerAddress,
        previousTokenCount: 0,
        previousHighOrCriticalCount: 0,
        entries: []
      };
    },
    async getBytecodeReuse(_chainId, bytecodeHash) {
      await Promise.resolve();
      return { bytecodeHash, reusedByCount: 0, reusedByAddresses: [] };
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
  const marketDataProvider: MarketDataProvider = {
    id: "test-stub",
    supportsChain: () => true,
    async getMarketProfile() {
      await Promise.resolve();
      return null;
    }
  };

  it("responds to health checks", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      marketDataProvider
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
      scanQueue,
      marketDataProvider
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
      scanQueue,
      marketDataProvider
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
      scanQueue,
      marketDataProvider
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
      scanQueue,
      marketDataProvider
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
      scanQueue,
      marketDataProvider
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

  it("creates an API key, returning the plaintext key exactly once", async () => {
    const { repository } = createInMemoryApiKeyRepository();
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      apiKeyRepository: repository,
      marketDataProvider
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      payload: { name: "test integration" }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    const body = response.json<{ key: string; prefix: string; scopes: string[] }>();
    expect(body.key).toMatch(new RegExp(`^${body.prefix}_[a-f0-9]{48}$`));
    expect(body.scopes).toEqual(["scan:read"]);
    expect(response.body).not.toContain("keyHash");
  });

  it("requires the admin secret for custom API-key scopes or limits", async () => {
    const { repository } = createInMemoryApiKeyRepository();
    const app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        API_ADMIN_SECRET: "admin-secret-for-tests"
      }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      apiKeyRepository: repository,
      marketDataProvider
    });

    const publicWrite = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      payload: { name: "public write attempt", scopes: ["scan:read", "scan:write"] }
    });
    const publicCustomLimit = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      payload: { name: "public custom limit attempt", rateLimitPerMinute: 5_000 }
    });
    const adminCreated = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { "x-admin-secret": "admin-secret-for-tests" },
      payload: {
        name: "dexscreener-production-read",
        scopes: ["scan:read"],
        rateLimitPerMinute: 5_000
      }
    });
    await app.close();

    expect(publicWrite.statusCode).toBe(403);
    expect(publicCustomLimit.statusCode).toBe(403);
    expect(adminCreated.statusCode, adminCreated.body).toBe(201);
    expect(adminCreated.json<{ scopes: string[]; rateLimitPerMinute: number }>()).toMatchObject({
      scopes: ["scan:read"],
      rateLimitPerMinute: 5_000
    });
  });

  it("returns the presented key's own record via GET /v1/api-keys/me, and 401s with no key", async () => {
    const { repository } = createInMemoryApiKeyRepository();
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      apiKeyRepository: repository,
      marketDataProvider
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      payload: { name: "self-lookup test" }
    });
    const { key, id } = created.json<{ key: string; id: string }>();

    const me = await app.inject({
      method: "GET",
      url: "/v1/api-keys/me",
      headers: { authorization: `Bearer ${key}` }
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json<{ id: string; name: string }>();
    expect(meBody.id).toBe(id);
    expect(meBody.name).toBe("self-lookup test");
    expect(me.body).not.toContain("keyHash");

    const anonymous = await app.inject({ method: "GET", url: "/v1/api-keys/me" });
    await app.close();

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: "missing_api_key" });
  });

  it("authenticates a valid API key and rejects a revoked one", async () => {
    const { repository } = createInMemoryApiKeyRepository();
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      apiKeyRepository: repository,
      marketDataProvider
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      payload: { name: "revocation test" }
    });
    const { key, id } = created.json<{ key: string; id: string }>();

    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/risk/4663/0x0000000000000000000000000000000000000003",
      headers: { authorization: `Bearer ${key}` }
    });
    expect(authenticated.statusCode).toBe(200);

    const revoke = await app.inject({
      method: "DELETE",
      url: "/v1/api-keys/me",
      headers: { authorization: `Bearer ${key}` }
    });
    expect(revoke.statusCode).toBe(200);
    const revokedBody = revoke.json<{ id: string; revokedAt: string | null }>();
    expect(revokedBody.id).toBe(id);
    expect(typeof revokedBody.revokedAt).toBe("string");

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/v1/risk/4663/0x0000000000000000000000000000000000000003",
      headers: { authorization: `Bearer ${key}` }
    });
    await app.close();

    expect(afterRevoke.statusCode).toBe(401);
    expect(afterRevoke.json()).toMatchObject({ error: "invalid_api_key" });
  });

  it("rate-limits anonymous scan requests more strictly than a fresh API key", async () => {
    const { repository } = createInMemoryApiKeyRepository();
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      apiKeyRepository: repository,
      marketDataProvider
    });

    const attempt = (i: number) =>
      app.inject({
        method: "POST",
        url: "/v1/scans",
        headers: { "idempotency-key": `rate-limit-${i}-${Date.now()}` },
        payload: { chainId: 4663, address: `0x${"0".repeat(38)}ab` }
      });

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(await attempt(i));
    }
    await app.close();

    expect(responses.some((r) => r.statusCode === 429)).toBe(true);
  });

  it("exposes public token liquidity, security summary, holders, deployer, and simulations sub-resources without requiring an API key", async () => {
    const app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      logger: createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "api-test"),
      scanRepository,
      scanQueue,
      marketDataProvider
    });

    const address = "0x0000000000000000000000000000000000000009";
    await app.inject({
      method: "POST",
      url: "/v1/scans",
      headers: { "idempotency-key": "sub-resource-key" },
      payload: { chainId: 4663, address }
    });

    const [liquidity, securitySummary, holders, deployer, simulations] = await Promise.all([
      app.inject({ method: "GET", url: `/v1/tokens/4663/${address}/liquidity` }),
      app.inject({ method: "GET", url: `/v1/tokens/4663/${address}/security-summary` }),
      app.inject({ method: "GET", url: `/v1/tokens/4663/${address}/holders` }),
      app.inject({ method: "GET", url: `/v1/tokens/4663/${address}/deployer` }),
      app.inject({ method: "GET", url: `/v1/tokens/4663/${address}/simulations` })
    ]);
    await app.close();

    expect(liquidity.statusCode).toBe(200);
    expect(securitySummary.statusCode, securitySummary.body).toBe(200);
    const summary = securitySummary.json<TokenSecuritySummaryView>();
    expect(summary.product).toBe("Genesis Sentinel");
    expect(summary.fullAnalysisUrl).toBe(`https://sentinel.genesispad.app/token/4663/${address}`);
    expect(summary.devCluster).toMatchObject({
      walletCount: 0,
      knownHoldingPct: null,
      unknownHoldingWalletCount: 0,
      wallets: []
    });
    expect(summary.taxes).toMatchObject({
      status: "UNKNOWN",
      buyTaxBps: null,
      buyTaxPct: null,
      sellTaxBps: null,
      sellTaxPct: null
    });
    expect(summary.signals).toContainEqual(
      expect.objectContaining({ id: "honeypot", label: "Honeypot", answer: "UNKNOWN" })
    );
    expect(securitySummary.body).not.toContain(["Quick", "Intel"].join(" "));
    expect(holders.statusCode).toBe(200);
    expect(simulations.statusCode).toBe(200);
    expect(simulations.json()).toHaveProperty("simulations");
    // This fixture's scan never resolved a deployer address, so 404 is the honest response.
    expect(deployer.statusCode).toBe(404);
  });
});
