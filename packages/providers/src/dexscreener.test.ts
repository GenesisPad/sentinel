import { afterEach, describe, expect, it, vi } from "vitest";
import { createDexScreenerMarketDataProvider } from "./dexscreener.js";

const config = { chainId: 4663, networkSlug: "robinhood" };
const tokenAddress = "0x0000000000000000000000000000000000000001" as const;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function fetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("createDexScreenerMarketDataProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for a chain it does not support", async () => {
    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 1, address: tokenAddress });
    expect(result).toBeNull();
  });

  it("selects the pair with the highest liquidity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        {
          baseToken: { address: tokenAddress, name: "Low Liquidity Pool", symbol: "TOK" },
          liquidity: { usd: 100 },
          priceUsd: "1"
        },
        {
          baseToken: { address: tokenAddress, name: "Token", symbol: "TOK" },
          liquidity: { usd: 50000 },
          priceUsd: "1.5",
          marketCap: 1000000,
          volume: { h24: 20000 },
          pairCreatedAt: 1_700_000_000_000
        }
      ])
    );

    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 4663, address: tokenAddress });

    expect(result?.name).toBe("Token");
    expect(result?.priceUsd).toBe("1.5");
    expect(result?.marketCapUsd).toBe("1000000");
    expect(result?.volume24hUsd).toBe("20000");
    expect(result?.pairCreatedAt).toEqual(new Date(1_700_000_000_000));
  });

  it("returns null when no pairs are returned", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 4663, address: tokenAddress });
    expect(result).toBeNull();
  });

  it("reports dexPaid true only when an approved tokenProfile order exists", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      if (url.includes("/orders/")) {
        return Promise.resolve(
          jsonResponse({
            orders: [{ type: "tokenProfile", status: "approved" }],
            boosts: []
          })
        );
      }
      return Promise.resolve(
        jsonResponse([
          {
            baseToken: { address: tokenAddress, name: "Token", symbol: "TOK" },
            liquidity: { usd: 50000 },
            priceUsd: "1.5"
          }
        ])
      );
    });

    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 4663, address: tokenAddress });

    expect(result?.dexPaid).toBe(true);
  });

  it("reports dexPaid false when orders exist but none are an approved tokenProfile", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      if (url.includes("/orders/")) {
        return Promise.resolve(
          jsonResponse({
            orders: [{ type: "tokenProfile", status: "cancelled" }],
            boosts: []
          })
        );
      }
      return Promise.resolve(
        jsonResponse([
          {
            baseToken: { address: tokenAddress, name: "Token", symbol: "TOK" },
            liquidity: { usd: 50000 },
            priceUsd: "1.5"
          }
        ])
      );
    });

    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 4663, address: tokenAddress });

    expect(result?.dexPaid).toBe(false);
  });

  it("reports dexPaid null when the orders lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      if (url.includes("/orders/")) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(
        jsonResponse([
          {
            baseToken: { address: tokenAddress, name: "Token", symbol: "TOK" },
            liquidity: { usd: 50000 },
            priceUsd: "1.5"
          }
        ])
      );
    });

    const provider = createDexScreenerMarketDataProvider(config);
    const result = await provider.getMarketProfile({ chainId: 4663, address: tokenAddress });

    expect(result?.dexPaid).toBeNull();
  });
});
