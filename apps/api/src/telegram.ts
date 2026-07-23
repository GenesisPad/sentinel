import { createHash } from "node:crypto";
import { Bot, InlineKeyboard } from "grammy";
import type {
  TelegramChatIdentity,
  TrackedTelegramAddress,
  TrackTelegramAddressInput
} from "@genesis-sentinel/database";
import {
  buildDexScreenerUrl,
  buildTokenSecuritySummary,
  formatCompactUsd,
  formatHumanDateTime,
  liquidityHealthTier,
  selectPrimaryLiquidityPool,
  type LiquidityHealthTier,
  type ScanProgress,
  type ScanResultView,
  type SecurityFindingView,
  type SecuritySignalAnswer,
  type SecuritySignalSeverity
} from "@genesis-sentinel/shared";
import type { SubmitScanInput } from "./scan-service.js";

export type TelegramSubmitScan = (input: SubmitScanInput) => Promise<ScanProgress>;
export type TelegramGetScan = (scanId: string) => Promise<ScanProgress | null>;
export type TelegramGetScanResult = (scanId: string) => Promise<ScanResultView | null>;
export type TelegramTrackAddress = (
  input: TrackTelegramAddressInput
) => Promise<{ item: TrackedTelegramAddress; created: boolean }>;
export type TelegramUntrackAddress = (
  input: TrackTelegramAddressInput
) => Promise<{ removed: boolean }>;
export type TelegramListTrackedAddresses = (
  chat: TelegramChatIdentity
) => Promise<TrackedTelegramAddress[]>;

const addressPattern = /0x[a-fA-F0-9]{40}/;
const terminalScanStates = new Set(["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"]);

/** Maps the raw backend scan state to a friendly, emoji'd label — never shown to a user as the
 * raw enum string (e.g. "PARTIALLY_COMPLETED"), which reads as an internal implementation
 * detail rather than useful information. */
const FRIENDLY_SCAN_STATE: Record<string, string> = {
  QUEUED: "🕓 Queued",
  RESOLVING_CHAIN: "🔗 Resolving chain",
  FETCHING_CONTRACT: "📄 Fetching contract",
  ANALYZING_CONTRACT: "🔬 Analyzing contract",
  DISCOVERING_MARKETS: "💧 Discovering markets",
  ANALYZING_HOLDERS: "👥 Analyzing holders",
  SIMULATING_TRADES: "🔁 Simulating trades",
  SCORING: "🧮 Scoring",
  COMPLETED: "✅ Complete",
  PARTIALLY_COMPLETED: "✅ Complete (partial data)",
  FAILED: "❌ Failed"
};

export function friendlyScanState(state: string): string {
  return FRIENDLY_SCAN_STATE[state] ?? state;
}

/** Per-stage progress copy shown while a scan runs, keyed to the backend's real state so the
 * animation reflects actual progress rather than a guessed fixed timer. */
const SCAN_STAGE_MESSAGE: Record<string, string> = {
  QUEUED: "🕓 *Queued*\nWaiting for a worker to pick this scan up...",
  RESOLVING_CHAIN: "🔗 *Resolving chain...*",
  FETCHING_CONTRACT: "📄 *Fetching contract...*\nReading bytecode & metadata.",
  ANALYZING_CONTRACT: "🔬 *Analyzing contract & checking controls...*",
  DISCOVERING_MARKETS: "💧 *Checking liquidity pools...*",
  ANALYZING_HOLDERS: "👥 *Running holders analysis...*",
  SIMULATING_TRADES: "🔁 *Simulating buy/sell trades...*",
  SCORING: "🧮 *Finalizing risk score...*"
};

export function formatScanStageMessage(state: string, trackingLine: string | null): string {
  const stage = SCAN_STAGE_MESSAGE[state] ?? `${friendlyScanState(state)}...`;
  return trackingLine ? `${stage}\n\n_${escapeMarkdown(trackingLine)}_` : stage;
}

/** Resolves the best DexScreener chart link for a scan result — the highest-liquidity pool,
 * same selection rule readLiquidityData uses, so the Chart button never points at a near-dust
 * pool when a real one exists. Undefined (not a broken link) when no pool has been discovered
 * yet, so the button can be omitted entirely. */
export function resolveChartUrl(result: ScanResultView): string | undefined {
  const pool = selectPrimaryLiquidityPool(result.liquidity.pools);
  return pool ? buildDexScreenerUrl(pool.poolAddress) : undefined;
}

type TelegramChatLike = {
  id: number | bigint;
  type: string;
  title?: string | undefined;
};

export interface TelegramScanLimitOptions {
  cooldownMs: number;
  burstLimit: number;
  burstWindowMs: number;
  now?: () => number;
}

