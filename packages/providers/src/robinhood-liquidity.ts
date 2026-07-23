import { decodeEventLog, parseAbi, parseAbiItem, toEventSelector, type Hex } from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import type { LockerProvider, LockStatusResult } from "./locker.js";
import type { DiscoveredPool, LiquidityProvider, LiquidityProviderCoverage } from "./types.js";

export const robinhoodChainId = 4663;

// Verified independently against Blockscout source + a live router.WETH() call — see
// docs/architecture/liquidity.md for provenance.
export const robinhoodUniswapV2FactoryAddress =
  "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f" as const;
export const robinhoodUniswapV2RouterAddress =
  "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" as const;
export const robinhoodUniswapV3FactoryAddress =
  "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
export const robinhoodUniswapV4PoolManagerAddress =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
export const robinhoodUniswapV4StateViewAddress =
  "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;
export const robinhoodWrappedNativeAddress =
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;

export const robinhoodQuoteTokens = [
  {
    address: robinhoodWrappedNativeAddress,
    symbol: "WETH",
    decimals: 18
  },
  {
    address: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
    symbol: "USDE",
    decimals: 18
  },
  {
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    decimals: 6
  }
] as const;

const knownBurnAddresses = [
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000"
] as const;

const uniswapV2FactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)"
]);
const uniswapV3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
]);
const uniswapV2PairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
]);
const uniswapV3PoolAbi = parseAbi([
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)"
]);
const v4StateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)"
]);
const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const uniswapV3FeeTiers = [100, 500, 3000, 10_000] as const;
const uniswapV4InitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);
const uniswapV4InitializeTopic = toEventSelector(uniswapV4InitializeEvent);

export type QuoteTokenPriceLookup = (address: `0x${string}`) => Promise<number | null>;

/**
 * Wraps a price lookup so each unique address is fetched at most once for the lifetime of the
 * returned function, and every concurrent caller for the same address awaits the same in-flight
 * request rather than firing a duplicate one. Scope a fresh wrapper to each `discoverPools` call
 * (never share one across scans) so results stay current — this only dedupes the redundant
 * *concurrent* calls within a single scan, it is not a cross-scan cache.
 */
export function memoizeQuoteTokenPriceLookup(lookup: QuoteTokenPriceLookup): QuoteTokenPriceLookup {
  const cache = new Map<string, Promise<number | null>>();
  return (address) => {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = lookup(address);
    cache.set(key, promise);
    return promise;
  };
}

/**
 * Checks the verified Uniswap V2/V3/V4 contracts on Robinhood Chain for pools against a
 * configured set of quote tokens. USD valuation is best-effort via the injected price
 * lookup (normally the Blockscout explorer provider's getTokenPriceUsd) and is left null,
 * not fabricated, if the lookup fails.
 */
export function createRobinhoodLiquidityProvider(
  getQuoteTokenPriceUsd: QuoteTokenPriceLookup,
  locker: LockerProvider
): LiquidityProvider {
  return {
    id: "robinhood-uniswap-liquidity",
    supportsChain: (chainId) => chainId === robinhoodChainId,
    describeCoverage(): LiquidityProviderCoverage {
      return {
        discoveryTool: "0.1.0-robinhood-uniswap-v2-v3-v4",
        checkedDexes: ["Uniswap V3", "Uniswap V4", "Uniswap V2"],
        checkedQuoteSymbols: robinhoodQuoteTokens.map((quote) => quote.symbol)
      };
    },
    async discoverPools({ adapter, chainId, tokenAddress, blockNumber }) {
      if (chainId !== robinhoodChainId) {
        return [];
      }

      // V3 alone probes every (quote token x fee tier) combination in parallel — up to 4 fee
      // tiers per quote token — so without memoization the SAME quote token's price gets
      // fetched several times concurrently for one scan. A transient failure or rate-limit on
      // just one of those otherwise-identical calls then leaves some pools with a real
      // totalLiquidityUsd and others with null purely by chance, and
      // selectPrimaryLiquidityPool only ever compares pools that HAVE a number — so the
      // genuinely largest pool can lose to a dust pool whose lookup happened to succeed.
      // Verified live against $PONS: the real ~350 ETH ($1.3M) pool's price call failed while a
      // 5-unit-USDG dust pool's call succeeded, so the dust pool won. Memoizing per scan means
      // every pool sharing a quote token gets the exact same success-or-failure outcome.
      const memoizedGetQuoteTokenPriceUsd = memoizeQuoteTokenPriceLookup(getQuoteTokenPriceUsd);

      const [v3Pools, v4Pools, v2Pools] = await Promise.all([
        discoverUniswapV3Liquidity(adapter, tokenAddress, memoizedGetQuoteTokenPriceUsd).catch(() => []),
        discoverUniswapV4Liquidity(adapter, tokenAddress, blockNumber).catch(() => []),
        discoverUniswapV2Liquidity(
          adapter,
          chainId,
          tokenAddress,
          memoizedGetQuoteTokenPriceUsd,
          locker
        ).catch(() => [])
      ]);

      return [...v3Pools, ...v4Pools, ...v2Pools];
    }
  };
}

