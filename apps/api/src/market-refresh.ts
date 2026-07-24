import type { MarketDataProvider } from "@genesis-sentinel/providers";
import { selectPrimaryLiquidityPool, type ScanResultView } from "@genesis-sentinel/shared";

export type RefreshVolatileFields = (result: ScanResultView) => Promise<ScanResultView>;

/**
 * Refreshes only the volatile, fast-changing fields of an already-persisted scan result — price,
 * market cap, 24h volume, dex-paid status, and the primary pool's own liquidity figure — via a
 * live DexScreener lookup, while leaving every detector finding, control check, holder snapshot,
 * and simulation result exactly as persisted. This is what lets a cached read stay fast and free
 * of RPC/worker cost for the expensive parts, while still showing current numbers for the parts
 * that genuinely change minute to minute.
 *
 * Deliberately DexScreener-only, not the full explorer-then-market precedence chain a real scan
 * uses (see collectTokenProfile in apps/worker/src/scan-worker.ts) — that would mean adding a
 * second live RPC/explorer round trip to every cached read just to match a precedence order that
 * mostly agrees anyway. A single fast HTTP call is the right tradeoff for a refresh layer; the
 * full scan is still what a Rerun/fresh scan uses for the authoritative figures.
 *
 * A failed or unavailable live lookup returns the result completely unchanged — a refresh that
 * can't get fresher data is not an error, it's a no-op, never a reason to blank out or guess at
 * a number the last real scan actually measured.
 *
 * Takes a per-chain resolver rather than a single provider — every supported chain (Robinhood,
 * Arc, Stable, ...) has its own DexScreener network slug, so the right provider depends on which
 * chain the scan result is actually for. A chain with no resolvable market provider is a no-op,
 * same as a failed lookup.
 */
export function createMarketRefresher(
  getMarketProvider: (chainId: number) => MarketDataProvider | null
): RefreshVolatileFields {
  return async function refreshVolatileFields(result) {
    const market = getMarketProvider(result.token.chainId);
    if (!market) return result;

    const profile = await market
      .getMarketProfile({ chainId: result.token.chainId, address: result.token.address })
      .catch(() => null);
    if (!profile) return result;

    const refreshedToken = {
      ...result.token,
      ...(profile.priceUsd != null ? { priceUsd: profile.priceUsd } : {}),
      ...(profile.marketCapUsd != null ? { marketCapUsd: profile.marketCapUsd } : {}),
      ...(profile.volume24hUsd != null ? { volume24hUsd: profile.volume24hUsd } : {}),
      ...(profile.dexPaid != null ? { dexPaid: profile.dexPaid } : {})
    };

    const primaryPool =
      profile.liquidityUsd != null ? selectPrimaryLiquidityPool(result.liquidity.pools) : undefined;
    if (!primaryPool) {
      return { ...result, token: refreshedToken };
    }

    return {
      ...result,
      token: refreshedToken,
      liquidity: {
        ...result.liquidity,
        pools: result.liquidity.pools.map((pool) =>
          pool.poolAddress === primaryPool.poolAddress
            ? {
                ...pool,
                liquidityData: { ...pool.liquidityData, totalLiquidityUsd: profile.liquidityUsd }
              }
            : pool
        )
      }
    };
  };
}