export interface TelegramScanLimiter {
  check(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

interface TelegramCallbackRegistry {
  scanIdsByKey: Map<string, string>;
  keysByScanId: Map<string, string>;
}

export function createTelegramBot(options: {
  token: string;
  /** Base URL of the web app, used to build "Full Report" links. Omit to hide that button. */
  webAppUrl?: string;
  submitScan: TelegramSubmitScan;
  getScan: TelegramGetScan;
  getScanResult: TelegramGetScanResult;
  trackAddress?: TelegramTrackAddress;
  untrackAddress?: TelegramUntrackAddress;
  listTrackedAddresses?: TelegramListTrackedAddresses;
  /** Per chat+user cooldown/burst limit — bounds any single member's request rate. */
  scanLimiter?: TelegramScanLimiter;
  /** Aggregate per-chat limit, checked in addition to `scanLimiter` in group/supergroup chats
   * only — bounds total scan volume a group can generate regardless of how many distinct
   * members are each individually within their own per-user budget. */
  groupScanLimiter?: TelegramScanLimiter;
}) {
  const bot = new Bot(options.token);
  const callbackRegistry: TelegramCallbackRegistry = {
    scanIdsByKey: new Map(),
    keysByScanId: new Map()
  };

  bot.command("start", async (context) => {
    await context.reply(
      [
        "🛡️ Genesis Sentinel scans Robinhood Chain token contracts and reports persisted evidence-backed findings.",
        "",
        "*Commands:*",
        "🔍 /scan <contract address>",
        "🔎 /status <scan id>",
        "📋 /result <scan id>",
        "⭐ /track <contract address>",
        "📌 /tracked",
        "🗑️ /untrack <contract address>"
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
  });

  bot.command("help", async (context) => {
    await context.reply(
      [
        "🔍 Send /scan <contract address> or paste a contract address.",
        "🔎 Use /status <scan id> to check progress.",
        "📋 Use /result <scan id> to summarize persisted findings.",
        "⭐ Use /track <contract address> to save a CA for this chat.",
        "📌 Use /tracked to list saved CAs.",
        "🗑️ Use /untrack <contract address> to remove one.",
        "⚠️ Reports are risk indicators, not guarantees."
      ].join("\n")
    );
  });

  bot.command("scan", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("⚠️ Send /scan followed by a valid EVM contract address.");
      return;
    }
    if (!context.chat) return;

    const limit = checkTelegramRateLimit(
      options.scanLimiter,
      options.groupScanLimiter,
      context.chat,
      context.from?.id
    );
    if (!limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat.id,
      fromId: context.from?.id,
      telegramChat: context.chat
    });
  });

  bot.command("track", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("⚠️ Send /track followed by a valid EVM contract address.");
      return;
    }
    if (!context.chat) return;

    const limit = checkTelegramRateLimit(
      options.scanLimiter,
      options.groupScanLimiter,
      context.chat,
      context.from?.id
    );
    if (!limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    const tracking = await trackTelegramAddress(options.trackAddress, address, context.chat);
    if (!tracking) {
      await context.reply("⚠️ CA tracking is not configured for this bot yet.");
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat.id,
      fromId: context.from?.id,
      telegramChat: context.chat,
      tracking
    });
  });

  bot.command("untrack", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("⚠️ Send /untrack followed by a valid EVM contract address.");
      return;
    }

    const chat = createTelegramChatIdentity(context.chat);
    if (!chat || !options.untrackAddress) {
      await context.reply("⚠️ CA tracking is not configured for this bot yet.");
      return;
    }

    const result = await options.untrackAddress({ chat, chainId: 4663, address });
    await context.reply(formatTelegramUntrackReply(address, result.removed));
  });

  bot.command("tracked", async (context) => {
    const chat = createTelegramChatIdentity(context.chat);
    if (!chat || !options.listTrackedAddresses) {
      await context.reply("⚠️ CA tracking is not configured for this bot yet.");
      return;
    }

    const tracked = await options.listTrackedAddresses(chat);
    await context.reply(formatTelegramTrackedListReply(tracked));
  });

  bot.command("status", async (context) => {
    const scanId = parseCommandArgument(context.message?.text ?? "");
    if (!scanId) {
      await context.reply("⚠️ Send /status followed by a scan ID.");
      return;
    }

    const scan = await options.getScan(scanId);
    await context.reply(
      scan ? formatTelegramProgressReply(scan) : "❓ No scan was found for that ID."
    );
  });

  bot.command("result", async (context) => {
    const scanId = parseCommandArgument(context.message?.text ?? "");
    if (!scanId) {
      await context.reply("⚠️ Send /result followed by a scan ID.");
      return;
    }

    const result = await options.getScanResult(scanId);
    if (!result) {
      await context.reply("❓ No scan result was found for that ID.");
      return;
    }

    await context.reply(formatTelegramResultReply(result), {
      parse_mode: "Markdown",
      reply_markup: createTelegramResultKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId),
        resolveChartUrl(result),
        options.webAppUrl ? telegramFullReportUrl(options.webAppUrl, result) : undefined
      )
    });
  });

  bot.callbackQuery(/^refresh:(.+)$/u, async (context) => {
    const scanId = resolveTelegramCallbackScanId(callbackRegistry, context.match[1]);
    if (!scanId) {
      await context.answerCallbackQuery({ text: "Missing scan ID." });
      return;
    }

    const result = await options.getScanResult(scanId);
    if (!result) {
      await context.answerCallbackQuery({ text: "No scan result was found for that ID." });
      return;
    }

    await context.editMessageText(formatTelegramResultReply(result), {
      parse_mode: "Markdown",
      reply_markup: createTelegramResultKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId),
        resolveChartUrl(result),
        options.webAppUrl ? telegramFullReportUrl(options.webAppUrl, result) : undefined
      )
    });
    await context.answerCallbackQuery({ text: "Result refreshed." });
  });

  bot.callbackQuery(/^back:(.+)$/u, async (context) => {
    const scanId = resolveTelegramCallbackScanId(callbackRegistry, context.match[1]);
    if (!scanId) {
      await context.answerCallbackQuery({ text: "Missing scan ID." });
      return;
    }

    const result = await options.getScanResult(scanId);
    if (!result) {
      await context.answerCallbackQuery({ text: "No scan result was found for that ID." });
      return;
    }

    await context.editMessageText(formatTelegramResultReply(result), {
      parse_mode: "Markdown",
      reply_markup: createTelegramResultKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId),
        resolveChartUrl(result),
        options.webAppUrl ? telegramFullReportUrl(options.webAppUrl, result) : undefined
      )
    });
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^status:(.+)$/u, async (context) => {
    const scanId = resolveTelegramCallbackScanId(callbackRegistry, context.match[1]);
    if (!scanId) {
      await context.answerCallbackQuery({ text: "Missing scan ID." });
      return;
    }

    const scan = await options.getScan(scanId);
    if (!scan) {
      await context.answerCallbackQuery({ text: "No scan was found for that ID." });
      return;
    }

    await context.reply(formatTelegramProgressReply(scan), {
      parse_mode: "Markdown",
      reply_markup: createTelegramScanKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, scan.scanId)
      )
    });
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^section:(holders|cluster|controls):(.+)$/u, async (context) => {
    const section = context.match[1];
    const scanId = resolveTelegramCallbackScanId(callbackRegistry, context.match[2]);
    if (!isTelegramResultSection(section) || !scanId) {
      await context.answerCallbackQuery({ text: "Invalid report section." });
      return;
    }

    const result = await options.getScanResult(scanId);
    if (!result) {
      await context.answerCallbackQuery({ text: "No scan result was found for that ID." });
      return;
    }

    // Edits the summary message in place rather than sending a new one — the whole point of
    // Back is that a section view and the summary are the same message, just different content.
    await context.editMessageText(formatTelegramSectionReply(section, result), {
      parse_mode: "Markdown",
      reply_markup: createTelegramSectionKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId)
      )
    });
    await context.answerCallbackQuery();
  });

  bot.on("message:text", async (context) => {
    // Never respond to another bot — a group with two token-scanner bots would otherwise loop
    // each other's replies back and forth.
    if (context.from?.is_bot) return;

    const address = parseScanAddress(context.message.text);
    if (!address) {
      return;
    }

    const limit = checkTelegramRateLimit(
      options.scanLimiter,
      options.groupScanLimiter,
      context.chat,
      context.from?.id
    );
    if (!limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat.id,
      fromId: context.from?.id,
      telegramChat: context.chat
    });
  });

  /**
   * Submits a scan and replaces a single progress message in place as real backend stages
   * advance (deleting the previous stage message before sending the next, not editing it — an
   * animated "still working" feel rather than the earlier, now-removed static "Scan submitted"
   * message this replaced). Once the scan reaches a terminal state, deletes the last stage
   * message and sends the final result with its keyboard. Uses `bot.api` directly (not
   * `context.reply`) because the animation needs to delete and send independently of any single
   * incoming update's context.
   */
  async function submitScanAndReply(input: {
    address: `0x${string}`;
    chatId: number | bigint;
    fromId: number | bigint | undefined;
    telegramChat: TelegramChatLike | undefined;
    tracking?: { item: TrackedTelegramAddress; created: boolean };
  }) {
    // Telegram chat ids always fit within JS's safe integer range in practice; grammy's API
    // client types chat_id as string | number, not bigint.
    const chatId = Number(input.chatId);
    const tracking =
      input.tracking ??
      (await trackTelegramAddress(options.trackAddress, input.address, input.telegramChat));
    const scan = await options.submitScan(
      createTelegramScanInput(input.address, input.chatId, input.fromId)
    );

    const trackingLine = tracking ? formatTelegramTrackingLine(tracking) : null;
    let stageMessageId: number | undefined;
    let lastDisplayedState = scan.state;
    try {
      const sent = await bot.api.sendMessage(chatId, formatScanStageMessage(scan.state, trackingLine), {
        parse_mode: "Markdown"
      });
      stageMessageId = sent.message_id;
    } catch {
      // If even the first stage message can't be sent (e.g. the bot was blocked, or this is a
      // channel it can't post in), there is nothing further to animate or deliver.
      return;
    }

    const maxAttempts = 45;
    const pollDelayMs = 1_000;
    let finalScan = scan;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current = await options.getScan(scan.scanId);
      if (!current) break;
      finalScan = current;

      if (current.state !== lastDisplayedState) {
        lastDisplayedState = current.state;
        if (stageMessageId !== undefined) {
          await bot.api.deleteMessage(chatId, stageMessageId).catch(() => {});
        }
        if (!terminalScanStates.has(current.state)) {
          const sent = await bot.api
            .sendMessage(chatId, formatScanStageMessage(current.state, null), {
              parse_mode: "Markdown"
            })
            .catch(() => undefined);
          stageMessageId = sent?.message_id;
        }
      }

      if (terminalScanStates.has(current.state)) break;
      await sleep(pollDelayMs);
    }

    const result = await options.getScanResult(scan.scanId);
    if (stageMessageId !== undefined) {
      await bot.api.deleteMessage(chatId, stageMessageId).catch(() => {});
    }

    if (result) {
      await bot.api.sendMessage(chatId, formatTelegramResultReply(result), {
        parse_mode: "Markdown",
        reply_markup: createTelegramResultKeyboard(
          rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId),
          resolveChartUrl(result),
          options.webAppUrl ? telegramFullReportUrl(options.webAppUrl, result) : undefined
        )
      });
      return;
    }

    // Still not terminal after generous polling (an unusually slow scan) — give the user a way
    // to check back rather than a dead end with no further messages.
    await bot.api.sendMessage(chatId, formatTelegramProgressReply(finalScan), {
      parse_mode: "Markdown",
      reply_markup: createTelegramScanKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, scan.scanId)
      )
    });
  }

  return bot;
}

