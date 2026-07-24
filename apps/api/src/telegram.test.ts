import { describe, expect, it } from "vitest";
import type { ScanProgress, ScanResultView } from "@genesis-sentinel/shared";
import {
  checkTelegramRateLimit,
  createTelegramCallbackKey,
  createTelegramResultKeyboard,
  createTelegramScanLimiter,
  createTelegramSectionKeyboard,
  createTelegramTrackedListKeyboard,
  formatScanStageMessage,
  formatTelegramProgressReply,
  formatTelegramRateLimitReply,
  formatTelegramRegisteredUsers,
  formatTelegramResultReply,
  formatTelegramSectionReply,
  formatTelegramTrackedListReply,
  formatTelegramUntrackReply,
  friendlyScanState,
  isTelegramAdmin,
  parseCommandArgument,
  parseScanAddress,
  resolveChartUrl,
  shouldAutoScanTelegramAddress,
  telegramLinkPreviewOptions,
  telegramFullReportUrl,
  TELEGRAM_BOT_COMMANDS,
  type TelegramScanLimiter
} from "./telegram.js";

describe("telegram scan helpers", () => {
  it("disables link previews globally for bot text messages", () => {
    expect(telegramLinkPreviewOptions()).toEqual({
      link_preview_options: { is_disabled: true }
    });
  });

  it("publishes every supported command with a BotFather-compatible description", () => {
    expect(new Set(TELEGRAM_BOT_COMMANDS.map((item) => item.command)).size).toBe(
      TELEGRAM_BOT_COMMANDS.length
    );
    expect(TELEGRAM_BOT_COMMANDS.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        "scan",
        "track",
        "stats",
        "users",
        "charts",
        "activitychart",
        "scanschart"
      ])
    );
    expect(
      TELEGRAM_BOT_COMMANDS.every(
        (item) => /^[a-z0-9_]{1,32}$/u.test(item.command) && item.description.length <= 256
      )
    ).toBe(true);
  });

  it("renders a paginated registered-user directory without exposing raw IDs when usernames exist", () => {
    const text = formatTelegramRegisteredUsers({
      users: [
        {
          telegramUserId: "123",
          username: "alice",
          createdAt: new Date("2026-07-23T12:30:00Z")
        },
        {
          telegramUserId: "456",
          username: null,
          createdAt: new Date("2026-07-23T13:00:00Z")
        }
      ],
      page: 1,
      total: 2,
      totalPages: 1
    });

    expect(text).toContain("@alice");
    expect(text).not.toContain("<code>123</code>");
    expect(text).toContain("<code>456</code>");
    expect(text).toContain("<b>2</b> total");
  });

  it("only recognizes explicitly configured Telegram administrators", () => {
    const admins = new Set(["542602805"]);
    expect(isTelegramAdmin(542602805, admins)).toBe(true);
    expect(isTelegramAdmin(8747821953, admins)).toBe(false);
    expect(isTelegramAdmin(undefined, admins)).toBe(false);
  });

  it("extracts a valid contract address from scan commands", () => {
    expect(parseScanAddress("/scan 0x0000000000000000000000000000000000000001")).toBe(
      "0x0000000000000000000000000000000000000001"
    );
  });

  it("scans token contracts pasted in groups and silently rejects wallet addresses", async () => {
    const token = "0x0000000000000000000000000000000000000001" as const;
    await expect(
      shouldAutoScanTelegramAddress("supergroup", token, () => Promise.resolve(true))
    ).resolves.toBe(true);
    await expect(
      shouldAutoScanTelegramAddress("group", token, () => Promise.resolve(false))
    ).resolves.toBe(false);
    await expect(
      shouldAutoScanTelegramAddress("private", token, () => Promise.resolve(false))
    ).resolves.toBe(false);
  });

  it("extracts command arguments with optional bot mentions", () => {
    expect(parseCommandArgument("/result@GenesisSentinelBot scan-1")).toBe("scan-1");
  });

  it("rate-limits rapid scan submissions during cooldown", () => {
    let currentTime = 1_000;
    const limiter = createTelegramScanLimiter({
      cooldownMs: 15_000,
      burstLimit: 5,
      burstWindowMs: 300_000,
      now: () => currentTime
    });

    expect(limiter.check("chat:1:user:1")).toEqual({ allowed: true });
    currentTime += 1_000;
    expect(limiter.check("chat:1:user:1")).toEqual({
      allowed: false,
      retryAfterSeconds: 14
    });
  });

  it("rate-limits repeated scan submissions within the burst window", () => {
    let currentTime = 1_000;
    const limiter = createTelegramScanLimiter({
      cooldownMs: 0,
      burstLimit: 2,
      burstWindowMs: 60_000,
      now: () => currentTime
    });

    expect(limiter.check("chat:1:user:1")).toEqual({ allowed: true });
    currentTime += 1_000;
    expect(limiter.check("chat:1:user:1")).toEqual({ allowed: true });
    currentTime += 1_000;
    expect(limiter.check("chat:1:user:1")).toEqual({
      allowed: false,
      retryAfterSeconds: 58
    });
  });

  it("formats rate-limit replies", () => {
    expect(formatTelegramRateLimitReply(15)).toContain(
      "Too many scan requests. Try again in about 15 seconds."
    );
  });

  it("uses Telegram-safe callback keys for long scan IDs", () => {
    const scanId =
      "4663:0x32758ae8e02b0a2cb6b802b6aaeaf74158c169f7:a5f06f745be4e421384387d95a3607ef15395c284e564d2a02df476e57767cd4";
    const key = createTelegramCallbackKey(scanId);
    const keyboard = createTelegramResultKeyboard(key) as unknown as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const callbackData = keyboard.inline_keyboard.flat().map((button) => button.callback_data);

    expect(key.length).toBeLessThanOrEqual(16);
    expect(callbackData.every((value) => value.length <= 64)).toBe(true);
  });

  it("formats progress replies with a friendly scan state, never the raw enum string", () => {
    const scan: ScanProgress = {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "ANALYZING_CONTRACT",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan state is ANALYZING_CONTRACT.",
      scanBlockNumber: "123"
    };

    const reply = formatTelegramProgressReply(scan);

    expect(reply).toContain("State: 🔬 Analyzing contract");
    // Only the dedicated State line is asserted here — scan.message is a separate, distinct
    // free-text field from the backend and may legitimately still describe the raw state in its
    // own sentence (escaped, so it can't break Markdown parsing either way).
    const stateLine = reply.split("\n").find((line) => line.startsWith("State:"));
    expect(stateLine).not.toContain("ANALYZING_CONTRACT");
    expect(stateLine).not.toContain("ANALYZING\\_CONTRACT");
    expect(reply).toContain("Block: 123");
  });

  it("formats a completed timestamp as a human-readable date, not a raw ISO string", () => {
    const scan: ScanProgress = {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "COMPLETED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      completedAt: "2026-07-23T01:28:00.000Z",
      message: "Scan state is COMPLETED."
    };

    const reply = formatTelegramProgressReply(scan);

    expect(reply).toContain("Completed: Jul 23, 2026, 1:28 AM UTC");
    expect(reply).not.toContain("2026-07-23T01:28:00.000Z");
  });

  it("maps every backend scan state to a friendly label, never the raw enum", () => {
    expect(friendlyScanState("PARTIALLY_COMPLETED")).not.toContain("PARTIALLY_COMPLETED");
    expect(friendlyScanState("PARTIALLY_COMPLETED")).toContain("Complete");
    expect(friendlyScanState("FAILED")).toContain("Failed");
    expect(friendlyScanState("QUEUED")).toContain("Queued");
    // An unrecognized state still returns something rather than throwing.
    expect(friendlyScanState("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("formats a per-stage progress message keyed to the real backend state", () => {
    expect(formatScanStageMessage("ANALYZING_CONTRACT", null)).toContain("Analyzing contract");
    expect(formatScanStageMessage("SIMULATING_TRADES", null)).toContain("Simulating buy/sell");
  });

  it("folds a tracking confirmation into the first stage message only when provided", () => {
    const withTracking = formatScanStageMessage("QUEUED", "added this CA to the chat watchlist.");
    expect(withTracking).toContain("added this CA to the chat watchlist");

    const withoutTracking = formatScanStageMessage("QUEUED", null);
    expect(withoutTracking).not.toContain("watchlist");
  });

  it("formats CA tracking replies", () => {
    expect(
      formatTelegramUntrackReply("0x0000000000000000000000000000000000000001", true)
    ).toContain("Stopped tracking");
    expect(formatTelegramTrackedListReply([])).toContain("No CAs are tracked");
    const tracked = [
      {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001" as const,
        createdAt: "2026-07-11T00:00:00.000Z"
      }
    ];
    const reply = formatTelegramTrackedListReply(tracked);
    expect(reply).toContain("Tracked CAs (1)");
    expect(reply).toContain("Robinhood");
    expect(reply).not.toContain("chain 4663");

    const callbacks = createTelegramTrackedListKeyboard(tracked).inline_keyboard
      .flat()
      .map((button) => ("callback_data" in button ? button.callback_data : null));
    expect(callbacks).toEqual([
      "trackedview:0x0000000000000000000000000000000000000001",
      "trackedrescan:0x0000000000000000000000000000000000000001"
    ]);
  });

  it("formats result summaries without claiming a guarantee", () => {
    const result: ScanResultView = {
      scan: {
        scanId: "scan-1",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        state: "PARTIALLY_COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-11T00:00:00.000Z",
        message: "Scan state is PARTIALLY_COMPLETED."
      },
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        name: "Example Token",
        symbol: "EXT",
        decimals: 18,
        totalSupply: "1000000",
        holderCount: 123,
        sourceVerified: false
      },
      detectorChecks: [],
      findings: [
        {
          id: "finding-1",
          code: "MINT_CAPABILITY_SURFACE",
          detectorId: "mint-selector-patterns",
          detectorVersion: "0.1.0",
          title: "Mint capability surface detected",
          severity: "MEDIUM",
          category: "CONTRACT_CONTROL",
          confidence: "MEDIUM",
          description: "A mint selector was found.",
          technicalExplanation: "Selector presence is not proof of exploitability.",
          evidence: []
        }
      ],
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
      simulations: [
        {
          id: "simulation-1",
          kind: "BUY",
          outcome: "UNSUPPORTED",
          input: {},
          simulationTool: "0.1.0-unsupported",
          createdAt: "2026-07-11T00:00:00.000Z"
        }
      ],
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        scannerVersion: "0.1.0-foundation",
        status: "AVAILABLE",
        level: "HIGH",
        score: 60,
        confidence: "MEDIUM",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: {
          INFO: 0,
          LOW: 0,
          MEDIUM: 1,
          HIGH: 0,
          CRITICAL: 0
        },
        message: "Persisted risk assessment is available for this scan."
      }
    };

    const reply = formatTelegramResultReply(result);

    expect(reply).toContain("Example Token ($EXT)");
    expect(reply).toContain("HIGH | Risk Score: 60/100");
    expect(reply).toContain("Higher score means greater risk");
    expect(reply).not.toContain("Not simulated yet");
    expect(reply).toContain("Mint capability surface detected");
    expect(reply.toLowerCase()).not.toContain("safe");
    // Never the raw backend state string, per the friendly-state mapping.
    expect(reply).not.toContain("PARTIALLY_COMPLETED");
    expect(reply).not.toContain("N/A");
    expect(reply).not.toContain("KYC");
    expect(reply).not.toContain("Votes");
    expect(reply).not.toContain("Launch MC");
  });

  it("shortens addresses with plain ASCII inside the code span, never a character that can break Telegram's Markdown parser", () => {
    // Reproduces a real production outage: shortenAddress used a mis-encoded "…" that produced
    // a garbled multi-byte sequence inside a Markdown code span. Telegram's parser choked on it
    // ("can't parse entities: Can't find end of the entity..."), so every single reply — /scan,
    // pasted addresses, /result, refresh — failed with a 500 and the bot went completely silent.
    // The line itself may legitimately contain an emoji label (e.g. "🏗️ Deployer:") — only the
    // backtick-delimited address span is what must stay 7-bit ASCII.
    const result: ScanResultView = {
      scan: {
        scanId: "scan-4",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000004",
        state: "COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-19T00:00:00.000Z",
        message: "Scan state is COMPLETED."
      },
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000004",
        deployerAddress: "0x8cfa84924011b19765136baea669ac81fe8bb561"
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
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000004",
        scannerVersion: "0.1.0-foundation",
        status: "UNABLE_TO_ASSESS",
        level: "UNABLE_TO_ASSESS",
        score: null,
        confidence: "LOW",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        message: "No detector findings were produced for this scan."
      }
    };

    const reply = formatTelegramResultReply(result);

    expect(reply).toContain(
      "Deployer: [0x8cfa...b561](https://robinhoodchain.blockscout.com/address/0x8cfa84924011b19765136baea669ac81fe8bb561)"
    );
    const deployerLine = reply.split("\n").find((line) => line.includes("Deployer:"));
    expect(deployerLine).toContain("0x8cfa...b561");
  });

  it("escapes underscores in risk-level enum values, never breaking Telegram's Markdown parser", () => {
    // Reproduces a production outage found alongside the ellipsis and emoji mojibake bugs: risk
    // levels like UNABLE_TO_ASSESS contain literal underscores, which legacy Telegram Markdown
    // treats as unescaped italic delimiters. These values must go through escapeMarkdown(). Scan
    // state no longer renders as a raw enum at all (friendlyScanState replaced it entirely), so
    // that half of the original bug can no longer occur by construction.
    const result: ScanResultView = {
      scan: {
        scanId: "scan-5",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000005",
        state: "PARTIALLY_COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-19T00:00:00.000Z",
        message: "Scan state is PARTIALLY_COMPLETED."
      },
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000005"
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
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000005",
        scannerVersion: "0.1.0-foundation",
        status: "UNABLE_TO_ASSESS",
        level: "UNABLE_TO_ASSESS",
        score: null,
        confidence: "LOW",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        message: "No detector findings were produced for this scan."
      }
    };

    const reply = formatTelegramResultReply(result);

    expect(reply).toContain("UNABLE\\_TO\\_ASSESS");
    // Legacy Markdown entities must be balanced: every unescaped _, *, ` must pair up, or
    // Telegram's parser rejects the whole message and the bot goes silent.
    for (const marker of ["_", "*", "`"]) {
      const unescapedCount = (reply.match(new RegExp(`(?<!\\\\)\\${marker}`, "g")) ?? []).length;
      expect(unescapedCount % 2).toBe(0);
    }
  });

  it("flags negligible liquidity and paid-dex status, using the highest-liquidity pool not pools[0]", () => {
    // Reproduces two real bugs found in the web app and ported here for Telegram, which
    // formats its own report text independently: picking pools[0] instead of the pool with the
    // most real liquidity (verified against $CASHCAT), and a near-zero-dollar pool reading as
    // neutral instead of a clear danger signal when there's no market cap to compute a ratio
    // (verified against $UHOOD).
    const result: ScanResultView = {
      scan: {
        scanId: "scan-2",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002",
        state: "COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-19T00:00:00.000Z",
        message: "Scan state is COMPLETED."
      },
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002",
        name: "Drained Token",
        symbol: "DRND",
        decimals: 18,
        sourceVerified: true,
        dexPaid: true
      },
      detectorChecks: [],
      findings: [],
      liquidity: {
        status: "AVAILABLE",
        message: "Persisted liquidity pools are available for this token.",
        pools: [
          {
            chainId: 4663,
            tokenAddress: "0x0000000000000000000000000000000000000002",
            poolAddress: "0x0000000000000000000000000000000000000010",
            liquidityData: { totalLiquidityUsd: 0.175, lpBurnedOrLockedPct: 100 }
          },
          {
            chainId: 4663,
            tokenAddress: "0x0000000000000000000000000000000000000002",
            poolAddress: "0x0000000000000000000000000000000000000011",
            liquidityData: { totalLiquidityUsd: 0.00001 }
          }
        ]
      },
      holders: {
        status: "UNSUPPORTED",
        snapshots: [],
        message: "Holder analysis is not configured yet."
      },
      simulations: [],
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002",
        scannerVersion: "0.1.0-foundation",
        status: "UNABLE_TO_ASSESS",
        level: "UNABLE_TO_ASSESS",
        score: null,
        confidence: "LOW",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        message: "No detector findings were produced for this scan."
      }
    };

    const reply = formatTelegramResultReply(result);

    expect(reply).toContain("Health: Low");
    expect(reply).toContain("Dex: Paid");
  });

  it("resolves a DexScreener chart URL from the highest-liquidity pool, or undefined when none exist", () => {
    const withPools: ScanResultView["liquidity"] = {
      status: "AVAILABLE",
      message: "ok",
      pools: [
        {
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000002",
          poolAddress: "0x0000000000000000000000000000000000000010",
          liquidityData: { totalLiquidityUsd: 100 }
        },
        {
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000002",
          poolAddress: "0x10cc6bd38112cac182db90b6a71d8bb5939526ba",
          liquidityData: { totalLiquidityUsd: 1_348_082 }
        }
      ]
    };

    const withResult = (liquidity: ScanResultView["liquidity"]): ScanResultView => ({
      scan: {
        scanId: "scan-chart",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002",
        state: "COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-19T00:00:00.000Z",
        message: "ok"
      },
      token: { chainId: 4663, address: "0x0000000000000000000000000000000000000002" },
      detectorChecks: [],
      findings: [],
      liquidity,
      holders: { status: "UNSUPPORTED", snapshots: [], message: "n/a" },
      simulations: [],
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000002",
        scannerVersion: "0.1.0-foundation",
        status: "UNABLE_TO_ASSESS",
        level: "UNABLE_TO_ASSESS",
        score: null,
        confidence: "LOW",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        message: "n/a"
      }
    });

    expect(resolveChartUrl(withResult(withPools))).toBe(
      "https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
    expect(
      resolveChartUrl(withResult({ status: "UNSUPPORTED", pools: [], message: "n/a" }))
    ).toBeUndefined();
  });

  it("adds a Full Report button linking to the web app when webAppUrl is configured", () => {
    const result: ScanResultView = {
      scan: {
        scanId: "scan-3",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000003",
        state: "COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-19T00:00:00.000Z",
        message: "Scan state is COMPLETED."
      },
      token: { chainId: 4663, address: "0x0000000000000000000000000000000000000003" },
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
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000003",
        scannerVersion: "0.1.0-foundation",
        status: "UNABLE_TO_ASSESS",
        level: "UNABLE_TO_ASSESS",
        score: null,
        confidence: "LOW",
        categoryScores: [],
        findingContributions: [],
        unableToAssessReasons: [],
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        message: "No detector findings were produced for this scan."
      }
    };

    const url = telegramFullReportUrl("https://sentinel.genesispad.app/", result);
    expect(url).toBe(`https://sentinel.genesispad.app/token/robinhood/${result.scan.address}`);

    const keyboard = createTelegramResultKeyboard("shortkey", undefined, url);
    const flat = keyboard.inline_keyboard.flat();
    const fullReportButton = flat.find((button) => button.text === "🔗 Full Report");
    expect(fullReportButton && "url" in fullReportButton ? fullReportButton.url : undefined).toBe(
      url
    );
  });

  it("omits the Taxes button (tax figures are already in the main summary) and includes emoji-labeled buttons", () => {
    const keyboard = createTelegramResultKeyboard("shortkey");
    const flat = keyboard.inline_keyboard.flat();
    const labels = flat.map((button) => button.text);

    expect(labels.some((label) => label.toLowerCase().includes("tax"))).toBe(false);
    expect(labels).toContain("📊 Controls");
    expect(labels).toContain("👥 Holders");
    expect(labels).toContain("🕸️ Dev Cluster");
    expect(
      flat.some(
        (button) => "callback_data" in button && button.callback_data === "rescan:shortkey"
      )
    ).toBe(true);
  });

  it("adds a working Chart button only when a chart URL is available", () => {
    const withChart = createTelegramResultKeyboard(
      "shortkey",
      "https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );
    const chartButton = withChart.inline_keyboard
      .flat()
      .find((button) => button.text === "📈 Chart");
    expect(chartButton && "url" in chartButton ? chartButton.url : undefined).toBe(
      "https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba"
    );

    const withoutChart = createTelegramResultKeyboard("shortkey");
    expect(withoutChart.inline_keyboard.flat().some((button) => button.text === "📈 Chart")).toBe(
      false
    );
  });

  it("gives section views a Back button that returns to the summary, plus Rescan Token", () => {
    const keyboard = createTelegramSectionKeyboard("shortkey");
    const flat = keyboard.inline_keyboard.flat();
    const labels = flat.map((button) => button.text);

    expect(labels).toContain("◀️ Back");
    expect(
      flat.some(
        (button) => "callback_data" in button && button.callback_data === "rescan:shortkey"
      )
    ).toBe(true);
    const backButton = flat.find((button) => button.text === "◀️ Back");
    expect(backButton && "callback_data" in backButton ? backButton.callback_data : undefined).toBe(
      "back:shortkey"
    );
  });

  it("formats Telegram report sections", () => {
    const result: ScanResultView = {
      scan: {
        scanId: "scan-1",
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        state: "PARTIALLY_COMPLETED",
        scannerVersion: "0.1.0-foundation",
        submittedAt: "2026-07-11T00:00:00.000Z",
        message: "Scan state is PARTIALLY_COMPLETED."
      },
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        holderCount: 100
      },
      detectorChecks: [],
      findings: [],
      liquidity: {
        status: "UNSUPPORTED",
        pools: [],
        message: "Liquidity discovery is not configured yet."
      },
      holders: {
        status: "AVAILABLE",
        snapshots: [
          {
            chainId: 4663,
            tokenAddress: "0x0000000000000000000000000000000000000001",
            blockNumber: "123",
            holderCount: 100,
            topHolders: {},
            concentration: {
              top10Percent: 37.14
            },
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ],
        message: "Persisted holder snapshots are available for this token."
      },
      simulations: [],
      risk: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        scannerVersion: "0.1.0-foundation",
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
        message: "Overall risk scoring is not available yet."
      }
    };

    const reply = formatTelegramSectionReply("holders", result);
    expect(reply).toContain("37.1%");
    expect(reply).toContain("*Total holders:* 100");
  });

  it("bounds per-user and per-group scan rates independently", () => {
    const scanLimiter: TelegramScanLimiter = {
      check: (key) =>
        key.includes("user:1") ? { allowed: false, retryAfterSeconds: 9 } : { allowed: true }
    };
    const groupScanLimiter: TelegramScanLimiter = {
      check: () => ({ allowed: false, retryAfterSeconds: 20 })
    };

    // A per-user violation is reported even in a private chat, where the group limiter never runs.
    const privateChat = { id: 1, type: "private" };
    expect(checkTelegramRateLimit(scanLimiter, groupScanLimiter, privateChat, 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 9
    });

    // A different, not-individually-limited user in a group still gets blocked by the aggregate
    // group-wide limit — this is the whole point of a separate group limiter.
    const groupChat = { id: 2, type: "supergroup" };
    expect(checkTelegramRateLimit(scanLimiter, groupScanLimiter, groupChat, 2)).toEqual({
      allowed: false,
      retryAfterSeconds: 20
    });

    // The same not-individually-limited user in a private chat is unaffected by the group
    // limiter, since it is never consulted outside group/supergroup chats.
    expect(
      checkTelegramRateLimit(scanLimiter, groupScanLimiter, { id: 3, type: "private" }, 2)
    ).toEqual({
      allowed: true
    });
  });
});