async function discoverUniswapV2Liquidity(
  adapter: ChainAdapter,
  chainId: number,
  tokenAddress: `0x${string}`,
  getQuoteTokenPriceUsd: QuoteTokenPriceLookup,
  locker: LockerProvider
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .map((quote) =>
          discoverUniswapV2Pool(adapter, chainId, tokenAddress, quote, getQuoteTokenPriceUsd, locker).catch(
            () => null
          )
        )
    )
  );
}

async function discoverUniswapV2Pool(
  adapter: ChainAdapter,
  chainId: number,
  tokenAddress: `0x${string}`,
  quote: (typeof robinhoodQuoteTokens)[number],
  getQuoteTokenPriceUsd: QuoteTokenPriceLookup,
  locker: LockerProvider
): Promise<DiscoveredPool | null> {
  const pairAddress = await adapter
    .readContract<`0x${string}`>({
      address: robinhoodUniswapV2FactoryAddress,
      abi: uniswapV2FactoryAbi,
      functionName: "getPair",
      args: [tokenAddress, quote.address]
    })
    .catch(() => null);

  if (!pairAddress || pairAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const [reserves, token0, lpTotalSupply, burnedBalances] = await Promise.all([
    adapter.readContract<[bigint, bigint, number]>({
      address: pairAddress,
      abi: uniswapV2PairAbi,
      functionName: "getReserves"
    }),
    adapter.readContract<`0x${string}`>({
      address: pairAddress,
      abi: uniswapV2PairAbi,
      functionName: "token0"
    }),
    adapter.readContract<bigint>({
      address: pairAddress,
      abi: uniswapV2PairAbi,
      functionName: "totalSupply"
    }),
    Promise.all(
      knownBurnAddresses.map((burnAddress) =>
        adapter
          .readContract<bigint>({
            address: pairAddress,
            abi: uniswapV2PairAbi,
            functionName: "balanceOf",
            args: [burnAddress]
          })
          .catch(() => 0n)
      )
    )
  ]);

  const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
  const reserveToken = tokenIsToken0 ? reserves[0] : reserves[1];
  const reserveQuote = tokenIsToken0 ? reserves[1] : reserves[0];
  const burnedTotal = burnedBalances.reduce((sum, balance) => sum + balance, 0n);
  const lpBurnedPct =
    lpTotalSupply > 0n ? Number((burnedTotal * 10_000n) / lpTotalSupply) / 100 : null;

  const quotePriceUsd = await getQuoteTokenPriceUsd(quote.address).catch(() => null);
  const totalLiquidityUsd =
    quotePriceUsd !== null
      ? (Number(reserveQuote) / 10 ** quote.decimals) * 2 * quotePriceUsd
      : null;
  const lockStatus = await locker
    .getLockStatus({ adapter, chainId, lpTokenAddress: pairAddress })
    .catch(
      (): LockStatusResult => ({
        status: "UNSUPPORTED",
        reason: "Locker lookup failed."
      })
    );

  return {
    poolAddress: pairAddress,
    dex: "Uniswap V2",
    quoteTokenAddress: quote.address,
    quoteSymbol: quote.symbol,
    quoteDecimals: quote.decimals,
    liquidityData: {
      reserveTokenRaw: reserveToken.toString(),
      reserveQuoteRaw: reserveQuote.toString(),
      protocol: "UNISWAP_V2",
      quoteSymbol: quote.symbol,
      quoteDecimals: quote.decimals,
      lpTotalSupplyRaw: lpTotalSupply.toString(),
      lpBurnedOrLockedRaw: burnedTotal.toString(),
      lpBurnedOrLockedPct: lpBurnedPct,
      totalLiquidityUsd,
      // Only lpBurnedOrLockedPct above is a verified on-chain burn-balance measurement.
      // lockStatus reflects a separate, distinct claim (a real third-party locker contract
      // record) and is UNSUPPORTED until a locker provider is wired for this chain — never
      // inferred from the burn percentage.
      lockStatus
    }
  };
}

async function discoverUniswapV3Liquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  getQuoteTokenPriceUsd: QuoteTokenPriceLookup
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .flatMap((quote) =>
          uniswapV3FeeTiers.map((fee) =>
            discoverUniswapV3Pool(adapter, tokenAddress, quote, fee, getQuoteTokenPriceUsd).catch(
              () => null
            )
          )
        )
    )
  );
}