function isTelegramResultSection(
  value: string | undefined
): value is "holders" | "cluster" | "controls" {
  return value === "holders" || value === "cluster" || value === "controls";
}

export function parseScanAddress(text: string): `0x${string}` | null {
  const match = addressPattern.exec(text);
  return match ? (match[0] as `0x${string}`) : null;
}

export function parseCommandArgument(text: string): string | null {
  const argument = text
    .trim()
    .replace(/^\/[a-zA-Z_]+(?:@[a-zA-Z0-9_]+)?\s*/, "")
    .trim();
  return argument.length > 0 ? argument : null;
}

export function createTelegramScanLimiter(options: TelegramScanLimitOptions): TelegramScanLimiter {
  const attemptsByKey = new Map<string, number[]>();
  const now = options.now ?? Date.now;

  return {
    check(key) {
      const currentTime = now();
      const windowStart = currentTime - options.burstWindowMs;
      const attempts = (attemptsByKey.get(key) ?? []).filter(
        (attemptedAt) => attemptedAt > windowStart
      );
      const lastAttempt = attempts.at(-1);

      if (lastAttempt !== undefined) {
        const cooldownEndsAt = lastAttempt + options.cooldownMs;
        if (currentTime < cooldownEndsAt) {
          return {
            allowed: false,
            retryAfterSeconds: Math.ceil((cooldownEndsAt - currentTime) / 1_000)
          };
        }
      }

      if (attempts.length >= options.burstLimit) {
        const oldestAttempt = attempts[0] ?? currentTime;
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(
            (oldestAttempt + options.burstWindowMs - currentTime) / 1_000
          )
        };
      }

      attempts.push(currentTime);
      attemptsByKey.set(key, attempts);
      return { allowed: true };
    }
  };
}

export function formatTelegramRateLimitReply(retryAfterSeconds: number): string {
  return `⏳ Too many scan requests. Try again in about ${retryAfterSeconds} seconds.`;
}

