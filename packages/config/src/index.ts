import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional()
  .pipe(z.url().optional());

const booleanString = z
  .string()
  .trim()
  .transform((value) => ["1", "true", "yes", "on"].includes(value.toLowerCase()))
  .optional()
  .default(false);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  API_RATE_LIMIT_TIME_WINDOW: z.string().default("1 minute"),
  API_CORS_ORIGIN: z.string().default("http://localhost:3000"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  WEB_PUBLIC_API_BASE_URL: z.url().default("http://localhost:4000"),
  // The web app's own public URL, used to build "View Full Report" links from the Telegram bot
  // back to the richer web report (wallet-cluster graph, full findings list, etc.) that a
  // compact Telegram message can't reproduce.
  WEB_PUBLIC_APP_URL: z.url().default("https://sentinel.genesispad.app"),
  DATABASE_URL: z.url().default("postgresql://sentinel:sentinel@localhost:5432/genesis_sentinel"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  ROBINHOOD_RPC_URL: optionalUrl,
  ROBINHOOD_FALLBACK_RPC_URLS: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  API_ADMIN_SECRET: z.string().min(16).optional(),
  TELEGRAM_SCAN_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(86_400).default(0),
  TELEGRAM_SCAN_BURST_LIMIT: z.coerce.number().int().min(1).max(1_000).default(30),
  TELEGRAM_SCAN_BURST_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
  // Aggregate limit for group/supergroup chats, checked in addition to the per-user limit above
  // — bounds total scan volume a group can generate regardless of how many distinct members are
  // each individually within their own per-user budget. Higher than the per-user default since
  // it covers every member of the chat combined, not one person.
  TELEGRAM_GROUP_SCAN_BURST_LIMIT: z.coerce.number().int().min(1).max(1_000).default(60),
  TELEGRAM_GROUP_SCAN_BURST_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
  SIMULATION_FORK_ENABLED: booleanString,
  SIMULATION_FORK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  SIMULATION_FORK_NATIVE_AMOUNT_WEI: z.string().regex(/^\d+$/u).default("1000000000000000"),
  SENTRY_DSN: optionalUrl
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(input);
}
