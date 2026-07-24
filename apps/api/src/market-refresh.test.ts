import { describe, expect, it } from "vitest";
import type { MarketDataProvider, MarketProfile } from "@genesis-sentinel/providers";
import type { RiskSnapshot, ScanResultView } from "@genesis-sentinel/shared";
import { createMarketRefresher } from "./market-refresh.js";

function createProvider(profile: MarketProfile | null): MarketDataProvider {
  return {
    id: "test-provider",
    supportsChain: () => true,
    async getMarketProfile() {
      await Promise.resolve();
      return profile;
    }
  };
}

function createResult(): ScanResultView {
  const risk: RiskSnapshot = {
    chainId: 4663,
    address: "0x0000000000000000000000000000000000000001",
    scannerVersion: "0.1.0",
    status: "UNABLE_TO_ASSESS",
    level: "UNABLE_TO_ASSESS",
    score: null,
    confidence: "LOW",
    categoryScores: [],
    findingContributions: [],
    unableToAssessReasons: [],
    findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    message: "unassessed"
  };

  return {
    scan: {
      scanId: "scan-1",
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      state: "COMPLETED",
      scannerVersion: "0.1.0",
      submittedAt: "2026-07-01T00:00:00.000Z",
      message: "done"
    },
    token: {
      chainId: 4663,
      address: "0x0000000000000000000000000000000000000001",
      priceUsd: "0.01",
      marketCapUsd: "1000000",
      volume24hUsd: "50000",
      dexPaid: false
    },
    detectorChecks: [],
    findings: [],
    liquidity: {
      status: "AVAILABLE",
      pools: [
        {
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          poolAddress: "0x0000000000000000000000000000000000000aaa",
          liquidityData: { totalLiquidityUsd: 100 }
        },
        {
          chainId: 4663,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          poolAddress: "0x0000000000000000000000000000000000000bbb",
          liquidityData: { totalLiquidityUsd: 500 }
        }
      ],
      message: "ok"
    },
    holders: { status: "UNSUPPORTED", snapshots: [], message: "n/a" },
    simulations: [],
    risk
  };
}

describe("createMarketRefresher", () => {
  it("returns the result unchanged when the live lookup finds no profile", async () => {
    const refresh = createMarketRefresher(() => createProvider(null));
    const original = createResult();

    const refreshed = await refresh(original);

    expect(refreshed).toEqual(original);
  });

  it("returns the result unchanged when the live lookup throws", async () => {
    const provider: MarketDataProvider = {
      id: "throwing-provider",
      supportsChain: () => true,
      async getMarketProfile() {
        await Promise.resolve();
        throw new Error("network error");
      }
    };
    const refresh = createMarketRefresher(() => provider);
    const original = createResult();

    const refreshed = await refresh(original);

    expect(refreshed).toEqual(original);
  });

  it("returns the result unchanged when no market provider is resolvable for the chain", async () => {
    const refresh = createMarketRefresher(() => null);
    const original = createResult();

    const refreshed = await refresh(original);

    expect(refreshed).toEqual(original);
  });

  it("resolves the provider for the scan result's own chain, not a fixed chain", async () => {
    const seenChainIds: number[] = [];
    const refresh = createMarketRefresher((chainId) => {
      seenChainIds.push(chainId);
      return createProvider(null);
    });
    const arcResult = { ...createResult(), token: { ...createResult().token, chainId: 5042 } };

    await refresh(arcResult);

    expect(seenChainIds).toEqual([5042]);
  });

  it("overwrites price, market cap, volume, and dex-paid while leaving everything else untouched", async () => {
    const profile: MarketProfile = {
      name: null,
      symbol: null,
      iconUrl: null,
      labels: null,
      priceUsd: "0.02",
      marketCapUsd: "2000000",
      volume24hUsd: "75000",
      liquidityUsd: null,
      pairCreatedAt: null,
      dexPaid: true
    };
    const refresh = createMarketRefresher(() => createProvider(profile));
    const original = createResult();

    const refreshed = await refresh(original);

    expect(refreshed.token).toMatchObject({
      priceUsd: "0.02",
      marketCapUsd: "2000000",
      volume24hUsd: "75000",
      dexPaid: true
    });
    expect(refreshed.liquidity).toEqual(original.liquidity);
    expect(refreshed.findings).toBe(original.findings);
    expect(refreshed.holders).toBe(original.holders);
    expect(refreshed.simulations).toBe(original.simulations);
    expect(refreshed.risk).toBe(original.risk);
  });

  it("updates only the primary (highest-liquidity) pool's figure when a live liquidity value is present", async () => {
    const profile: MarketProfile = {
      name: null,
      symbol: null,
      iconUrl: null,
      labels: null,
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null,
      liquidityUsd: 999,
      pairCreatedAt: null,
      dexPaid: null
    };
    const refresh = createMarketRefresher(() => createProvider(profile));
    const original = createResult();

    const refreshed = await refresh(original);

    const primary = refreshed.liquidity.pools.find(
      (pool) => pool.poolAddress === "0x0000000000000000000000000000000000000bbb"
    );
    const other = refreshed.liquidity.pools.find(
      (pool) => pool.poolAddress === "0x0000000000000000000000000000000000000aaa"
    );

    expect(primary?.liquidityData?.totalLiquidityUsd).toBe(999);
    expect(other?.liquidityData?.totalLiquidityUsd).toBe(100);
  });
});
