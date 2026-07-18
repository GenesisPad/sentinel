import { createHash } from "node:crypto";
import { Bot, InlineKeyboard } from "grammy";
import type {
  TelegramChatIdentity,
  TrackedTelegramAddress,
  TrackTelegramAddressInput
} from "@genesis-sentinel/database";
import type { ScanProgress, ScanResultView, SecurityFindingView } from "@genesis-sentinel/shared";
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
  submitScan: TelegramSubmitScan;
  getScan: TelegramGetScan;
  getScanResult: TelegramGetScanResult;
  trackAddress?: TelegramTrackAddress;
  untrackAddress?: TelegramUntrackAddress;
  listTrackedAddresses?: TelegramListTrackedAddresses;
  scanLimiter?: TelegramScanLimiter;
}) {
  const bot = new Bot(options.token);
  const callbackRegistry: TelegramCallbackRegistry = {
    scanIdsByKey: new Map(),
    keysByScanId: new Map()
  };

  bot.command("start", async (context) => {
    await context.reply(
      [
        "Genesis Sentinel scans Robinhood Chain token contracts and reports persisted evidence-backed findings.",
        "",
        "Commands:",
        "/scan <contract address>",
        "/status <scan id>",
        "/result <scan id>",
        "/track <contract address>",
        "/tracked",
        "/untrack <contract address>"
      ].join("\n")
    );
  });

  bot.command("help", async (context) => {
    await context.reply(
      [
        "Send /scan <contract address> or paste a contract address.",
        "Use /status <scan id> to check progress.",
        "Use /result <scan id> to summarize persisted findings.",
        "Use /track <contract address> to save a CA for this chat.",
        "Use /tracked to list saved CAs.",
        "Use /untrack <contract address> to remove one.",
        "Reports are risk indicators, not guarantees."
      ].join("\n")
    );
  });

  bot.command("scan", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("Send /scan followed by a valid EVM contract address.");
      return;
    }

    const limit = options.scanLimiter?.check(
      createTelegramRateLimitKey(context.chat?.id, context.from?.id)
    );
    if (limit && !limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat?.id,
      fromId: context.from?.id,
      telegramChat: context.chat,
      reply: (text, keyboard) =>
        context.reply(text, {
          parse_mode: "Markdown",
          ...(keyboard ? { reply_markup: keyboard } : {})
        })
    });
  });

  bot.command("track", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("Send /track followed by a valid EVM contract address.");
      return;
    }

    const limit = options.scanLimiter?.check(
      createTelegramRateLimitKey(context.chat?.id, context.from?.id)
    );
    if (limit && !limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    const tracking = await trackTelegramAddress(options.trackAddress, address, context.chat);
    if (!tracking) {
      await context.reply("CA tracking is not configured for this bot yet.");
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat?.id,
      fromId: context.from?.id,
      telegramChat: context.chat,
      tracking,
      prefix: tracking.created
        ? "Tracking enabled for this CA."
        : "This CA is already being tracked.",
      reply: (text, keyboard) =>
        context.reply(text, {
          parse_mode: "Markdown",
          ...(keyboard ? { reply_markup: keyboard } : {})
        })
    });
  });

  bot.command("untrack", async (context) => {
    const address = parseScanAddress(context.message?.text ?? "");
    if (!address) {
      await context.reply("Send /untrack followed by a valid EVM contract address.");
      return;
    }

    const chat = createTelegramChatIdentity(context.chat);
    if (!chat || !options.untrackAddress) {
      await context.reply("CA tracking is not configured for this bot yet.");
      return;
    }

    const result = await options.untrackAddress({ chat, chainId: 4663, address });
    await context.reply(formatTelegramUntrackReply(address, result.removed));
  });

  bot.command("tracked", async (context) => {
    const chat = createTelegramChatIdentity(context.chat);
    if (!chat || !options.listTrackedAddresses) {
      await context.reply("CA tracking is not configured for this bot yet.");
      return;
    }

    const tracked = await options.listTrackedAddresses(chat);
    await context.reply(formatTelegramTrackedListReply(tracked));
  });

  bot.command("status", async (context) => {
    const scanId = parseCommandArgument(context.message?.text ?? "");
    if (!scanId) {
      await context.reply("Send /status followed by a scan ID.");
      return;
    }

    const scan = await options.getScan(scanId);
    await context.reply(
      scan ? formatTelegramProgressReply(scan) : "No scan was found for that ID."
    );
  });

  bot.command("result", async (context) => {
    const scanId = parseCommandArgument(context.message?.text ?? "");
    if (!scanId) {
      await context.reply("Send /result followed by a scan ID.");
      return;
    }

    const result = await options.getScanResult(scanId);
    if (!result) {
      await context.reply("No scan result was found for that ID.");
      return;
    }

    await context.reply(formatTelegramResultReply(result), {
      parse_mode: "Markdown",
      reply_markup: createTelegramResultKeyboard(
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId)
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
        rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId)
      )
    });
    await context.answerCallbackQuery({ text: "Result refreshed." });
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

  bot.callbackQuery(/^section:(holders|taxes|chart):(.+)$/u, async (context) => {
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

    await context.reply(formatTelegramSectionReply(section, result), { parse_mode: "Markdown" });
    await context.answerCallbackQuery();
  });

  bot.on("message:text", async (context) => {
    const address = parseScanAddress(context.message.text);
    if (!address) {
      return;
    }

    const limit = options.scanLimiter?.check(
      createTelegramRateLimitKey(context.chat.id, context.from?.id)
    );
    if (limit && !limit.allowed) {
      await context.reply(formatTelegramRateLimitReply(limit.retryAfterSeconds));
      return;
    }

    await submitScanAndReply({
      address,
      chatId: context.chat.id,
      fromId: context.from?.id,
      telegramChat: context.chat,
      reply: (text, keyboard) =>
        context.reply(text, {
          parse_mode: "Markdown",
          ...(keyboard ? { reply_markup: keyboard } : {})
        })
    });
  });

  async function submitScanAndReply(input: {
    address: `0x${string}`;
    chatId: number | bigint | undefined;
    fromId: number | bigint | undefined;
    telegramChat: TelegramChatLike | undefined;
    tracking?: { item: TrackedTelegramAddress; created: boolean };
    prefix?: string;
    reply(text: string, keyboard?: InlineKeyboard): Promise<unknown>;
  }) {
    const tracking =
      input.tracking ??
      (await trackTelegramAddress(options.trackAddress, input.address, input.telegramChat));
    const scan = await options.submitScan(
      createTelegramScanInput(input.address, input.chatId, input.fromId)
    );
    const result = await waitForTelegramResult(scan.scanId, options.getScanResult);

    if (result) {
      const prefix = input.prefix
        ? `${input.prefix}\n\n`
        : tracking
          ? `${formatTelegramTrackingLine(tracking)}\n\n`
          : "";
      await input.reply(
        `${prefix}${formatTelegramResultReply(result)}`,
        createTelegramResultKeyboard(
          rememberTelegramCallbackScanId(callbackRegistry, result.scan.scanId)
        )
      );
      return;
    }

    const prefix = input.prefix ? `${input.prefix}\n\n` : "";
    await input.reply(
      `${prefix}${formatTelegramScanReply(scan, tracking ? { tracking } : {})}`,
      createTelegramScanKeyboard(rememberTelegramCallbackScanId(callbackRegistry, scan.scanId))
    );
  }

  return bot;
}

