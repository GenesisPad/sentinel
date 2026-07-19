import {
  decimalStringValue,
  fetchJson,
  isRecord,
  numberValue,
  stringValue,
  timestampMsDateValue
} from "./http.js";
import type { MarketDataProvider, MarketProfile } from "./types.js";

export interface DexScreenerChainConfig {
  chainId: number;
  /** DexScreener's network slug for this chain, e.g. "robinhood" */
  networkSlug: string;
}

/**
 * DexScreener supplements Blockscout's explorer price/market-cap data; explorer values take
 * precedence when both are available (see collectTokenProfile in apps/worker). It has no
 * source or holder data, so it only implements MarketDataProvider.
 */
export function createDexScreenerMarketDataProvider(
  config: DexScreenerChainConfig
): MarketDataProvider {
  return {
    id: "dexscreener-market",
    supportsChain: (chainId) => chainId === config.chainId,
    async getMarketProfile({ chainId, address }) {
      if (chainId !== config.chainId) {
        return null;
      }

      const [response, dexPaid] = await Promise.all([
        fetchJson(`https://api.dexscreener.com/token-pairs/v1/${config.networkSlug}/${address}`),
        fetchDexPaidStatus(config.networkSlug, address)
      ]);
      if (!Array.isArray(response)) {
        return null;
      }

      const pairs = response.filter(isRecord);
      if (pairs.length === 0) {
        return null;
      }

      const normalizedAddress = address.toLowerCase();
      const matchingPairs = pairs.filter((pair) => {
        const base = isRecord(pair.baseToken) ? pair.baseToken : null;
        return stringValue(base?.address)?.toLowerCase() === normalizedAddress;
      });
      const bestPair = selectBestPair(matchingPairs.length > 0 ? matchingPairs : pairs);
      if (!bestPair) {
        return null;
      }

      const baseToken = isRecord(bestPair.baseToken) ? bestPair.baseToken : {};
      const info = isRecord(bestPair.info) ? bestPair.info : {};
      const volume = isRecord(bestPair.volume) ? bestPair.volume : {};
      const liquidity = isRecord(bestPair.liquidity) ? bestPair.liquidity : {};
      const labels = Array.isArray(bestPair.labels)
        ? bestPair.labels.filter((label): label is string => typeof label === "string").join(", ")
        : null;

      const profile: MarketProfile = {
        name: stringValue(baseToken.name),
        symbol: stringValue(baseToken.symbol),
        iconUrl: stringValue(info.imageUrl),
        labels,
        priceUsd: decimalStringValue(bestPair.priceUsd),
        marketCapUsd: decimalStringValue(bestPair.marketCap) ?? decimalStringValue(bestPair.fdv),
        volume24hUsd: decimalStringValue(volume.h24),
        liquidityUsd: numberValue(liquidity.usd),
        pairCreatedAt: timestampMsDateValue(bestPair.pairCreatedAt),
        dexPaid
      };

      return profile;
    }
  };
}

/**
 * DexScreener's "DEX Paid" badge means the token has an approved "tokenProfile" (enhanced token
 * info) order — checked via the same endpoint DexScreener's own site uses
 * (https://api.dexscreener.com/orders/v1/{chainId}/{tokenAddress}), not part of the documented
 * public API reference but stable and live-verified. Returns null (not false) on any fetch
 * failure — an unknown paid status is never reported as "not paid".
 */
async function fetchDexPaidStatus(networkSlug: string, address: string): Promise<boolean | null> {
  const response = await fetchJson(
    `https://api.dexscreener.com/orders/v1/${networkSlug}/${address}`
  ).catch(() => null);
  if (!isRecord(response) || !Array.isArray(response.orders)) {
    return null;
  }

  return response.orders.some(
    (order) => isRecord(order) && order.type === "tokenProfile" && order.status === "approved"
  );
}

function selectBestPair(pairs: Record<string, unknown>[]): Record<string, unknown> | null {
  const sorted = [...pairs].sort((a, b) => {
    const aLiquidity = numberValue(isRecord(a.liquidity) ? a.liquidity.usd : undefined) ?? 0;
    const bLiquidity = numberValue(isRecord(b.liquidity) ? b.liquidity.usd : undefined) ?? 0;
    return bLiquidity - aLiquidity;
  });
  return sorted[0] ?? null;
}
