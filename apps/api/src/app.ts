import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  createRobinhoodChainAdapter,
  createArcChainAdapter,
  createStableChainAdapter
} from "@genesis-sentinel/chain-adapters";
import type { AppEnv } from "@genesis-sentinel/config";
import {
  checkPostgres,
  createApiKeyRepository,
  createPrismaClient,
  createScanRepository,
  createTelegramGroupAlertMediaRepository,
  createTelegramTrackingRepository,
  type ApiKeyRepository,
  type ScanRepository
} from "@genesis-sentinel/database";
import type { Logger } from "pino";
import { getProviderSet, type MarketDataProvider } from "@genesis-sentinel/providers";
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
import { createMarketRefresher } from "./market-refresh.js";
import { createRateLimiter } from "./rate-limiter.js";
import { submitScanRequest } from "./scan-service.js";
import {
  createTelegramBot,
  createTelegramScanLimiter,
  TELEGRAM_BOT_COMMANDS,
  type TelegramGetAdminAnalytics,
  type TelegramGetRegisteredUsers,
  type TelegramListTrackedAddresses,
  type TelegramRecordActivity,
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

const supportedChainId = z.union([z.literal(4663), z.literal(5042), z.literal(988)]);

const createScanSchema = z.object({
  chainId: supportedChainId.optional(),
  address: evmAddressSchema
});

const tokenParamsSchema = z.object({
  chainId: z.coerce.number().pipe(supportedChainId),
  address: evmAddressSchema
});

const recentScansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.enum(["scan:read", "scan:write"]))
    .nonempty()
    .optional(),
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
  /** Overrides the per-chain market data lookup used to refresh volatile fields on cached reads
   * — inject a stub in tests so they stay fast, deterministic, and offline rather than depending
   * on a real network call every time these routes are exercised. Defaults to the same chain
   * registry the worker's full scans use, so Robinhood, Arc, and Stable are all covered. */
  getMarketDataProvider?: (chainId: number) => MarketDataProvider | null;
}