async function discoverUniswapV3Pool(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  quote: (typeof robinhoodQuoteTokens)[number],
  feeTier: (typeof uniswapV3FeeTiers)[number],
  getQuoteTokenPriceUsd: QuoteTokenPriceLookup
): Promise<DiscoveredPool | null> {
  const poolAddress = await adapter
    .readContract<`0x${string}`>({
      address: robinhoodUniswapV3FactoryAddress,
      abi: uniswapV3FactoryAbi,
      functionName: "getPool",
      args: [tokenAddress, quote.address, feeTier]
    })
    .catch(() => null);

  if (!poolAddress || isZeroAddress(poolAddress)) {
    return null;
  }

  const [liquidity, slot0, token0, token1, fee, tokenBalance, quoteBalance] = await Promise.all([
    adapter.readContract<bigint>({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "liquidity"
    }),
    adapter.readContract<[bigint, number, number, number, number, number, boolean]>({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "slot0"
    }),
    adapter.readContract<`0x${string}`>({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "token0"
    }),
    adapter.readContract<`0x${string}`>({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "token1"
    }),
    adapter.readContract<number>({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "fee"
    }),
    adapter
      .readContract<bigint>({
        address: tokenAddress,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [poolAddress]
      })
      .catch(() => 0n),
    adapter
      .readContract<bigint>({
        address: quote.address,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [poolAddress]
      })
      .catch(() => 0n)
  ]);

  const quotePriceUsd = await getQuoteTokenPriceUsd(quote.address).catch(() => null);
  const totalLiquidityUsd =
    quotePriceUsd !== null
      ? (Number(quoteBalance) / 10 ** quote.decimals) * 2 * quotePriceUsd
      : null;

  return {
    poolAddress,
    dex: "Uniswap V3",
    quoteTokenAddress: quote.address,
    quoteSymbol: quote.symbol,
    quoteDecimals: quote.decimals,
    liquidityData: {
      protocol: "UNISWAP_V3",
      factoryAddress: robinhoodUniswapV3FactoryAddress,
      token0,
      token1,
      fee,
      feeTier,
      liquidityRaw: liquidity.toString(),
      sqrtPriceX96Raw: slot0[0].toString(),
      tick: slot0[1],
      tokenBalanceRaw: tokenBalance.toString(),
      quoteBalanceRaw: quoteBalance.toString(),
      quoteSymbol: quote.symbol,
      quoteDecimals: quote.decimals,
      totalLiquidityUsd
    }
  };
}

async function discoverUniswapV4Liquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  blockNumber: bigint
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .flatMap((quote) => [
          discoverUniswapV4Pool(adapter, tokenAddress, quote, blockNumber, {
            currency0: tokenAddress,
            currency1: quote.address
          }).catch(() => null),
          discoverUniswapV4Pool(adapter, tokenAddress, quote, blockNumber, {
            currency0: quote.address,
            currency1: tokenAddress
          }).catch(() => null)
        ])
    )
  );
}

async function discoverUniswapV4Pool(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  quote: (typeof robinhoodQuoteTokens)[number],
  blockNumber: bigint,
  currencies: { currency0: `0x${string}`; currency1: `0x${string}` }
): Promise<DiscoveredPool | null> {
  const logs = await adapter.getLogs({
    address: robinhoodUniswapV4PoolManagerAddress,
    fromBlock: 0n,
    toBlock: blockNumber,
    topics: [
      uniswapV4InitializeTopic,
      null,
      addressToTopic(currencies.currency0),
      addressToTopic(currencies.currency1)
    ]
  });
  const latest = logs.at(-1);
  if (!latest) {
    return null;
  }

  const decoded = decodeEventLog({
    abi: [uniswapV4InitializeEvent],
    data: latest.data,
    topics: latest.topics as [Hex, ...Hex[]],
    eventName: "Initialize"
  });
  const args = decoded.args;
  const poolId = args.id;
  const [slot0, liquidity] = await Promise.all([
    adapter
      .readContract<[bigint, number, number, number]>({
        address: robinhoodUniswapV4StateViewAddress,
        abi: v4StateViewAbi,
        functionName: "getSlot0",
        args: [poolId]
      })
      .catch(() => [args.sqrtPriceX96, args.tick, 0, args.fee] as [bigint, number, number, number]),
    adapter
      .readContract<bigint>({
        address: robinhoodUniswapV4StateViewAddress,
        abi: v4StateViewAbi,
        functionName: "getLiquidity",
        args: [poolId]
      })
      .catch(() => 0n)
  ]);

  return {
    poolAddress: poolIdToAddress(poolId),
    dex: "Uniswap V4",
    quoteTokenAddress: quote.address,
    quoteSymbol: quote.symbol,
    quoteDecimals: quote.decimals,
    liquidityData: {
      protocol: "UNISWAP_V4",
      poolId,
      poolIdentifierKind: "V4_POOL_ID_TRUNCATED_ADDRESS",
      poolManagerAddress: robinhoodUniswapV4PoolManagerAddress,
      stateViewAddress: robinhoodUniswapV4StateViewAddress,
      currency0: args.currency0,
      currency1: args.currency1,
      fee: args.fee,
      tickSpacing: args.tickSpacing,
      hooks: args.hooks,
      liquidityRaw: liquidity.toString(),
      sqrtPriceX96Raw: slot0[0].toString(),
      tick: slot0[1],
      protocolFee: slot0[2],
      lpFee: slot0[3],
      initializedBlockNumber: latest.blockNumber?.toString() ?? null,
      initializationTxHash: latest.transactionHash,
      quoteSymbol: quote.symbol,
      quoteDecimals: quote.decimals
    }
  };
}

function isZeroAddress(address: `0x${string}`): boolean {
  return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function addressToTopic(address: `0x${string}`): Hex {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function poolIdToAddress(poolId: Hex): `0x${string}` {
  return `0x${poolId.slice(2, 42)}`;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}