export function formatTelegramProgressReply(scan: ScanProgress): string {
  const fields = [
    `🔎 *Scan progress*`,
    `State: ${friendlyScanState(scan.state)}`,
    `\`${scan.scanId}\``,
    `Address: \`${scan.address}\``,
    `Message: ${escapeMarkdown(scan.message)}`
  ];

  if (scan.scanBlockNumber) {
    fields.push(`Block: ${scan.scanBlockNumber}`);
  }

  const completedAt = formatHumanDateTime(scan.completedAt);
  if (completedAt) {
    fields.push(`Completed: ${completedAt}`);
  }

  return fields.join("\n");
}

export function formatTelegramUntrackReply(address: `0x${string}`, removed: boolean): string {
  return removed
    ? `🗑️ Stopped tracking ${address}.`
    : `❓ That CA was not on this chat watchlist: ${address}`;
}

export function formatTelegramTrackedListReply(items: TrackedTelegramAddress[]): string {
  if (items.length === 0) {
    return "📌 No CAs are tracked in this chat yet. Use /track <contract address> or paste a CA.";
  }

  return [
    `📌 Tracked CAs (${items.length})`,
    ...items.map((item, index) => `${index + 1}. ${item.address} | chain ${item.chainId}`)
  ].join("\n");
}

export function formatTelegramResultReply(result: ScanResultView): string {
  const topFindings = [...result.findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3);
  const tax = readTaxData(result);
  const honeypot = readHoneypotStatus(result);
  const liquidity = readLiquidityData(result);
  const concentration = readHolderConcentration(result);
  const ownerAddress = result.token.ownerAddress ? ` (` + "`" + `${shortenAddress(result.token.ownerAddress)}` + "`" + `)` : "";
  const ownership = formatOwnershipStatus(result);

  const topRisksBlock =
    topFindings.length > 0
      ? ["🚩 *Top risks*", ...topFindings.map((f) => `${severityEmoji(f.severity)} ${escapeMarkdown(f.title)}`)].join("\n")
      : "🚩 *Top risks:* none persisted ✅";

  const summary = buildTokenSecuritySummary(result);

  const lines = compact([
    "🛡️ *Genesis Sentinel*",
    `${escapeMarkdown(formatTokenLabel(result))} ${riskEmoji(result)} *${formatRiskLine(result)}*`,
    `\`${result.scan.address}\``,
    "",
    // Leads the report: these mean the token can take your balance or your money regardless of
    // how the rest of the numbers look, so they belong above the usual metrics.
    criticalAlertBlock(result),
    honeypot ? `🍯 Honeypot: ${honeypot}` : null,
    capabilityLine(result),
    taxLine(tax),
    controlsSummaryLine(result),
    "",
    ownership ? `👤 Owner: ${ownership}${ownerAddress}` : null,
    result.token.deployerAddress ? `🏗️ Deployer: \`${shortenAddress(result.token.deployerAddress)}\`` : null,
    deployerBalanceLine(summary.deployerBalance, result),
    devClusterLine(summary.devCluster),
    sourceVerifiedLine(result),
    dexPaidLine(result),
    tokenAgeLine(result),
    "",
    marketLine(result),
    priceLine(result),
    liquidityLine(liquidity),
    "",
    holdersLine(result, concentration),
    "",
    topRisksBlock,
    "",
    result.risk.score === null ? null : "_Higher score means greater risk._",
    scannedAtLine(result),
    `${friendlyScanState(result.scan.state)} · v${escapeMarkdown(result.scan.scannerVersion)}`,
    "_DYOR/NFA. Risk indicator, not a guarantee._"
  ]).filter((line, index, lines) => line !== "" || (lines[index - 1] !== "" && lines[index + 1] !== ""));

  return lines.join("\n");
}
/** `fullReportUrl`, when provided, adds a button linking to the web app's much richer report
 * (wallet-cluster graph, every finding, evidence) — a compact Telegram message can't reproduce
 * that, so it needs an explicit way out rather than leaving Telegram users stuck with less
 * information than the web app has always shown for the same scan. `chartUrl` is omitted
 * (never a dead link) when no liquidity pool has been discovered yet. Tax figures are already in
 * the main summary line, so there is no separate Taxes button. */
export function createTelegramResultKeyboard(
  callbackScanId: string,
  chartUrl?: string,
  fullReportUrl?: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📊 Controls", `section:controls:${callbackScanId}`)
    .text("👥 Holders", `section:holders:${callbackScanId}`)
    .text("🕸️ Dev Cluster", `section:cluster:${callbackScanId}`)
    .row();
  if (chartUrl) {
    keyboard.url("📈 Chart", chartUrl);
  }
  keyboard.text("🔄 Refresh", `refresh:${callbackScanId}`);
  return fullReportUrl ? keyboard.row().url("🔗 Full Report", fullReportUrl) : keyboard;
}

/** The keyboard shown while viewing a section (Controls/Holders/Dev Cluster) — Back returns to
 * the main summary in place (an edit, not a new message), the same single level of navigation
 * "back" ever needs since every section is reached directly from the summary. */
export function createTelegramSectionKeyboard(callbackScanId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("◀️ Back", `back:${callbackScanId}`)
    .text("🔄 Refresh", `refresh:${callbackScanId}`);
}

/** Robinhood Chain (4663) is the only chain the API implements end-to-end today, matching every
 * other Robinhood-only assumption already baked into this file's scan submission path — so the
 * web app's "robinhood" URL segment is safe to hardcode rather than needing a numeric-to-slug
 * chain registry just for this one link. */
export function telegramFullReportUrl(webAppUrl: string, result: ScanResultView): string {
  return `${webAppUrl.replace(/\/+$/u, "")}/token/robinhood/${result.scan.address}`;
}

export function createTelegramScanKeyboard(callbackScanId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 Status", `status:${callbackScanId}`)
    .text("📋 Result", `refresh:${callbackScanId}`);
}

export function createTelegramCallbackKey(scanId: string): string {
  return createHash("sha256").update(scanId).digest("base64url").slice(0, 16);
}

function rememberTelegramCallbackScanId(
  registry: TelegramCallbackRegistry,
  scanId: string
): string {
  const existing = registry.keysByScanId.get(scanId);
  if (existing) return existing;

  const key = createTelegramCallbackKey(scanId);
  registry.keysByScanId.set(scanId, key);
  registry.scanIdsByKey.set(key, scanId);

  if (registry.scanIdsByKey.size > 1_000) {
    const oldest = registry.scanIdsByKey.keys().next().value;
    if (oldest) {
      const oldestScanId = registry.scanIdsByKey.get(oldest);
      registry.scanIdsByKey.delete(oldest);
      if (oldestScanId) registry.keysByScanId.delete(oldestScanId);
    }
  }

  return key;
}

