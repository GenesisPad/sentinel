import { describe, expect, it } from "vitest";
import type { ScanProgress, ScanResultView } from "@genesis-sentinel/shared";
import {
  createTelegramScanLimiter,
  createTelegramCallbackKey,
  createTelegramResultKeyboard,
  formatTelegramProgressReply,
  formatTelegramRateLimitReply,
  formatTelegramResultReply,
  formatTelegramSectionReply,
  formatTelegramScanReply,
  formatTelegramTrackedListReply,
  formatTelegramTrackReply,
  formatTelegramUntrackReply,
  parseCommandArgument,
  parseScanAddress
} from "./telegram.js";

describe("telegram scan helpers", () => {
  it("extracts a valid contract address from scan commands", () => {
    expect(parseScanAddress("/scan 0x0000000000000000000000000000000000000001")).toBe(
      "0x0000000000000000000000000000000000000001"
    );
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

  it("formats scan replies without safety guarantees", () => {
    const scan: ScanProgress = {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "QUEUED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan is queued."
    };

    const reply = formatTelegramScanReply(scan);

    expect(reply).toContain("0x0000000000000000000000000000000000000001");
    expect(reply).toContain("Use the buttons below");
    expect(reply).toContain("risk indicators, not guarantees");
    expect(reply.toLowerCase()).not.toContain("safe");
  });

  it("formats scan replies with CA tracking context", () => {
    const scan: ScanProgress = {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "QUEUED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan is queued."
    };

    expect(formatTelegramScanReply(scan, { tracking: { created: true } })).toContain(
      "Tracking: added this CA to the chat watchlist."
    );
    expect(formatTelegramScanReply(scan, { tracking: { created: false } })).toContain(
      "already on the chat watchlist"
    );
  });

  it("formats progress replies with scan state and message", () => {
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

    expect(reply).toContain("State: ANALYZING_CONTRACT");
    expect(reply).toContain("Block: 123");
  });

  it("formats CA tracking replies", () => {
    const scan: ScanProgress = {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "QUEUED",
      scannerVersion: "0.1.0-foundation",
      submittedAt: "2026-07-11T00:00:00.000Z",
      message: "Scan is queued."
    };

    const trackReply = formatTelegramTrackReply(
      {
        created: true,
        item: {
          chainId: 4663,
          address: "0x0000000000000000000000000000000000000001",
          createdAt: "2026-07-11T00:00:00.000Z"
        }
      },
      scan
    );

    expect(trackReply).toContain("Tracking enabled");
    expect(
      formatTelegramUntrackReply("0x0000000000000000000000000000000000000001", true)
    ).toContain("Stopped tracking");
    expect(formatTelegramTrackedListReply([])).toContain("No CAs are tracked");
    expect(
      formatTelegramTrackedListReply([
        {
          chainId: 4663,
          address: "0x0000000000000000000000000000000000000001",
          createdAt: "2026-07-11T00:00:00.000Z"
        }
      ])
    ).toContain("Tracked CAs (1)");
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
    // No fabricated fields — everything the backend hasn't produced reads as unknown, never a guess.
    expect(reply).not.toContain("Unknown");
    expect(reply).not.toContain("N/A");
    expect(reply).not.toContain("KYC");
    expect(reply).not.toContain("Votes");
    expect(reply).not.toContain("Launch MC");
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

    expect(formatTelegramSectionReply("holders", result)).toContain("37.1%");
    expect(formatTelegramSectionReply("taxes", result)).toContain("No measured tax values were returned");
    expect(formatTelegramSectionReply("chart", result)).toContain(
      "Chart links are not configured yet"
    );
  });
});