describe("telegram report informativeness", () => {
  const baseResult = (overrides: Partial<ScanResultView> = {}): ScanResultView => ({
    scan: {
      scanId: "scan-info",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "COMPLETED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-22T00:00:00.000Z",
      message: "Scan state is COMPLETED."
    },
    token: {
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      name: "Example",
      symbol: "EXA",
      decimals: 9,
      totalSupply: "1000000000000000000",
      deployerAddress: "0x00000000000000000000000000000000000000d1",
      sourceVerified: true
    },
    detectorChecks: [],
    findings: [],
    liquidity: { status: "UNSUPPORTED", pools: [], message: "n/a" },
    holders: {
      status: "AVAILABLE",
      snapshots: [
        {
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          blockNumber: "100",
          topHolders: {},
          concentration: { deployerPct: 12.5, deployerBalanceRaw: "125000000000000000" },
          createdAt: "2026-07-22T00:00:00.000Z"
        }
      ],
      message: "ok"
    },
    simulations: [],
    risk: {
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      scannerVersion: "0.1.0-foundation",
      status: "AVAILABLE",
      level: "CRITICAL",
      score: 100,
      confidence: "HIGH",
      categoryScores: [],
      findingContributions: [],
      unableToAssessReasons: [],
      findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
      message: "ok"
    },
    ...overrides
  });

  it("does not show owner-only control flags as concerning after ownership is renounced", () => {
    const result = baseResult({
      token: {
        chainId: 4663,
        address: "0x0000000000000000000000000000000000000001",
        ownershipStatus: "RENOUNCED"
      },
      findings: [
        {
          id: "blacklist-1",
          code: "BLACKLIST_CAPABILITY_SURFACE",
          detectorId: "blacklist-selector-patterns",
          detectorVersion: "1.0.0",
          title: "Blacklist capability surface detected",
          severity: "HIGH",
          category: "TRADING_SAFETY",
          confidence: "MEDIUM",
          description: "Owner-only blacklist capability.",
          technicalExplanation: "Selector evidence.",
          evidence: []
        }
      ]
    });

    expect(formatTelegramResultReply(result)).not.toContain("Blacklist capability");
    expect(formatTelegramResultReply(result)).toContain("Controls: no concerning flags");
  });

  const simulation = (tool: string, result: Record<string, unknown>) => [
    {
      id: "sim-buy",
      kind: "BUY" as const,
      outcome: "PASSED" as const,
      input: {},
      result,
      simulationTool: tool,
      createdAt: "2026-07-22T00:00:00.000Z"
    }
  ];

  it("says a honeypot verdict came from a real forked trade", () => {
    const reply = formatTelegramResultReply(
      baseResult({ simulations: simulation("0.1.0-ganache-fork", { isHoneypot: false }) })
    );

    expect(reply).toContain("Honeypot: 🟢 No");
    expect(reply).toContain("forked chain");
  });

  it("does not present an unexecuted trade as a clean honeypot result", () => {
    const reply = formatTelegramResultReply(
      baseResult({ simulations: simulation("0.1.0-uniswap-v2-route-quote", {}) })
    );

    // Route-quote only proves a path exists in pool math; it must not read as "not a honeypot".
    expect(reply).toContain("Unknown");
    expect(reply).toContain("no trade was executed");
    expect(reply).not.toContain("🟢 No");
  });

  it("leads with an unmissable warning when balances can be deleted", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        findings: [
          {
            id: "f1",
            code: "LEDGER_BALANCE_DELETED",
            detectorId: "ledger-integrity",
            detectorVersion: "0.1.0",
            title: "Token deletes holder balances without emitting Transfer events",
            severity: "CRITICAL",
            category: "CONTRACT_CONTROL",
            confidence: "HIGH",
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      })
    );

    expect(reply).toContain("Read this first");
    expect(reply).toContain("Your tokens can vanish.");
    // The alert must appear before the routine metrics, not buried under them.
    expect(reply.indexOf("Read this first")).toBeLessThan(reply.indexOf("Deployer"));
  });

  it("reports the deployer's actual holdings, not just the address", () => {
    const reply = formatTelegramResultReply(baseResult());

    expect(reply).toContain("Deployer holds:");
    expect(reply).toContain("12.50% of supply");
  });

  it("flags a punitive tax instead of printing it as a neutral number", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        simulations: simulation("0.1.0-ganache-fork", {
          isHoneypot: false,
          buyTaxBps: 7955,
          sellTaxBps: 0
        })
      })
    );

    expect(reply).toMatch(/B 79\.5% ⚠️/u);
    // A normal 0% sell tax should stay unmarked.
    expect(reply).not.toMatch(/S 0\.0% ⚠️/u);
  });

  it("abbreviates market cap and volume instead of printing every digit", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        token: {
          ...baseResult().token,
          marketCapUsd: "25000000",
          volume24hUsd: "50500"
        }
      })
    );

    expect(reply).toContain("MCap: $25m");
    expect(reply).toContain("Vol 24h: $50.5k");
    expect(reply).not.toContain("$25,000,000");
    expect(reply).not.toContain("$50,500");
  });

  it("shows a human-readable scanned-at date instead of a raw ISO timestamp", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        scan: { ...baseResult().scan, completedAt: "2026-07-23T01:28:00.000Z" }
      })
    );

    expect(reply).toContain("Scanned: Jul 23, 2026, 1:28 AM UTC");
    expect(reply).not.toContain("2026-07-23T01:28:00.000Z");
  });

  it("shows both first- and last-scanned dates when they differ", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        scan: {
          ...baseResult().scan,
          completedAt: "2026-07-23T01:28:00.000Z",
          firstScannedAt: "2026-01-01T00:00:00.000Z"
        }
      })
    );

    expect(reply).toContain("First scanned: Jan 1, 2026, 12:00 AM UTC");
    expect(reply).toContain("Last scanned: Jul 23, 2026, 1:28 AM UTC");
  });

  it("shows a single scanned-at line when this is the token's first scan", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        scan: {
          ...baseResult().scan,
          completedAt: "2026-07-23T01:28:00.000Z",
          firstScannedAt: "2026-07-23T01:28:00.000Z"
        }
      })
    );

    expect(reply).toContain("🕒 Scanned: Jul 23, 2026, 1:28 AM UTC");
    expect(reply).not.toContain("First scanned");
  });

  it("renders a dev cluster section with per-wallet holdings", () => {
    const reply = formatTelegramSectionReply("cluster", baseResult());

    expect(reply).toContain("Dev cluster");
    expect(reply).toContain("deployer");
    expect(reply).toContain("12.50%");
    expect(reply).toContain("Burned supply is excluded");
  });

  it("surfaces a compact controls flag count inline when a control surface is detected", () => {
    const reply = formatTelegramResultReply(
      baseResult({
        findings: [
          {
            id: "f1",
            code: "SOURCE_MINT_OR_SUPPLY_CONTROL",
            detectorId: "source-code-risk-patterns",
            detectorVersion: "0.1.0",
            title: "Source code exposes mint or supply-control functions",
            severity: "HIGH",
            category: "CONTRACT_CONTROL",
            confidence: "HIGH",
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      })
    );

    expect(reply).toContain("Controls: 1 flag");
    expect(reply).toContain("Can create more tokens");
  });

  it("labels active ownership as not renounced in the controls warning", () => {
    const result = baseResult();
    result.token.ownershipStatus = "ACTIVE";
    result.token.ownerAddress = "0x00000000000000000000000000000000000000d1";

    const reply = formatTelegramResultReply(result);

    expect(reply).toContain("Controls: 1 flag");
    expect(reply).toContain("Ownership not renounced");
    expect(reply).not.toContain("— Ownership renounced");
    expect(reply).toContain(
      "Owner: Active ([0x0000...00d1](https://robinhoodchain.blockscout.com/address/0x00000000000000000000000000000000000000d1))"
    );
  });

  it("reports no concerning control flags when nothing was detected", () => {
    const reply = formatTelegramResultReply(baseResult());
    expect(reply).toContain("Controls: no concerning flags");
  });

  it("breaks down every control-surface signal in the dedicated Controls section", () => {
    const reply = formatTelegramSectionReply(
      "controls",
      baseResult({
        findings: [
          {
            id: "f1",
            code: "SOURCE_MINT_OR_SUPPLY_CONTROL",
            detectorId: "source-code-risk-patterns",
            detectorVersion: "0.1.0",
            title: "Source code exposes mint or supply-control functions",
            severity: "HIGH",
            category: "CONTRACT_CONTROL",
            confidence: "HIGH",
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      })
    );

    expect(reply).toContain("Contract controls");
    expect(reply).toContain("Can create more tokens: Yes");
    // Signals with no evidence either way must read as unresolved, never a false "No".
    expect(reply).toContain("Can block wallets: Unknown");
  });
});