function resolveTelegramCallbackScanId(
  registry: TelegramCallbackRegistry,
  callbackScanId: string | undefined
): string | undefined {
  if (!callbackScanId) return undefined;
  return registry.scanIdsByKey.get(callbackScanId) ?? callbackScanId;
}

/** Signal ids from buildTokenSecuritySummary's `signals` array that belong on the "Controls"
 * section — the same capability flags the web app's Contract Controls grid shows. Excludes
 * honeypot, buy_tax, sell_tax, dev_cluster, and creator_address, which already have their own
 * dedicated sections/inline lines elsewhere in this bot. */
const CONTROLS_SIGNAL_IDS = [
  "can_create_more_tokens",
  "can_block_wallets",
  "can_pause_transfers",
  "trading_cooldown",
  "has_whitelist",
  "proxy_contract",
  "hidden_owner_controls",
  "obfuscated_address",
  "suspicious_functions",
  "ownership_renounced"
];

function signalSeverityEmoji(severity: SecuritySignalSeverity): string {
  if (severity === "CRITICAL") return "🔴";
  if (severity === "HIGH") return "🟠";
  if (severity === "WARN") return "🟡";
  if (severity === "GOOD") return "🟢";
  return "⚪";
}

function formatSignalAnswer(answer: SecuritySignalAnswer): string {
  if (answer === "YES") return "Yes";
  if (answer === "NO") return "No";
  return "Unknown";
}

export function formatTelegramSectionReply(
  section: "holders" | "cluster" | "controls",
  result: ScanResultView
): string {
  if (section === "controls") {
    const { signals } = buildTokenSecuritySummary(result);
    const rows = CONTROLS_SIGNAL_IDS.map((id) => signals.find((signal) => signal.id === id)).filter(
      (signal): signal is (typeof signals)[number] => signal !== undefined
    );

    if (rows.length === 0) {
      return "*Contract controls*\nNo control-surface evidence was returned by the configured detectors for this scan.";
    }

    return compact([
      "*Contract controls*",
      ...rows.map((signal) => {
        const value = signal.value ? ` (${escapeMarkdown(signal.value)})` : "";
        return `${signalSeverityEmoji(signal.severity)} ${escapeMarkdown(signal.label)}: ${formatSignalAnswer(signal.answer)}${value}`;
      }),
      "",
      "_A capability existing does not prove it will be used — see /result for evidence and Top risks for what's actually confirmed._"
    ]).join("\n");
  }

  if (section === "cluster") {
    const { devCluster } = buildTokenSecuritySummary(result);
    if (devCluster.walletCount === 0) {
      return "*Dev cluster*\nNo wallet has been evidenced as connected to the deployer for this token.";
    }

    const roleLabels: Record<string, string> = {
      DEPLOYED_BY: "deployer",
      TRANSFERRED_SUPPLY_TO: "received supply",
      OWNED_BY: "owner",
      PREVIOUSLY_OWNED_BY: "previous owner",
      FUNDED_BY: "funded by",
      SHARED_BYTECODE: "shared bytecode"
    };

    return compact([
      "*Dev cluster*",
      devClusterLine(devCluster),
      "",
      ...devCluster.wallets
        .slice(0, 10)
        .map(
          (wallet) =>
            `\`${shortenAddress(wallet.address)}\` — ${escapeMarkdown(roleLabels[wallet.role] ?? wallet.role)}: ${
              wallet.holdingPct === null ? "not measured" : `${wallet.holdingPct.toFixed(2)}%`
            }`
        ),
      devCluster.wallets.length > 10 ? `_…and ${devCluster.wallets.length - 10} more._` : null,
      "",
      "_Burned supply is excluded: tokens sent to a burn address cannot be sold._"
    ]).join("\n");
  }

  // section === "holders" — bold labels with a hard line break between each stat and its group,
  // rather than one dense "A / B / C" line, so it reads at a glance instead of requiring the
  // reader to line up three numbers against three labels themselves.
  const concentration = readHolderConcentration(result);
  return compact([
    "👥 *Holders*",
    "",
    formatHolderCount(result) ? `*Total holders:* ${formatHolderCount(result)}` : null,
    concentration.top10 ? `*Top 10 hold:* ${concentration.top10}` : null,
    concentration.top1 || concentration.top5
      ? `*Top 1 / 5:* ${concentration.top1 || "Not proven"} / ${concentration.top5 || "Not proven"}`
      : null,
    "",
    concentration.deployer ? `*Deployer:* ${concentration.deployer}` : null,
    concentration.owner ? `*Owner:* ${concentration.owner}` : null,
    "",
    concentration.liquidityPool || concentration.burned || concentration.excludedContracts
      ? `*LP / Burned / Excluded:*\n${concentration.liquidityPool || "—"} / ${concentration.burned || "—"} / ${concentration.excludedContracts || "—"}`
      : null,
    "",
    `_${escapeMarkdown(result.holders.message)}_`
  ]).join("\n");
}

/**
 * Findings that change what a holder can actually do with the token, rather than describing a
 * capability the contract merely has. Each is surfaced above the normal metrics because a token
 * can look healthy on every other line and still be one of these.
 */
const criticalAlerts: { code: string; message: string }[] = [
  {
    code: "LEDGER_BALANCE_DELETED",
    message: "This token has deleted holder balances with no transfer. Your tokens can vanish."
  },
  {
    code: "POOL_RESERVE_DESYNC_CRITICAL",
    message: "The pool holds far fewer tokens than it claims. Quoted liquidity is not real."
  },
  {
    code: "TRANSFER_GATE_ALLOWLIST",
    message: "Transfers run through an allowlist. Only pre-approved wallets may be able to sell."
  },
  {
    code: "LEDGER_BALANCE_INFLATED",
    message: "Balances have been created with no transfer, so supply figures cannot be trusted."
  },
  {
    code: "RENOUNCED_BUT_EXTERNALLY_GATED",
    message: "Ownership looks renounced but control remains through a hardcoded address."
  }
];