function isTelegramResultSection(
  value: string | undefined
): value is "holders" | "taxes" | "chart" {
  return value === "holders" || value === "taxes" || value === "chart";
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

export function formatTelegramScanReply(
  scan: ScanProgress,
  options: { tracking?: { created: boolean } } = {}
): string {
  const block = scan.scanBlockNumber ? `\nBlock: ${scan.scanBlockNumber}` : "";
  const tracked = options.tracking
    ? `Tracking: ${formatTelegramTrackingLine(options.tracking)}`
    : null;

  const lines = [
    `ðŸ›¡ï¸ *Scan submitted*`,
    `ðŸ”Ž State: ${scan.state}`,
    `\`${scan.address}\``,
    `âš™ï¸ Scanner: ${scan.scannerVersion}${block}`,
    "Use the buttons below for progress or report.",
    "_Results are risk indicators, not guarantees._"
  ];

  if (tracked) {
    lines.splice(4, 0, tracked);
  }

  return lines.join("\n");
}

export function formatTelegramRateLimitReply(retryAfterSeconds: number): string {
  return `â³ Too many scan requests. Try again in about ${retryAfterSeconds} seconds.`;
}

export function formatTelegramProgressReply(scan: ScanProgress): string {
  const fields = [
    `ðŸ”Ž *Scan progress*`,
    `State: ${scan.state}`,
    `\`${scan.scanId}\``,
    `Address: \`${scan.address}\``,
    `Message: ${escapeMarkdown(scan.message)}`
  ];

  if (scan.scanBlockNumber) {
    fields.push(`Block: ${scan.scanBlockNumber}`);
  }

  if (scan.completedAt) {
    fields.push(`Completed: ${scan.completedAt}`);
  }

  return fields.join("\n");
}

export function formatTelegramTrackReply(
  tracking: { item: TrackedTelegramAddress; created: boolean },
  scan: ScanProgress
): string {
  return [
    tracking.created ? "Tracking enabled for this CA." : "This CA is already being tracked.",
    `${tracking.item.chainId}:${tracking.item.address}`,
    "",
    formatTelegramScanReply(scan)
  ].join("\n");
}

export function formatTelegramUntrackReply(address: `0x${string}`, removed: boolean): string {
  return removed
    ? `Stopped tracking ${address}.`
    : `That CA was not on this chat watchlist: ${address}`;
}

export function formatTelegramTrackedListReply(items: TrackedTelegramAddress[]): string {
  if (items.length === 0) {
    return "No CAs are tracked in this chat yet. Use /track <contract address> or paste a CA.";
  }

  return [
    `Tracked CAs (${items.length})`,
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
      ? ["*Top risks*", ...topFindings.map((f) => `${severityEmoji(f.severity)} ${escapeMarkdown(f.title)}`)].join("\n")
      : "*Top risks:* none persisted";

  const lines = compact([
    "*Genesis Sentinel*",
    `${escapeMarkdown(formatTokenLabel(result))} ${riskEmoji(result)} *${formatRiskLine(result)}*`,
    `\`${result.scan.address}\``,
    "",
    honeypot ? `Honeypot: ${honeypot}` : null,
    capabilityLine(result),
    taxLine(tax),
    "",
    ownership ? `Owner: ${ownership}${ownerAddress}` : null,
    result.token.deployerAddress ? `Deployer: \`${shortenAddress(result.token.deployerAddress)}\`` : null,
    sourceVerifiedLine(result),
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
    `${result.scan.state} · v${result.scan.scannerVersion}`,
    "_DYOR/NFA. Risk indicator, not a guarantee._"
  ]).filter((line, index, lines) => line !== "" || (lines[index - 1] !== "" && lines[index + 1] !== ""));

  return lines.join("\n");
}
export function createTelegramResultKeyboard(callbackScanId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Chart", `section:chart:${callbackScanId}`)
    .text("Holders", `section:holders:${callbackScanId}`)
    .text("Taxes", `section:taxes:${callbackScanId}`)
    .text("Refresh", `refresh:${callbackScanId}`);
}

export function createTelegramScanKeyboard(callbackScanId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Status", `status:${callbackScanId}`)
    .text("Result", `refresh:${callbackScanId}`);
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

export function formatTelegramSectionReply(
  section: "holders" | "taxes" | "chart",
  result: ScanResultView
): string {
  if (section === "holders") {
    const concentration = readHolderConcentration(result);
    return compact([
      "*Holders*",
      formatHolderCount(result) ? `Count: ${formatHolderCount(result)}` : null,
      concentration.top1 || concentration.top5 || concentration.top10
        ? `Top 1 / 5 / 10: ${concentration.top1 || "Not proven"} / ${concentration.top5 || "Not proven"} / ${concentration.top10 || "Not proven"}`
        : null,
      concentration.deployer || concentration.owner
        ? `Deployer / Owner: ${concentration.deployer || "Not proven"} / ${concentration.owner || "Not proven"}`
        : null,
      concentration.liquidityPool || concentration.burned || concentration.excludedContracts
        ? `LP / Burned / Excluded contracts: ${concentration.liquidityPool || "Not proven"} / ${concentration.burned || "Not proven"} / ${concentration.excludedContracts || "Not proven"}`
        : null,
      "",
      `_${escapeMarkdown(result.holders.message)}_`
    ]).join("\n");
  }

  if (section === "taxes") {
    const tax = readTaxData(result);
    const lines = compact([
      "*Taxes*",
      tax.buy ? `Buy: ${tax.buy}` : null,
      tax.sell ? `Sell: ${tax.sell}` : null,
      tax.transfer ? `Transfer: ${tax.transfer}` : null,
    ]);
    return lines.length > 1
      ? lines.join("\n")
      : "*Taxes*\nNo measured tax values were returned for this scan.";
  }

  return [
    `ðŸ“ˆ *Chart*`,
    `\`${result.scan.address}\``,
    "",
    "_Chart links are not configured yet for Robinhood Chain markets._"
  ].join("\n");
}

function riskEmoji(result: ScanResultView): string {
  if (result.risk.level === "LOW") return "ðŸŸ¢";
  if (result.risk.level === "MODERATE") return "ðŸŸ¡";
  if (result.risk.level === "HIGH") return "ðŸŸ ";
  if (result.risk.level === "CRITICAL") return "ðŸ”´";
  return "âšª";
}

function severityEmoji(severity: SecurityFindingView["severity"]): string {
  if (severity === "CRITICAL") return "ðŸ”´";
  if (severity === "HIGH") return "ðŸŸ ";
  if (severity === "MEDIUM") return "ðŸŸ¡";
  if (severity === "LOW") return "ðŸ”µ";
  return "âšª";
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
  return result.risk.score === null
    ? result.risk.level
    : `${result.risk.level} | Score ${result.risk.score}/100`;
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
  return `Verified: ${result.token.sourceVerified ? "Yes" : "No"}`;
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

function readHoneypotStatus(result: ScanResultView): string | null {
  const simulations = result.simulations;
  if (simulations.length === 0 || simulations.every((run) => run.outcome === "UNSUPPORTED")) {
    return null;
  }

  const honeypotFlag = simulations
    .map((run) => (isRecord(run.result) ? run.result.isHoneypot : undefined))
    .find((value) => typeof value === "boolean");

  if (typeof honeypotFlag === "boolean") {
    return honeypotFlag ? "Detected" : "Not detected";
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
  return `Buy / Sell: ${buy ?? "Not proven"} / ${sell ?? "Not proven"}`;
}

function taxLine(tax: { buy: string; sell: string; transfer: string }): string | null {
  const values = [
    tax.buy ? `B ${tax.buy}` : null,
    tax.sell ? `S ${tax.sell}` : null,
    tax.transfer ? `T ${tax.transfer}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? `Tax: ${values.join(" | ")}` : null;
}

function tokenAgeLine(result: ScanResultView): string | null {
  const age = formatTokenAge(result.token.contractCreatedAt);
  return age ? `Chain: Robinhood | Age: ${age}` : "Chain: Robinhood";
}

function marketLine(result: ScanResultView): string | null {
  const marketCap = formatTelegramUsd(result.token.marketCapUsd);
  const volume = formatTelegramUsd(result.token.volume24hUsd);
  const values = [
    marketCap ? `MCap: ${marketCap}` : null,
    volume ? `Vol 24h: ${volume}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? values.join(" | ") : null;
}

function priceLine(result: ScanResultView): string | null {
  const price = formatTelegramUsd(result.token.priceUsd);
  return price ? `Price: ${price}` : null;
}

function liquidityLine(liquidity: { totalUsd: string; burnedPct: string }): string | null {
  const values = [
    liquidity.totalUsd ? `Liquidity: ${liquidity.totalUsd}` : null,
    liquidity.burnedPct ? `Burn/Lock: ${liquidity.burnedPct}` : null,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? values.join(" | ") : null;
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
  return values.length > 0 ? values.join(" | ") : null;
}

function readLiquidityData(result: ScanResultView): { totalUsd: string; burnedPct: string } {
  const pool = result.liquidity.pools[0];
  const data = pool?.liquidityData;
  const totalUsd = numberFromRecord(data, ["totalLiquidityUsd", "liquidityUsd", "totalUsd"]);
  const burnedPct = numberFromRecord(data, [
    "lpBurnedOrLockedPct",
    "lpBurnedPct",
    "burnedPct",
    "lockedPct"
  ]);

  return {
    totalUsd: totalUsd != null ? (formatTelegramUsd(totalUsd.toString()) ?? "") : "",
    burnedPct: burnedPct != null ? `${burnedPct.toFixed(1)}%` : ""
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
  return address.length > 12 ? `${address.slice(0, 6)}â€¦${address.slice(-4)}` : address;
}

function formatTelegramUsd(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric < 1 ? 8 : 2
  }).format(numeric);
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

async function waitForTelegramResult(
  scanId: string,
  getScanResult: TelegramGetScanResult,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<ScanResultView | null> {
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 1_000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await getScanResult(scanId);
    if (result && terminalScanStates.has(result.scan.state)) {
      return result;
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatTelegramTrackingLine(tracking: { created: boolean }): string {
  return tracking.created
    ? "added this CA to the chat watchlist."
    : "this CA is already on the chat watchlist.";
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

