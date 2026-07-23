import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { AppEnv } from "@genesis-sentinel/config";
import {
  checkPostgres,
  createApiKeyRepository,
  createPrismaClient,
  createScanRepository,
  createTelegramTrackingRepository,
  type ApiKeyRepository,
  type ScanRepository
} from "@genesis-sentinel/database";
import type { Logger } from "pino";
import { checkRedis, createScanQueue, type ScanQueue } from "@genesis-sentinel/queue";
import {
  buildTokenSecuritySummary,
  createHealth,
  normalizeEvmAddress,
  scannerVersion,
  type ApiKeyView,
  type ApiUsageKind,
  type ScanEvent,
  type ScanEventType,
  type ScanState,
  type ServiceReadiness
} from "@genesis-sentinel/shared";
import { extractApiKey, generateApiKey, hashApiKey } from "./auth.js";
import { createRateLimiter } from "./rate-limiter.js";
import { submitScanRequest } from "./scan-service.js";
import {
  createTelegramBot,
  createTelegramScanLimiter,
  type TelegramListTrackedAddresses,
  type TelegramTrackAddress,
  type TelegramUntrackAddress
} from "./telegram.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the API-key auth hook when a valid, non-revoked key is presented.
     * Undefined when no key was presented at all (anonymous request is still allowed). */
    apiKey?: ApiKeyView;
  }
}

function analyticsVisitorHash(ip: string, secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  return `web:${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 24)}`;
}

const evmAddressSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  "Expected a checksummed or lowercase EVM address"
);

const createScanSchema = z.object({
  chainId: z.literal(4663),
  address: evmAddressSchema
});

const tokenParamsSchema = z.object({
  chainId: z.coerce.number().pipe(z.literal(4663)),
  address: evmAddressSchema
});

const recentScansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(["scan:read", "scan:write"])).nonempty().optional(),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000).optional()
});

/** Anonymous (no API key) requests to POST /v1/scans get a stricter shared limit than a
 * freshly-created key's default `rateLimitPerMinute` (60) — API-key creation is itself free and
 * unauthenticated, so this is the only real backstop against anonymous scan-spam. */
const ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface AppOptions {
  env: AppEnv;
  logger: Logger;
  scanRepository?: ScanRepository;
  scanQueue?: ScanQueue;
  apiKeyRepository?: ApiKeyRepository;
}