function criticalAlertBlock(result: ScanResultView): string | null {
  const codes = new Set(result.findings.map((finding) => finding.code));
  const hits = criticalAlerts.filter((alert) => codes.has(alert.code));
  if (hits.length === 0) return null;

  return [
    "⛔️ *Read this first*",
    ...hits.map((alert) => `• ${escapeMarkdown(alert.message)}`),
    ""
  ].join("\n");
}

function deployerBalanceLine(
  deployerBalance: { amountRaw: string | null; pctOfSupply: number | null } | null,
  result: ScanResultView
): string | null {
  if (!deployerBalance) return null;
  const pct = deployerBalance.pctOfSupply;
  const amount =
    deployerBalance.amountRaw === null
      ? null
      : formatTokenAmount(deployerBalance.amountRaw, result.token.decimals ?? null);

  if (pct === null && amount === null) return null;
  const parts = compact([amount, pct === null ? null : `${pct.toFixed(2)}% of supply`]);
  return `💰 Deployer holds: ${parts.join(" · ")}`;
}

function devClusterLine(devCluster: {
  walletCount: number;
  knownHoldingPct: number | null;
  unknownHoldingWalletCount: number;
}): string | null {
  if (devCluster.walletCount === 0) return null;

  const wallets = `${devCluster.walletCount} wallet${devCluster.walletCount === 1 ? "" : "s"}`;
  const held =
    devCluster.knownHoldingPct === null
      ? "holdings unknown"
      : `${devCluster.knownHoldingPct.toFixed(2)}% of supply`;
  // Saying only the measured percentage would understate the cluster when some of its wallets
  // fell outside the holder snapshot, so the gap is stated rather than hidden.
  const gap =
    devCluster.unknownHoldingWalletCount > 0
      ? ` (+${devCluster.unknownHoldingWalletCount} not measured)`
      : "";
  return `🕸️ Dev cluster: ${wallets} · ${held}${gap}`;
}