export async function buildApp({
  env,
  logger,
  scanRepository,
  scanQueue,
  apiKeyRepository,
  getMarketDataProvider
}: AppOptions) {
  const prisma = scanRepository ? undefined : createPrismaClient(env.DATABASE_URL);
  const scans = scanRepository ?? createScanRepository(prisma!);
  const telegramTracking = prisma ? createTelegramTrackingRepository(prisma) : null;
  const telegramGroupAlertMedia = prisma
    ? createTelegramGroupAlertMediaRepository(prisma)
    : null;
  const recordTelegramActivity: TelegramRecordActivity | undefined = prisma
    ? async (input) => {
        await prisma.$transaction(async (transaction) => {
          if (input.userId) {
            await transaction.telegramUser.upsert({
              where: { telegramUserId: input.userId },
              create: {
                telegramUserId: input.userId,
                ...(input.username ? { username: input.username } : {})
              },
              update: input.username ? { username: input.username } : {}
            });
          }
          await transaction.telegramChat.upsert({
            where: { telegramChatId: input.chatId },
            create: { telegramChatId: input.chatId, type: input.chatType },
            update: { type: input.chatType }
          });
          await transaction.telegramActivity.create({
            data: {
              ...(input.userId ? { telegramUserId: input.userId } : {}),
              telegramChatId: input.chatId,
              action: input.action
            }
          });
        });
      }
    : undefined;
  const getTelegramAdminAnalytics: TelegramGetAdminAnalytics | undefined = prisma
    ? async () => {
        const [
          users,
          chats,
          trackedContracts,
          totalScans,
          completedScans,
          failedScans,
          scanRequests,
          telegramActivityCount,
          webActivityCount,
          activities,
          webActivityEvents,
          scansForChart,
          registrations
        ] = await Promise.all([
          prisma.telegramUser.count(),
          prisma.telegramChat.count(),
          prisma.watchlistItem.count(),
          prisma.scan.count(),
          prisma.scan.count({ where: { state: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] } } }),
          prisma.scan.count({ where: { state: "FAILED" } }),
          prisma.scanRequest.groupBy({
            by: ["source"],
            _count: { _all: true }
          }),
          prisma.telegramActivity.count(),
          prisma.webActivity.count(),
          prisma.telegramActivity.findMany({
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 100_000
          }),
          prisma.webActivity.findMany({
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 100_000
          }),
          prisma.scan.findMany({
            select: { queuedAt: true },
            orderBy: { queuedAt: "asc" },
            take: 100_000
          }),
          prisma.telegramUser.findMany({
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 100_000
          })
        ]);
        const sourceCount = (source: "WEB" | "TELEGRAM" | "API" | "UNKNOWN") =>
          scanRequests.find((item) => item.source === source)?._count._all ?? 0;
        const scanEventsBySource = await prisma.scanRequest.findMany({
          select: { source: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 100_000
        });
        return {
          generatedAt: new Date(),
          users,
          chats,
          trackedContracts,
          totalScans,
          completedScans,
          failedScans,
          webScans: sourceCount("WEB"),
          telegramScans: sourceCount("TELEGRAM"),
          // Pre-attribution requests entered through this HTTP API. Keep them in the API bucket;
          // only explicitly tagged WEB/TELEGRAM requests are split out.
          apiScans: sourceCount("API") + sourceCount("UNKNOWN"),
          webActivities: webActivityCount,
          telegramActivities: telegramActivityCount,
          activities: activities.map((event) => ({ at: event.createdAt })),
          webActivityEvents: webActivityEvents.map((event) => ({ at: event.createdAt })),
          scans: scansForChart.map((event) => ({ at: event.queuedAt })),
          webScanEvents: scanEventsBySource
            .filter((event) => event.source === "WEB")
            .map((event) => ({ at: event.createdAt })),
          telegramScanEvents: scanEventsBySource
            .filter((event) => event.source === "TELEGRAM")
            .map((event) => ({ at: event.createdAt })),
          apiScanEvents: scanEventsBySource
            .filter((event) => event.source === "API" || event.source === "UNKNOWN")
            .map((event) => ({ at: event.createdAt })),
          registrations: registrations.map((event) => ({ at: event.createdAt }))
        };
      }
    : undefined;
  const getTelegramRegisteredUsers: TelegramGetRegisteredUsers | undefined = prisma
    ? async (requestedPage, pageSize) => {
        const total = await prisma.telegramUser.count();
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(Math.max(1, requestedPage), totalPages);
        const users = await prisma.telegramUser.findMany({
          select: { telegramUserId: true, username: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize
        });
        return {
          users: users.map((user) => ({
            telegramUserId: user.telegramUserId.toString(),
            username: user.username,
            createdAt: user.createdAt
          })),
          page,
          total,
          totalPages
        };
      }
    : undefined;
  const apiKeys = apiKeyRepository ?? (prisma ? createApiKeyRepository(prisma) : null);
  const queue = scanQueue ?? createScanQueue(env.REDIS_URL);
  const scanRateLimiter = createRateLimiter(RATE_LIMIT_WINDOW_MS);
  // Refreshes price/market cap/24h volume/liquidity via a live DexScreener lookup on top of an
  // already-persisted scan result, so a cached read shows current numbers for the parts that
  // change minute to minute without re-running the full detector/simulation pipeline. See
  // market-refresh.ts for why this is DexScreener-only rather than the full explorer-then-market
  // precedence chain a real scan uses. Routed through the same chain-keyed provider registry the
  // worker uses, so Robinhood, Arc, and Stable scans all get refreshed, not just Robinhood.
  const refreshVolatileFields = createMarketRefresher(
    getMarketDataProvider ?? ((chainId) => getProviderSet(chainId)?.market ?? null)
  );
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
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-api-key",
      "x-admin-secret",
      "idempotency-key",
      "x-sentinel-client"
    ]
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
    chainId: number;
    address: `0x${string}`;
    idempotencyKey: string;
    requestedBy?: string;
  }) => {
    const result = await submitScanRequest(input, { scans, queue });
    return result.scan;
  };
  const chainAdapter = createRobinhoodChainAdapter(env, { allowPublicDefault: true });
  const arcAdapter = createArcChainAdapter(env, { allowPublicDefault: true });
  const stableAdapter = createStableChainAdapter(env, { allowPublicDefault: true });

  async function detectTokenChain(
    address: `0x${string}`
  ): Promise<{ chainId: number; chainName: string } | null> {
    const checks: Array<{ adapter: typeof chainAdapter; chainId: number; name: string }> = [
      { adapter: chainAdapter, chainId: 4663, name: "Robinhood Chain" },
      { adapter: arcAdapter, chainId: 5042, name: "Arc Chain" },
      { adapter: stableAdapter, chainId: 988, name: "Stable Chain" }
    ];
    for (const { adapter, chainId, name } of checks) {
      try {
        const bytecode = await adapter.getBytecode({ address });
        if (bytecode !== "0x") {
          const metadata = await adapter.getTokenMetadata(address);
          if (metadata.name !== null || metadata.symbol !== null || metadata.decimals !== null) {
            return { chainId, chainName: name };
          }
        }
      } catch {
        continue;
      }
    }
    const chainName = await findExternalTokenChain(address);
    if (chainName) {
      return { chainId: -1, chainName };
    }
    return null;
  }

  const telegramBot = env.TELEGRAM_BOT_TOKEN
    ? createTelegramBot({
        token: env.TELEGRAM_BOT_TOKEN,
        webAppUrl: env.WEB_PUBLIC_APP_URL,
        submitScan,
        getScan: (scanId) => scans.getScan(scanId),
        getScanResult: (scanId) => scans.getScanResult(scanId),
        getLatestScanResult: (chainId, address) => scans.getLatestScanResult(chainId, address),
        refreshScanResult: async (scanId) => {
          const result = await scans.getScanResult(scanId);
          return result ? refreshVolatileFields(result) : null;
        },
        adminIds: env.TELEGRAM_ADMIN_IDS,
        ...(env.GENESISPAD_MAIN_GROUP_CHAT_ID
          ? { newGroupAlertChatId: env.GENESISPAD_MAIN_GROUP_CHAT_ID }
          : {}),
        ...(telegramGroupAlertMedia
          ? {
              getGroupAlertMedia: () => telegramGroupAlertMedia.getMedia(),
              setGroupAlertMedia: (media) => telegramGroupAlertMedia.setMedia(media)
            }
          : {}),
        isTokenContract: async (address) => {
          const detected = await detectTokenChain(address);
          if (detected === null) return { kind: "NOT_TOKEN" as const };
          if (detected.chainId === -1) return { kind: "UNSUPPORTED_CHAIN" as const, chainName: detected.chainName };
          return { kind: "SUPPORTED" as const, chainId: detected.chainId, chainName: detected.chainName };
        },
        ...(recordTelegramActivity ? { recordActivity: recordTelegramActivity } : {}),
        ...(getTelegramAdminAnalytics ? { getAdminAnalytics: getTelegramAdminAnalytics } : {}),
        ...(getTelegramRegisteredUsers ? { getRegisteredUsers: getTelegramRegisteredUsers } : {}),
        ...(telegramTracking
          ? {
              trackAddress: ((input) =>
                telegramTracking.trackAddress(input)) satisfies TelegramTrackAddress,
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

    telegramBotInit ??= (async () => {
      await telegramBot.init();
      await telegramBot.api.setMyCommands([...TELEGRAM_BOT_COMMANDS]);
    })();
    await telegramBotInit;
  };

  const isAdminRequest = (request: { headers: Record<string, string | string[] | undefined> }) => {
    const presented = request.headers["x-admin-secret"];
    const secret = Array.isArray(presented) ? presented[0] : presented;
    return Boolean(env.API_ADMIN_SECRET && secret === env.API_ADMIN_SECRET);
  };

  if (env.NODE_ENV !== "test") {
    app.addHook("onReady", ensureTelegramBotInitialized);
  }

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
          required: ["address"],
          properties: {
            chainId: { type: "integer", enum: [4663, 5042, 988], description: "Supported chain ID: Robinhood Chain (4663), Arc Chain (5042), or Stable Chain (988). When omitted the server auto-detects the chain." },
            address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
          }
        },
        response: {
          200: {
            description: "An existing scan was resolved (not newly queued).",
            type: "object",
            additionalProperties: true
          },
          202: {
            description: "A new scan was queued.",
            type: "object",
            additionalProperties: true
          },
          400: {
            description: "Invalid chain ID or address.",
            type: "object",
            additionalProperties: true
          },
          403: {
            description: "The presented API key lacks the scan:write scope.",
            type: "object",
            additionalProperties: true
          },
          429: {
            description: "Rate limit exceeded (per-key, or anonymous by IP).",
            type: "object",
            additionalProperties: true
          }
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
      const rateLimitMax =
        request.apiKey?.rateLimitPerMinute ?? ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE;
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
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
        });
      }

      const address = normalizeEvmAddress(parsed.data.address);
      const providedChainId = parsed.data.chainId;
      let chainId: number;
      if (providedChainId) {
        chainId = providedChainId;
      } else {
        const detected = await detectTokenChain(address as `0x${string}`);
        if (detected === null) {
          return reply.code(400).send({
            error: "no_token_found",
            message: "No token contract found at that address on any supported chain."
          });
        }
        if (detected.chainId === -1) {
          return reply.code(400).send({
            error: "unsupported_chain",
            message: `That address is a token on ${detected.chainName}, which is not yet supported.`
          });
        }
        chainId = detected.chainId;
      }

      const result = await submitScanRequest(
        {
          chainId,
          address,
          idempotencyKey:
            request.headers["idempotency-key"]?.toString() ??
            `${chainId}:${address.toLowerCase()}`,
          source: request.headers["x-sentinel-client"] === "web" ? "WEB" : "API"
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
        description:
          'The public "recent detections" feed — most recent scan per token, newest first.',
        tags: ["scans"],
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }
        },
        response: {
          200: {
            description: "Recent scans, newest first.",
            type: "object",
            additionalProperties: true
          }
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
      return reply
        .code(503)
        .send({
          error: "analytics_unavailable",
          message: "Analytics are temporarily unavailable."
        });
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
        description:
          "Poll a scan's current lifecycle state and stage progress. Full fallback for clients not using the SSE events endpoint.",
        tags: ["scans"],
        response: {
          200: {
            description: "The scan's current state.",
            type: "object",
            additionalProperties: true
          },
          404: {
            description: "No scan exists for that scan ID.",
            type: "object",
            additionalProperties: true
          }
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
        description:
          "The persisted scan result: findings, liquidity, holders, simulations, and risk, whatever the scan has reached so far.",
        tags: ["scans"],
        response: {
          200: {
            description: "The scan's persisted result.",
            type: "object",
            additionalProperties: true
          },
          404: {
            description: "No scan result exists for that scan ID.",
            type: "object",
            additionalProperties: true
          }
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
          404: {
            description: "No scan exists for that scan ID.",
            type: "object",
            additionalProperties: true
          }
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
      chainId: { type: "integer", enum: [4663, 5042, 988], description: "Robinhood Chain (4663), Arc Chain (5042), or Stable Chain (988)." },
      address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
    }
  } as const;
  const tokenNotFoundResponses = {
    400: {
      description: "Invalid chain ID or address.",
      type: "object",
      additionalProperties: true
    },
    404: {
      description: "No scan has been run for this token yet.",
      type: "object",
      additionalProperties: true
    }
  } as const;

  app.get(
    "/v1/tokens/:chainId/:address",
    {
      schema: {
        description:
          "A token's latest persisted scan result: findings, liquidity, holders, simulations, and risk.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: {
            description: "The token's latest scan result.",
            type: "object",
            additionalProperties: true
          },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
        });
      }

      const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
      if (!result) {
        return reply.code(404).send({
          error: "scan_not_found",
          message: "No scan has been run for this token yet."
        });
      }

      return refreshVolatileFields(result);
    }
  );

  app.get(
    "/v1/tokens/:chainId/:address/liquidity",
    {
      schema: {
        description:
          "The liquidity-discovery slice of a token's latest scan: discovered pools, reserves, and lock/burn status.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: { description: "Liquidity summary.", type: "object", additionalProperties: true },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
        });
      }

      const result = await scans.getLatestScanResult(parsed.data.chainId, parsed.data.address);
      if (!result) {
        return reply.code(404).send({
          error: "scan_not_found",
          message: "No scan has been run for this token yet."
        });
      }

      return (await refreshVolatileFields(result)).liquidity;
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
          200: {
            description: "Plain-language token security summary.",
            type: "object",
            additionalProperties: true
          },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
        description:
          "The holder-concentration slice of a token's latest scan: top-holder percentages and related-wallet clustering.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: {
            description: "Holder concentration summary.",
            type: "object",
            additionalProperties: true
          },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
          200: {
            description: "Deployer address and history.",
            type: "object",
            additionalProperties: true
          },
          ...tokenNotFoundResponses,
          404: {
            description: "No scan, or no deployer address resolved yet, for this token.",
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
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
        response: {
          200: { description: "Simulation runs.", type: "object", additionalProperties: true },
          ...tokenNotFoundResponses
        }
      }
    },
    async (request, reply) => {
      const parsed = tokenParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
        description:
          "All persisted security findings for a token's latest scan, most serious first.",
        tags: ["tokens"],
        params: tokenParamsJsonSchema,
        response: {
          200: { description: "Findings list.", type: "object", additionalProperties: true },
          400: {
            description: "Invalid chain ID or address.",
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
          error: "invalid_token_request",
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
          message: "Provide a valid EVM contract address on Robinhood Chain, Arc Chain, or Stable Chain."
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
            description:
              "The created key, including the plaintext `key` field (shown only this once).",
            type: "object",
            additionalProperties: true
          },
          400: {
            description: "Missing or invalid name/scopes.",
            type: "object",
            additionalProperties: true
          },
          403: {
            description: "Custom scopes or limits require the admin secret.",
            type: "object",
            additionalProperties: true
          },
          429: {
            description: "Too many key-creation requests from this address.",
            type: "object",
            additionalProperties: true
          },
          503: {
            description: "API key management is not configured on this instance.",
            type: "object",
            additionalProperties: true
          }
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

      const rateLimitResult = scanRateLimiter.check(
        `anon:${request.ip}`,
        ANONYMOUS_SCAN_RATE_LIMIT_PER_MINUTE
      );
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
        requestedScopes.some((scope) => scope !== "scan:read") ||
        requestedCustomLimit !== undefined;
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
        description:
          "The presented API key's own record: name, prefix, scopes, rate limit, and usage timestamps. Never returns the hash or plaintext.",
        tags: ["api-keys"],
        response: {
          200: {
            description: "The presented key's record.",
            type: "object",
            additionalProperties: true
          },
          401: {
            description: "No API key was presented.",
            type: "object",
            additionalProperties: true
          },
          503: {
            description: "API key management is not configured on this instance.",
            type: "object",
            additionalProperties: true
          }
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
        description:
          "Revoke the presented API key. There is no ownership model yet, so a key can only revoke itself.",
        tags: ["api-keys"],
        response: {
          200: {
            description: "The revoked key's record, with revokedAt set.",
            type: "object",
            additionalProperties: true
          },
          401: {
            description: "No API key was presented.",
            type: "object",
            additionalProperties: true
          },
          503: {
            description: "API key management is not configured on this instance.",
            type: "object",
            additionalProperties: true
          }
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

const DEXSCREENER_CHAIN_NAMES: Readonly<Record<string, string>> = {
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  optimism: "Optimism",
  avalanche: "Avalanche",
  solana: "Solana",
  arc: "Arc Chain",
  stable: "Stable Chain"
};

export async function findExternalTokenChain(
  address: `0x${string}`,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  try {
    const response = await fetcher(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { signal: AbortSignal.timeout(3_000) }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      pairs?: Array<{ chainId?: string; baseToken?: { address?: string } }>;
    };
    const pair = payload.pairs?.find(
      (candidate) =>
        candidate.baseToken?.address?.toLowerCase() === address.toLowerCase() &&
        candidate.chainId !== "robinhood"
    );
    if (!pair?.chainId) return null;
    return DEXSCREENER_CHAIN_NAMES[pair.chainId] ?? pair.chainId;
  } catch {
    return null;
  }
}