export async function buildApp({ env, logger, scanRepository, scanQueue, apiKeyRepository }: AppOptions) {
  const prisma = scanRepository ? undefined : createPrismaClient(env.DATABASE_URL);
  const scans = scanRepository ?? createScanRepository(prisma!);
  const telegramTracking = prisma ? createTelegramTrackingRepository(prisma) : null;
  const apiKeys = apiKeyRepository ?? (prisma ? createApiKeyRepository(prisma) : null);
  const queue = scanQueue ?? createScanQueue(env.REDIS_URL);
  const scanRateLimiter = createRateLimiter(RATE_LIMIT_WINDOW_MS);
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 16 * 1024,
    routerOptions: {
      maxParamLength: 256
    },
    trustProxy: true
  });

  const corsOrigin =
    env.API_CORS_ORIGIN === "*"
      ? true
      : env.API_CORS_ORIGIN.split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  await app.register(cors, {
    origin: corsOrigin,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["content-type", "authorization", "x-api-key", "x-admin-secret", "idempotency-key"]
  });

  await app.register(rateLimit, {
    hook: "preHandler",
    max: (request) => Math.max(env.API_RATE_LIMIT_MAX, request.apiKey?.rateLimitPerMinute ?? 0),
    keyGenerator: (request) => request.apiKey?.id ?? request.ip,
    timeWindow: env.API_RATE_LIMIT_TIME_WINDOW
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Genesis Sentinel API",
        version: scannerVersion
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs"
  });

  // API-key auth is optional (anonymous requests are allowed, per the anonymous-scan-limit
  // requirement) but a *presented* key must be valid — an unknown, disabled, or revoked key is
  // rejected outright rather than silently treated as anonymous.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);

    if (!apiKeys) return;
    const presentedKey = extractApiKey(request.headers);
    if (!presentedKey) return;

    const record = await apiKeys.getApiKeyByHash(hashApiKey(presentedKey));
    if (!record || !record.enabled || record.revokedAt) {
      return reply.code(401).send({
        error: "invalid_api_key",
        message: "The provided API key is unknown, disabled, or revoked."
      });
    }

    request.apiKey = record;
    await apiKeys.touchApiKeyLastUsed(record.id).catch(() => undefined);
  });

  // Usage accounting (Milestone 8): every request is classified into the spec's usage
  // categories and persisted, independent of whether it succeeded. Best-effort — a logging
  // failure never affects the response already sent.
  app.addHook("onResponse", async (request, reply) => {
    if (!apiKeys) return;

    const route = request.routeOptions?.url ?? request.url;
    const status = reply.statusCode;
    const kind: ApiUsageKind =
      status === 429
        ? "RATE_LIMIT_EVENT"
        : status >= 400
          ? "FAILED_REQUEST"
          : route === "/v1/scans" && request.method === "POST"
            ? status === 202
              ? "FRESH_SCAN"
              : "CACHED_LOOKUP"
            : route.endsWith("/simulations")
              ? "DEEP_SIMULATION"
              : "CACHED_LOOKUP";

    await apiKeys
      .recordApiUsage({
        apiKeyId: request.apiKey?.id ?? null,
        route,
        method: request.method,
        status,
        kind
      })
      .catch(() => undefined);
  });

  const submitScan = async (input: {
    chainId: 4663;
    address: `0x${string}`;
    idempotencyKey: string;
    requestedBy?: string;
  }) => {
    const result = await submitScanRequest(input, { scans, queue });
    return result.scan;
  };

  const telegramBot = env.TELEGRAM_BOT_TOKEN
    ? createTelegramBot({
        token: env.TELEGRAM_BOT_TOKEN,
        webAppUrl: env.WEB_PUBLIC_APP_URL,
        submitScan,
        getScan: (scanId) => scans.getScan(scanId),
        getScanResult: (scanId) => scans.getScanResult(scanId),
        ...(telegramTracking
          ? {
              trackAddress: ((input) => telegramTracking.trackAddress(input)) satisfies TelegramTrackAddress,
              untrackAddress: ((input) =>
                telegramTracking.untrackAddress(input)) satisfies TelegramUntrackAddress,
              listTrackedAddresses: ((chat) =>
                telegramTracking.listTrackedAddresses(chat)) satisfies TelegramListTrackedAddresses
            }
          : {}),
        scanLimiter: createTelegramScanLimiter({
          cooldownMs: env.TELEGRAM_SCAN_COOLDOWN_SECONDS * 1_000,
          burstLimit: env.TELEGRAM_SCAN_BURST_LIMIT,
          burstWindowMs: env.TELEGRAM_SCAN_BURST_WINDOW_SECONDS * 1_000
        }),
        groupScanLimiter: createTelegramScanLimiter({
          cooldownMs: 0,
          burstLimit: env.TELEGRAM_GROUP_SCAN_BURST_LIMIT,
          burstWindowMs: env.TELEGRAM_GROUP_SCAN_BURST_WINDOW_SECONDS * 1_000
        })
      })
    : null;
  let telegramBotInit: Promise<void> | null = null;

  const ensureTelegramBotInitialized = async () => {
    if (!telegramBot) {
      return;
    }

    telegramBotInit ??= telegramBot.init();
    await telegramBotInit;
  };

  const isAdminRequest = (request: { headers: Record<string, string | string[] | undefined> }) => {
    const presented = request.headers["x-admin-secret"];
    const secret = Array.isArray(presented) ? presented[0] : presented;
    return Boolean(env.API_ADMIN_SECRET && secret === env.API_ADMIN_SECRET);
  };

  app.get("/health", () => createHealth("api"));

  app.get("/ready", async (_request, reply) => {
    const dependencies = await Promise.all([
      checkPostgres(env.DATABASE_URL),
      checkRedis(env.REDIS_URL)
    ]);
    const ready = dependencies.every((dependency) => dependency.status === "ok");
    const response: ServiceReadiness = {
      status: ready ? "ready" : "not_ready",
      service: "api",
      version: scannerVersion,
      time: new Date().toISOString(),
      dependencies
    };

    return reply.code(ready ? 200 : 503).send(response);
  });

  app.post(
    "/v1/scans",
    {
      schema: {
        description:
          "Create or resolve a scan for a token. Without an Idempotency-Key header, requests for " +
          "the same token resolve to the token's most recent scan (200) rather than always queuing " +
          "a new one (202) — pass a unique Idempotency-Key, or use the Rerun action in the web app, " +
          "to force a fresh scan.",
        tags: ["scans"],
        body: {
          type: "object",
          required: ["chainId", "address"],
          properties: {
            chainId: { type: "integer", enum: [4663], description: "Robinhood Chain ID." },
            address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
          }
        },
        response: {
          200: { description: "An existing scan was resolved (not newly queued).", type: "object", additionalProperties: true },
          202: { description: "A new scan was queued.", type: "object", additionalProperties: true },
          400: { description: "Invalid chain ID or address.", type: "object", additionalProperties: true },
          403: { description: "The presented API key lacks the scan:write scope.", type: "object", additionalProperties: true },
          429: { description: "Rate limit exceeded (per-key, or anonymous by IP).", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    // Scope check: only applies to authenticated requests. Anonymous requests may still create
    // scans (subject to the stricter anonymous rate limit below) — a presented key just has to
    // actually be authorized for scan:write, not merely valid.
    if (request.apiKey && !request.apiKey.scopes.includes("scan:write")) {
      return reply.code(403).send({
        error: "insufficient_scope",
        message: "This API key does not have the scan:write scope required to create scans."
      });
    }

    const rateLimitKey = request.apiKey?.id ?? `anon:${request.ip}`;
    const rateLimitMax = request.apiKey?.rateLimitPerMinute ?? ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE;
    const rateLimitResult = scanRateLimiter.check(rateLimitKey, rateLimitMax);
    if (!rateLimitResult.allowed) {
      return reply
        .code(429)
        .header("retry-after", rateLimitResult.retryAfterSeconds ?? 60)
        .send({
          error: "rate_limited",
          message: request.apiKey
            ? "This API key has exceeded its configured scan rate limit."
            : "Anonymous scan requests are rate-limited. Create an API key for a higher limit.",
          retryAfterSeconds: rateLimitResult.retryAfterSeconds
        });
    }

    const parsed = createScanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_scan_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await submitScanRequest(
      {
        chainId: parsed.data.chainId,
        address: normalizeEvmAddress(parsed.data.address),
        idempotencyKey:
          request.headers["idempotency-key"]?.toString() ??
          `${parsed.data.chainId}:${parsed.data.address.toLowerCase()}`
      },
      { scans, queue }
    );

    return reply.code(result.created ? 202 : 200).send(result.scan);
    }
  );

  app.get(
    "/v1/scans/recent",
    {
      schema: {
        description: "The public \"recent detections\" feed — most recent scan per token, newest first.",
        tags: ["scans"],
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }
        },
        response: {
          200: { description: "Recent scans, newest first.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request) => {
      const parsed = recentScansQuerySchema.safeParse(request.query);
      const limit = parsed.success ? parsed.data.limit : 20;
      return { scans: await scans.getRecentScans(limit) };
    }
  );

  app.get("/v1/analytics", async (_request, reply) => {
    if (!scans.getPublicAnalytics) {
      return reply.code(503).send({ error: "analytics_unavailable", message: "Analytics are temporarily unavailable." });
    }
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return scans.getPublicAnalytics();
  });

  app.post("/v1/analytics/visit", async (request, reply) => {
    const visitorHash = analyticsVisitorHash(request.ip, env.API_ADMIN_SECRET);
    if (visitorHash && scans.recordAnalyticsVisit) await scans.recordAnalyticsVisit(visitorHash);
    return reply.code(204).send();
  });

  app.get(
    "/v1/scans/:scanId",
    {
      schema: {
        description: "Poll a scan's current lifecycle state and stage progress. Full fallback for clients not using the SSE events endpoint.",
        tags: ["scans"],
        response: {
          200: { description: "The scan's current state.", type: "object", additionalProperties: true },
          404: { description: "No scan exists for that scan ID.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    const scanId = (request.params as { scanId?: string }).scanId;
    const scan = scanId ? await scans.getScan(scanId) : undefined;

    if (!scan) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan exists for that foundation scan ID."
      });
    }

      return scan;
    }
  );

  app.get(
    "/v1/scans/:scanId/result",
    {
      schema: {
        description: "The persisted scan result: findings, liquidity, holders, simulations, and risk, whatever the scan has reached so far.",
        tags: ["scans"],
        response: {
          200: { description: "The scan's persisted result.", type: "object", additionalProperties: true },
          404: { description: "No scan result exists for that scan ID.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    const scanId = (request.params as { scanId?: string }).scanId;
    const scan = scanId ? await scans.getScanResult(scanId) : undefined;

    if (!scan) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan result exists for that scan ID."
      });
    }

      return scan;
    }
  );

  // Server-Sent Events for scan progress, with polling (GET /v1/scans/:scanId) as a full
  // fallback for clients that can't hold a streaming connection. Event types are derived from
  // the scan's overall ScanState transitions — the only granularity actually persisted; a true
  // per-check "inconclusive" event would need finer-grained state than a scan's top-level
  // ScanState carries, so `scan.stage.inconclusive` is defined but never emitted here.
  app.get(
    "/v1/scans/:scanId/events",
    {
      schema: {
        description:
          "Server-Sent Events stream of scan lifecycle transitions (scan.queued, scan.started, " +
          "scan.stage.started/completed, scan.completed/partial/failed). Polling GET " +
          "/v1/scans/:scanId is a complete fallback for clients that can't hold a streaming connection.",
        tags: ["scans"],
        produces: ["text/event-stream"],
        response: {
          404: { description: "No scan exists for that scan ID.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    const scanId = (request.params as { scanId?: string }).scanId;
    const initial = scanId ? await scans.getScan(scanId) : undefined;
    if (!scanId || !initial) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan exists for that foundation scan ID."
      });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });

    const send = (type: ScanEventType, data: Record<string, unknown>) => {
      const event: ScanEvent = { type, scanId, data, emittedAt: new Date().toISOString() };
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const terminalStates = new Set<ScanState>(["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"]);
    let lastState: ScanState | null = null;

    const emitTransition = (state: ScanState) => {
      if (lastState === null) {
        send(state === "QUEUED" ? "scan.queued" : "scan.stage.started", { state });
      } else {
        if (lastState === "QUEUED") send("scan.started", { state });
        send("scan.stage.completed", { state: lastState });
        if (!terminalStates.has(state)) send("scan.stage.started", { state });
      }

      if (state === "COMPLETED") send("scan.completed", { state });
      else if (state === "PARTIALLY_COMPLETED") send("scan.partial", { state });
      else if (state === "FAILED") send("scan.failed", { state });

      lastState = state;
    };

    let closed = false;
    request.raw.on("close", () => {
      closed = true;
      clearInterval(interval);
    });

    emitTransition(initial.state);
    const poll = async () => {
      if (closed) return;
      const scan = await scans.getScan(scanId).catch(() => null);
      if (!scan) return;
      if (scan.state !== lastState) emitTransition(scan.state);
      if (terminalStates.has(scan.state)) {
        clearInterval(interval);
        reply.raw.end();
      }
    };
    const interval = setInterval(() => {
      void poll();
    }, 1_500);

      if (terminalStates.has(initial.state)) {
        clearInterval(interval);
        reply.raw.end();
      }
    }
  );

  const tokenParamsJsonSchema = {
    type: "object",
    required: ["chainId", "address"],
    properties: {
      chainId: { type: "integer", enum: [4663], description: "Robinhood Chain ID." },
      address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
    }
  } as const;
  const tokenNotFoundResponses = {
    400: { description: "Invalid chain ID or address.", type: "object", additionalProperties: true },
    404: { description: "No scan has been run for this token yet.", type: "object", additionalProperties: true }
  } as const;

  app.get(
    "/v1/tokens/:chainId/:address",
    {
      schema: {
        description: "A token's latest persisted scan result: findings, liquidity, holders, simulations, and risk.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: { 200: { description: "The token's latest scan result.", type: "object", additionalProperties: true }, ...tokenNotFoundResponses }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
    if (!result) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan has been run for this token yet."
      });
    }

      return result;
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/liquidity",
    {
      schema: {
        description: "The liquidity-discovery slice of a token's latest scan: discovered pools, reserves, and lock/burn status.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: { 200: { description: "Liquidity summary.", type: "object", additionalProperties: true }, ...tokenNotFoundResponses }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
    if (!result) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan has been run for this token yet."
      });
    }

      return result.liquidity;
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/security-summary",
    {
      schema: {
        description:
          "A partner-friendly Genesis Sentinel security summary for a token's latest scan, using plain-language Yes/No/Unknown signals.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: { description: "Plain-language token security summary.", type: "object", additionalProperties: true },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
        });
      }

      const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
      if (!result) {
        return reply.code(404).send({
          error: "scan_not_found",
          message: "No scan has been run for this token yet."
        });
      }

      return buildTokenSecuritySummary(result, { webAppUrl: env.WEB_PUBLIC_APP_URL });
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/holders",
    {
      schema: {
        description: "The holder-concentration slice of a token's latest scan: top-holder percentages and related-wallet clustering.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: { 200: { description: "Holder concentration summary.", type: "object", additionalProperties: true }, ...tokenNotFoundResponses }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
    if (!result) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan has been run for this token yet."
      });
    }

      return result.holders;
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/deployer",
    {
      schema: {
        description:
          "The resolved deployer address for a token plus its deployer-history evidence (other tokens by the same " +
          "deployer, prior high/critical outcomes) drawn only from Sentinel's own persisted scan history.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: { description: "Deployer address and history.", type: "object", additionalProperties: true },
          ...tokenNotFoundResponses,
          404: { description: "No scan, or no deployer address resolved yet, for this token.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
    if (!result) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan has been run for this token yet."
      });
    }

    if (!result.token.deployerAddress) {
      return reply.code(404).send({
        error: "deployer_not_found",
        message: "No deployer address has been resolved for this token yet."
      });
    }

    const history = await scans
      .getDeployerHistory(parsed.data.chainId, result.token.deployerAddress, parsed.data.address)
      .catch(() => null);

      return {
        chainId: parsed.data.chainId,
        address: normalizeEvmAddress(parsed.data.address),
        deployerAddress: result.token.deployerAddress,
        history
      };
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/simulations",
    {
      schema: {
        description: "The buy/sell/transfer trade-simulation results from a token's latest scan.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: { 200: { description: "Simulation runs.", type: "object", additionalProperties: true }, ...tokenNotFoundResponses }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
    if (!result) {
      return reply.code(404).send({
        error: "scan_not_found",
        message: "No scan has been run for this token yet."
      });
    }

      return { simulations: result.simulations };
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/findings",
    {
      schema: {
        description: "All persisted security findings for a token's latest scan, most serious first.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: { description: "Findings list.", type: "object", additionalProperties: true },
          400: { description: "Invalid chain ID or address.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_token_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

      return {
        chainId: parsed.data.chainId,
        address: normalizeEvmAddress(parsed.data.address),
        findings: await scans.getTokenFindings(parsed.data.chainId, parsed.data.address)
      };
    }
  );

  app.get(
    "/v1/risk/:chainId/:address",
    {
      schema: {
        description:
          "The persisted, canonical risk assessment for a token's latest scan. Never recomputed on the fly.",
        tags: ["risk"],
        response: {
          200: {
            description: "A risk snapshot. `status`/`score` vary by scan outcome.",
            type: "object",
            additionalProperties: true,
            examples: [
              {
                summary: "Completed, high-risk scan",
                value: {
                  chainId: 4663,
                  address: "0x0000000000000000000000000000000000000001",
                  status: "AVAILABLE",
                  level: "HIGH",
                  score: 68,
                  confidence: "HIGH",
                  message: "Persisted risk assessment is available for this scan."
                }
              },
              {
                summary: "Completed, low-risk scan",
                value: {
                  chainId: 4663,
                  address: "0x0000000000000000000000000000000000000002",
                  status: "AVAILABLE",
                  level: "LOW",
                  score: 8,
                  confidence: "HIGH",
                  message: "Persisted risk assessment is available for this scan."
                }
              },
              {
                summary: "Partial scan (some stages incomplete)",
                value: {
                  chainId: 4663,
                  address: "0x0000000000000000000000000000000000000003",
                  status: "AVAILABLE",
                  level: "ELEVATED",
                  score: 42,
                  confidence: "MEDIUM",
                  message: "Persisted risk assessment is available for this scan."
                }
              },
              {
                summary: "Unable to assess (no scoreable findings yet)",
                value: {
                  chainId: 4663,
                  address: "0x0000000000000000000000000000000000000004",
                  status: "UNABLE_TO_ASSESS",
                  level: "UNABLE_TO_ASSESS",
                  score: null,
                  confidence: "LOW",
                  message: "No detector findings were produced for this scan."
                }
              }
            ]
          },
          400: {
            description: "Invalid chain ID or address.",
            type: "object",
            additionalProperties: true
          },
          404: {
            description: "No scan exists for this token yet.",
            type: "object",
            additionalProperties: true
          }
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_risk_request",
        message: "Provide Robinhood Chain ID 4663 and a valid EVM contract address."
      });
    }

    const risk = await scans.getRiskSnapshot(parsed.data.chainId, parsed.data.address);
    if (!risk) {
      return reply.code(404).send({
        error: "risk_not_found",
        message: "No scan exists for that token address yet."
      });
    }

      return risk;
    }
  );

  // API-key self-service: creation is unauthenticated (anyone can request a key, same as most
  // public developer APIs) but shares the anonymous rate limiter to bound abuse. The plaintext
  // key is returned exactly once, in this response, and is never recoverable afterward — only
  // its hash is stored.
  app.post(
    "/v1/api-keys",
    {
      schema: {
        description:
          "Create a new API key. The plaintext key is returned exactly once, in this response, and " +
          "can never be recovered afterward — only its hash is stored. Unauthenticated but rate-limited " +
          "by IP (shares the anonymous-scan limiter) to bound abuse.",
        tags: ["api-keys"],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            scopes: { type: "array", items: { type: "string", enum: ["scan:read", "scan:write"] } },
            rateLimitPerMinute: {
              type: "integer",
              minimum: 1,
              maximum: 100000,
              description: "Admin-only. Custom per-key read/global limit and scan-write limit."
            }
          }
        },
        response: {
          201: {
            description: "The created key, including the plaintext `key` field (shown only this once).",
            type: "object",
            additionalProperties: true
          },
          400: { description: "Missing or invalid name/scopes.", type: "object", additionalProperties: true },
          403: { description: "Custom scopes or limits require the admin secret.", type: "object", additionalProperties: true },
          429: { description: "Too many key-creation requests from this address.", type: "object", additionalProperties: true },
          503: { description: "API key management is not configured on this instance.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    if (!apiKeys) {
      return reply.code(503).send({
        error: "api_keys_not_configured",
        message: "API key management is not available on this instance."
      });
    }

    const rateLimitResult = scanRateLimiter.check(`anon:${request.ip}`, ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE);
    if (!rateLimitResult.allowed) {
      return reply.code(429).send({
        error: "rate_limited",
        message: "Too many API key creation requests from this address.",
        retryAfterSeconds: rateLimitResult.retryAfterSeconds
      });
    }

    const parsed = createApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_api_key_request",
        message: "Provide a name (1-100 characters) and optionally a list of scopes."
      });
    }

    const requestedScopes = parsed.data.scopes ?? ["scan:read"];
    const requestedCustomLimit = parsed.data.rateLimitPerMinute;
    const admin = isAdminRequest(request);
    const requiresAdmin =
      requestedScopes.some((scope) => scope !== "scan:read") || requestedCustomLimit !== undefined;
    if (requiresAdmin && !admin) {
      return reply.code(403).send({
        error: "admin_required",
        message:
          "Custom API-key scopes or rate limits require X-Admin-Secret. Public key creation only issues scan:read keys at the default limit."
      });
    }

    const generated = generateApiKey();
    const created = await apiKeys.createApiKey({
      name: parsed.data.name,
      keyHash: generated.hash,
      prefix: generated.prefix,
      scopes: requestedScopes,
      rateLimitPerMinute: requestedCustomLimit ?? 60
    });
    await apiKeys
      .recordAuditEvent({
        type: "api_key.created",
        subject: created.id,
        metadata: {
          name: created.name,
          prefix: created.prefix,
          scopes: created.scopes,
          rateLimitPerMinute: created.rateLimitPerMinute,
          createdBy: admin ? "admin" : "public"
        }
      })
      .catch(() => undefined);

      return reply.code(201).send({ ...created, key: generated.plaintext });
    }
  );

  // Self-lookup only, same constraint as DELETE below: there is no account/ownership model, so
  // a key can only read its own record via the presented key, never list or look up another.
  app.get(
    "/v1/api-keys/me",
    {
      schema: {
        description: "The presented API key's own record: name, prefix, scopes, rate limit, and usage timestamps. Never returns the hash or plaintext.",
        tags: ["api-keys"],
        response: {
          200: { description: "The presented key's record.", type: "object", additionalProperties: true },
          401: { description: "No API key was presented.", type: "object", additionalProperties: true },
          503: { description: "API key management is not configured on this instance.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    if (!apiKeys) {
      return reply.code(503).send({
        error: "api_keys_not_configured",
        message: "API key management is not available on this instance."
      });
    }

    if (!request.apiKey) {
      return reply.code(401).send({
        error: "missing_api_key",
        message: "Provide the API key to look up via Authorization: Bearer <key> or X-API-Key."
      });
    }

      return request.apiKey;
    }
  );

  // Self-revocation only — a key revokes itself, since there is no separate account/ownership
  // model yet to authorize revoking a *different* key.
  app.delete(
    "/v1/api-keys/me",
    {
      schema: {
        description: "Revoke the presented API key. There is no ownership model yet, so a key can only revoke itself.",
        tags: ["api-keys"],
        response: {
          200: { description: "The revoked key's record, with revokedAt set.", type: "object", additionalProperties: true },
          401: { description: "No API key was presented.", type: "object", additionalProperties: true },
          503: { description: "API key management is not configured on this instance.", type: "object", additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
    if (!apiKeys) {
      return reply.code(503).send({
        error: "api_keys_not_configured",
        message: "API key management is not available on this instance."
      });
    }

    if (!request.apiKey) {
      return reply.code(401).send({
        error: "missing_api_key",
        message: "Provide the API key to revoke via Authorization: Bearer <key> or X-API-Key."
      });
    }

    const revoked = await apiKeys.revokeApiKey(request.apiKey.id);
    await apiKeys
      .recordAuditEvent({ type: "api_key.revoked", subject: request.apiKey.id })
      .catch(() => undefined);

      return revoked;
    }
  );

  app.post("/telegram/webhook", async (request, reply) => {
    if (!telegramBot) {
      return reply.code(404).send({
        error: "telegram_not_configured",
        message: "Telegram bot token is not configured for this API instance."
      });
    }

    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
      if (providedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({
          error: "telegram_webhook_unauthorized",
          message: "Telegram webhook secret token is invalid."
        });
      }
    }

    await ensureTelegramBotInitialized();
    await telegramBot.handleUpdate(request.body as Parameters<typeof telegramBot.handleUpdate>[0]);
    return { ok: true };
  });

  app.addHook("onClose", async () => {
    await queue.close();
    await prisma?.$disconnect();
  });

  return app;
}