/** Raw token units are unreadable in a chat message, so this abbreviates to K/M/B. */
function formatTokenAmount(amountRaw: string, decimals: number | null): string | null {
  let value: number;
  try {
    value = Number(BigInt(amountRaw)) / 10 ** (decimals ?? 0);
  } catch {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function riskEmoji(result: ScanResultView): string {
  if (result.risk.level === "LOW") return "🟢";
  if (result.risk.level === "MODERATE") return "🟡";
  if (result.risk.level === "HIGH") return "🟠";
  if (result.risk.level === "CRITICAL") return "🔴";
  return "⚪";
}

function severityEmoji(severity: SecurityFindingView["severity"]): string {
  if (severity === "CRITICAL") return "🔴";
  if (severity === "HIGH") return "🟠";
  if (severity === "MEDIUM") return "🟡";
  if (severity === "LOW") return "🔵";
  return "⚪";
}

/** Escapes legacy Telegram Markdown special characters in dynamic/external text. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

function severityRank(severity: SecurityFindingView["severity"]): number {
  const order: Record<SecurityFindingView["severity"], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    INFO: 0
  };
  return order[severity];
}

function formatRiskLine(result: ScanResultView): string {
  const level = escapeMarkdown(result.risk.level);
  return result.risk.score === null ? level : `${level} | Risk Score: ${result.risk.score}/100`;
}

function formatTokenLabel(result: ScanResultView): string {
  const name = result.token.name?.trim();
  const symbol = result.token.symbol?.trim();

  if (name && symbol) {
    return `${name} ($${symbol})`;
  }

  return name ?? (symbol ? `$${symbol}` : shortenAddress(result.scan.address));
}

function formatOwnershipStatus(result: ScanResultView): string {
  if (result.token.ownershipStatus === "RENOUNCED") return "Renounced";
  if (result.token.ownershipStatus === "ACTIVE") return "Active";
  return "";
}

function formatTokenAge(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  const createdTime = Date.parse(createdAt);
  if (Number.isNaN(createdTime)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - createdTime) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sourceVerifiedLine(result: ScanResultView): string | null {
  if (result.token.sourceVerified === undefined) return null;
  return `📜 Verified: ${result.token.sourceVerified ? "Yes ✅" : "No ❌"}`;
}

function dexPaidLine(result: ScanResultView): string | null {
  if (result.token.dexPaid === undefined) return null;
  return `💳 Dex: ${result.token.dexPaid ? "Paid ✅" : "Not paid"}`;
}

function formatCapability(result: ScanResultView, kind: "BUY" | "SELL"): string | null {
  const simulation = result.simulations.find((run) => run.kind === kind);
  if (
    !simulation ||
    simulation.outcome === "UNSUPPORTED" ||
    simulation.outcome === "DATA_UNAVAILABLE"
  ) {
    return null;
  }
  if (simulation.outcome === "PASSED") return "Yes";
  if (simulation.outcome === "DETECTED" || simulation.outcome === "FAILED") return "No";
  return "Inconclusive";
}

/**
 * How strong the trade evidence behind a honeypot verdict is. A forked run actually executed a
 * buy and a sell; a route quote only confirmed a path exists in pool math and cannot prove a
 * sell would go through. Reporting the two identically is what made "can buy: yes, can sell:
 * yes, honeypot: unknown" read as a contradiction instead of a caveat.
 */
function readSimulationEvidence(result: ScanResultView): "FORK" | "ROUTE_QUOTE" | "NONE" {
  const tools = result.simulations.map((run) => run.simulationTool);
  if (tools.some((tool) => tool.includes("fork"))) return "FORK";
  if (tools.some((tool) => tool.includes("route-quote"))) return "ROUTE_QUOTE";
  return "NONE";
}

function readHoneypotStatus(result: ScanResultView): string | null {
  const simulations = result.simulations;
  if (simulations.length === 0 || simulations.every((run) => run.outcome === "UNSUPPORTED")) {
    return null;
  }

  const honeypotFlag = simulations
    .map((run) => (isRecord(run.result) ? run.result.isHoneypot : undefined))
    .find((value) => typeof value === "boolean");
  const evidence = readSimulationEvidence(result);

  if (typeof honeypotFlag === "boolean") {
    if (honeypotFlag) {
      return evidence === "FORK" ? "🔴 Yes — a forked sell failed" : "🔴 Yes";
    }
    return evidence === "FORK"
      ? "🟢 No — a real buy and sell both executed on a forked chain"
      : "🟢 No";
  }

  // Never upgrade "we did not execute a trade" into a clean bill of health.
  if (evidence === "ROUTE_QUOTE") {
    return "⚪ Unknown — only pool math was checked, no trade was executed";
  }
  return null;
}

function readTaxData(result: ScanResultView): { buy: string; sell: string; transfer: string } {
  const dataByKind = new Map<string, Record<string, unknown>>();
  for (const run of result.simulations) {
    if (isRecord(run.result)) {
      dataByKind.set(run.kind, run.result);
    }
  }

  const buyTaxBps = numberFromRecord(dataByKind.get("BUY"), ["buyTaxBps", "taxBps"]);
  const sellTaxBps = numberFromRecord(dataByKind.get("SELL"), ["sellTaxBps", "taxBps"]);
  const transferTaxBps = numberFromRecord(dataByKind.get("TRANSFER"), ["transferTaxBps", "taxBps"]);

  return {
    buy: formatBps(buyTaxBps),
    sell: formatBps(sellTaxBps),
    transfer: formatBps(transferTaxBps)
  };
}

function capabilityLine(result: ScanResultView): string | null {
  const buy = formatCapability(result, "BUY");
  const sell = formatCapability(result, "SELL");
  if (!buy && !sell) return null;
  return `🔁 Buy / Sell: ${buy ?? "Not proven"} / ${sell ?? "Not proven"}`;
}

/** Above this, a tax stops being a fee and starts being most of your money. */
const punitiveTaxPct = 15;

/**
 * A measured tax is printed as a plain number, which reads as neutral even at 79%. Marking the
 * punitive ones keeps the headline honest: the figure is the risk, and a reader skimming a chat
 * message should not have to do the comparison themselves.
 */
function markPunitiveTax(value: string): string {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= punitiveTaxPct ? `${value} ⚠️` : value;
}

function taxLine(tax: { buy: string; sell: string; transfer: string }): string | null {
  const values = [
    tax.buy ? `B ${markPunitiveTax(tax.buy)}` : null,
    tax.sell ? `S ${markPunitiveTax(tax.sell)}` : null,
    tax.transfer ? `T ${markPunitiveTax(tax.transfer)}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? `🧾 Tax: ${values.join(" | ")}` : null;
}

/** A one-line glance at the same control-surface signals the /Controls button breaks down in
 * full — severity (not the raw yes/no answer) marks "concerning," since ownership_renounced
 * flags concern on answer NO (owner still active), the inverse of every other signal here. */
function controlsSummaryLine(result: ScanResultView): string | null {
  const { signals } = buildTokenSecuritySummary(result);
  const flagged = CONTROLS_SIGNAL_IDS.map((id) => signals.find((signal) => signal.id === id))
    .filter((signal): signal is (typeof signals)[number] => signal !== undefined)
    .filter(
      (signal) =>
        signal.severity === "WARN" || signal.severity === "HIGH" || signal.severity === "CRITICAL"
    );

  if (flagged.length === 0) return "📊 Controls: no concerning flags ✅";
  return `📊 Controls: ${flagged.length} flag${flagged.length === 1 ? "" : "s"} ⚠️ — ${flagged
    .map((signal) => escapeMarkdown(signal.label))
    .join(", ")}`;
}

function scannedAtLine(result: ScanResultView): string | null {
  const lastScannedAt = formatHumanDateTime(result.scan.completedAt ?? result.scan.submittedAt);
  if (!lastScannedAt) return null;

  const firstScannedAt = formatHumanDateTime(result.scan.firstScannedAt);
  // Only show a separate "first scanned" line when it's actually a different, earlier scan —
  // for a token's very first scan the two would be identical, which would just be noise.
  if (firstScannedAt && firstScannedAt !== lastScannedAt) {
    return `🕒 First scanned: ${firstScannedAt}\n🕒 Last scanned: ${lastScannedAt}`;
  }
  return `🕒 Scanned: ${lastScannedAt}`;
}

function tokenAgeLine(result: ScanResultView): string | null {
  const age = formatTokenAge(result.token.contractCreatedAt);
  return age ? `⛓️ Chain: Robinhood | Age: ${age}` : "⛓️ Chain: Robinhood";
}

function marketLine(result: ScanResultView): string | null {
  const marketCap = formatCompactUsd(result.token.marketCapUsd);
  const volume = formatCompactUsd(result.token.volume24hUsd);
  const values = [
    marketCap ? `MCap: ${marketCap}` : null,
    volume ? `Vol 24h: ${volume}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? `📊 ${values.join(" | ")}` : null;
}

function priceLine(result: ScanResultView): string | null {
  const price = formatCompactUsd(result.token.priceUsd);
  return price ? `💵 Price: ${price}` : null;
}

function liquidityLine(liquidity: ReturnType<typeof readLiquidityData>): string | null {
  const values = [
    liquidity.totalUsd ? `Liquidity: ${liquidity.totalUsd}` : null,
    liquidity.healthLabel ? `Health: ${liquidity.healthLabel}` : null,
    liquidity.burnedPct ? `Burn/Lock: ${liquidity.burnedPct}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? `💧 ${values.join(" | ")}` : null;
}

function holdersLine(
  result: ScanResultView,
  concentration: ReturnType<typeof readHolderConcentration>
): string | null {
  const holderCount = formatHolderCount(result);
  const values = [
    holderCount ? `Holders: ${holderCount}` : null,
    concentration.top10 ? `Top 10: ${concentration.top10}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? `👥 ${values.join(" | ")}` : null;
}

const LIQUIDITY_HEALTH_LABEL: Record<LiquidityHealthTier, string> = {
  low: "Low",
  medium: "Medium",
  healthy: "Healthy"
};

function readLiquidityData(
  result: ScanResultView
): { totalUsd: string; burnedPct: string; healthLabel: string } {
  // Uses the same pool-selection and health-tiering rules as the web app
  // (@genesis-sentinel/shared) so Telegram can't independently drift into the same bugs already
  // found and fixed there: picking pools[0] blindly instead of the highest-liquidity pool
  // (verified against $CASHCAT), and a near-zero-dollar pool reading as neutral instead of a
  // clear danger signal when no market cap exists to compute a ratio (verified against $UHOOD).
  const pool = selectPrimaryLiquidityPool(result.liquidity.pools);
  const data = pool?.liquidityData;
  const totalUsd = numberFromRecord(data, ["totalLiquidityUsd", "liquidityUsd", "totalUsd"]);
  const burnedPct = numberFromRecord(data, [
    "lpBurnedOrLockedPct",
    "lpBurnedPct",
    "burnedPct",
    "lockedPct"
  ]);
  const marketCapUsd = result.token.marketCapUsd ? Number(result.token.marketCapUsd) : null;
  const quoteSidePctOfMarketCap =
    totalUsd != null && marketCapUsd != null && marketCapUsd > 0
      ? (totalUsd / 2 / marketCapUsd) * 100
      : null;
  const healthTier = totalUsd != null ? liquidityHealthTier(totalUsd, quoteSidePctOfMarketCap, marketCapUsd) : null;

  return {
    totalUsd: totalUsd != null ? (formatCompactUsd(totalUsd) ?? "") : "",
    burnedPct: burnedPct != null ? `${burnedPct.toFixed(1)}%` : "",
    healthLabel: healthTier ? LIQUIDITY_HEALTH_LABEL[healthTier] : ""
  };
}

function readHolderConcentration(result: ScanResultView): {
  top1: string;
  top5: string;
  top10: string;
  deployer: string;
  owner: string;
  liquidityPool: string;
  burned: string;
  excludedContracts: string;
} {
  const snapshot = result.holders.snapshots[0];
  const concentration = isRecord(snapshot?.concentration) ? snapshot.concentration : undefined;

  const pct = (keys: string[]) => {
    const value = numberFromRecord(concentration, keys);
    return value != null ? `${value.toFixed(1)}%` : "";
  };

  return {
    top1: pct(["top1Pct", "top1Percent"]),
    top5: pct(["top5Pct", "top5Percent"]),
    top10: pct(["top10Pct", "top10Percent"]),
    deployer: pct(["deployerPct", "deployerPercent"]),
    owner: pct(["ownerPct", "ownerPercent"]),
    liquidityPool: pct(["liquidityPoolPct", "liquidityPoolPercent"]),
    burned: pct(["burnedPct", "burnedPercent"]),
    excludedContracts: pct(["excludedContractPct", "excludedContractPercent"])
  };
}

function formatHolderCount(result: ScanResultView): string {
  const snapshot = result.holders.snapshots[0];
  const holderCount = result.token.holderCount ?? snapshot?.holderCount;
  return holderCount === undefined ? "" : holderCount.toLocaleString("en-US");
}

function formatBps(bps: number | null): string {
  return bps != null ? `${(bps / 100).toFixed(1)}%` : "";
}

function numberFromRecord(
  record: Record<string, unknown> | undefined,
  keys: string[]
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shortenAddress(address: string): string {
  // Plain ASCII, not a unicode ellipsis: a mis-encoded "…" here previously produced a garbled
  // multi-byte sequence inside a Markdown code span, which broke Telegram's message parser on
  // every single report ("can't parse entities: Can't find end of the entity..."), causing every
  // reply — /scan, pasted addresses, /result, refresh — to fail with a 500 and the bot going
  // completely silent. Verified live against production logs.
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function createTelegramIdempotencyKey(
  chatId: number | bigint | undefined,
  address: `0x${string}`
): string {
  return `telegram:${chatId?.toString() ?? "unknown"}:${address.toLowerCase()}`;
}

function createTelegramRateLimitKey(
  chatId: number | bigint | undefined,
  fromId: number | bigint | undefined
): string {
  return `chat:${chatId?.toString() ?? "unknown"}:user:${fromId?.toString() ?? "unknown"}`;
}

/**
 * Checks the per chat+user limit first (bounds any single member's rate everywhere), then — only
 * in group/supergroup chats — the aggregate per-chat limit too (bounds total volume a group can
 * generate across all of its members combined). A private chat only ever has one "member" to
 * begin with, so the group-wide check would be redundant there and is skipped.
 */
export function checkTelegramRateLimit(
  scanLimiter: TelegramScanLimiter | undefined,
  groupScanLimiter: TelegramScanLimiter | undefined,
  chat: TelegramChatLike | undefined,
  fromId: number | bigint | undefined
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const perUser = scanLimiter?.check(createTelegramRateLimitKey(chat?.id, fromId));
  if (perUser && !perUser.allowed) return perUser;

  const isGroupChat = chat?.type === "group" || chat?.type === "supergroup";
  if (isGroupChat && groupScanLimiter) {
    const groupWide = groupScanLimiter.check(`group:${chat?.id?.toString() ?? "unknown"}`);
    if (!groupWide.allowed) return groupWide;
  }

  return { allowed: true };
}

function createTelegramScanInput(
  address: `0x${string}`,
  chatId: number | bigint | undefined,
  fromId: number | bigint | undefined
): SubmitScanInput {
  const input: SubmitScanInput = {
    chainId: 4663,
    address,
    idempotencyKey: createTelegramIdempotencyKey(chatId, address)
  };

  if (fromId) {
    input.requestedBy = `telegram:${fromId}`;
  }

  return input;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatTelegramTrackingLine(tracking: { created: boolean }): string {
  return tracking.created
    ? "⭐ added this CA to the chat watchlist."
    : "⭐ this CA is already on the chat watchlist.";
}

async function trackTelegramAddress(
  trackAddress: TelegramTrackAddress | undefined,
  address: `0x${string}`,
  telegramChat: TelegramChatLike | undefined
): Promise<{ item: TrackedTelegramAddress; created: boolean } | undefined> {
  const chat = createTelegramChatIdentity(telegramChat);
  if (!chat || !trackAddress) {
    return undefined;
  }

  return trackAddress({
    chat,
    chainId: 4663,
    address
  });
}

function createTelegramChatIdentity(
  telegramChat: TelegramChatLike | undefined
): TelegramChatIdentity | null {
  if (!telegramChat) {
    return null;
  }

  const chat: TelegramChatIdentity = {
    telegramChatId: BigInt(telegramChat.id),
    type: telegramChat.type
  };

  if (telegramChat.title) {
    chat.title = telegramChat.title;
  }

  return chat;
}

