import {
  decodeEventLog,
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Hex
} from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import type { ScanRepository } from "@genesis-sentinel/database";
import type { ScanJobData } from "@genesis-sentinel/queue";
import type {
  ContractSourceDetectorInput,
  DetectorResult,
  SimulationResult
} from "@genesis-sentinel/security-engine";
import {
  createUnsupportedHolderAnalysis,
  createUnsupportedLiquidityDiscovery,
  createUnsupportedTradeSimulations,
  runFoundationDetectors,
  scoreFindings,
  sourceCodeRiskDetector
} from "@genesis-sentinel/security-engine";
import { scannerVersion } from "@genesis-sentinel/shared";

const robinhoodBlockscoutApiUrl = "https://robinhoodchain.blockscout.com/api/v2";

// Verified independently against Blockscout source + a live router.WETH() call — see
// docs/architecture/liquidity.md for provenance.
const robinhoodUniswapV2FactoryAddress = "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f" as const;
const robinhoodUniswapV2RouterAddress = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" as const;
const robinhoodUniswapV3FactoryAddress = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
const robinhoodUniswapV4PoolManagerAddress = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const robinhoodUniswapV4StateViewAddress = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;
const robinhoodWrappedNativeAddress = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;
const sentinelStaticCallWallet = "0x0000000000000000000000000000000000001001" as const;
const robinhoodQuoteTokens = [
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

const ownableAbi = parseAbi(["function owner() view returns (address)"]);
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
const uniswapV2RouterAbi = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) payable"
]);
const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const uniswapV3FeeTiers = [100, 500, 3000, 10_000] as const;
const uniswapV4InitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);
const uniswapV4InitializeTopic = toEventSelector(uniswapV4InitializeEvent);

async function readOwnerAddress(
  adapter: ChainAdapter,
  address: `0x${string}`
): Promise<`0x${string}` | null> {
  try {
    return await adapter.readContract<`0x${string}`>({
      address,
      abi: ownableAbi,
      functionName: "owner"
    });
  } catch {
    return null;
  }
}

interface DiscoveredPool {
  poolAddress: `0x${string}`;
  dex: string;
  quoteTokenAddress: `0x${string}`;
  quoteSymbol: string;
  quoteDecimals: number;
  liquidityData: Record<string, unknown>;
}

async function discoverRobinhoodLiquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  blockNumber: bigint
): Promise<DiscoveredPool[]> {
  const [v3Pools, v4Pools, v2Pools] = await Promise.all([
    discoverRobinhoodUniswapV3Liquidity(adapter, tokenAddress).catch(() => []),
    discoverRobinhoodUniswapV4Liquidity(adapter, tokenAddress, blockNumber).catch(() => []),
    discoverRobinhoodUniswapV2Liquidity(adapter, tokenAddress).catch(() => [])
  ]);

  return [...v3Pools, ...v4Pools, ...v2Pools];
}

/**
 * Checks the verified Uniswap V2 Factory on Robinhood Chain for pairs against configured
 * quote tokens, then reads reserves and how much of the LP supply sits at burn addresses.
 */
async function discoverRobinhoodUniswapV2Liquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .map((quote) =>
          discoverRobinhoodUniswapV2Pool(adapter, tokenAddress, quote).catch(() => null)
        )
    )
  );
}

async function discoverRobinhoodUniswapV2Pool(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  quote: (typeof robinhoodQuoteTokens)[number]
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

  // Best-effort USD valuation via the quote token's own Blockscout price (2x reserveQuote,
  // since AMM pool value splits ~evenly between the two sides). Null, not fabricated, if
  // the price lookup fails.
  const quotePriceUsd = await fetchExplorerTokenPrice(quote.address).catch(() => null);
  const totalLiquidityUsd =
    quotePriceUsd !== null
      ? (Number(reserveQuote) / 10 ** quote.decimals) * 2 * quotePriceUsd
      : null;

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
      totalLiquidityUsd
    }
  };
}

async function discoverRobinhoodUniswapV3Liquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .flatMap((quote) =>
          uniswapV3FeeTiers.map((fee) =>
            discoverRobinhoodUniswapV3Pool(adapter, tokenAddress, quote, fee).catch(() => null)
          )
        )
    )
  );
}

async function discoverRobinhoodUniswapV3Pool(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  quote: (typeof robinhoodQuoteTokens)[number],
  feeTier: (typeof uniswapV3FeeTiers)[number]
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

  const quotePriceUsd = await fetchExplorerTokenPrice(quote.address).catch(() => null);
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

async function discoverRobinhoodUniswapV4Liquidity(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  blockNumber: bigint
): Promise<DiscoveredPool[]> {
  return compact(
    await Promise.all(
      robinhoodQuoteTokens
        .filter((quote) => quote.address.toLowerCase() !== tokenAddress.toLowerCase())
        .flatMap((quote) => [
          discoverRobinhoodUniswapV4Pool(adapter, tokenAddress, quote, blockNumber, {
            currency0: tokenAddress,
            currency1: quote.address
          }).catch(() => null),
          discoverRobinhoodUniswapV4Pool(adapter, tokenAddress, quote, blockNumber, {
            currency0: quote.address,
            currency1: tokenAddress
          }).catch(() => null)
        ])
    )
  );
}

async function discoverRobinhoodUniswapV4Pool(
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

async function fetchExplorerTokenPrice(address: `0x${string}`): Promise<number | null> {
  const token = await fetchJson(`${robinhoodBlockscoutApiUrl}/tokens/${address}`);
  if (!isRecord(token)) {
    return null;
  }
  const price = decimalStringValue(token.exchange_rate);
  return price !== null ? Number(price) : null;
}

interface DiscoveredHolderSnapshot {
  holderCount: number | null;
  topHolders: EnrichedHolder[];
  concentration: HolderConcentration;
}

interface EnrichedHolder {
  address: `0x${string}`;
  balanceRaw: string;
  isContract: boolean;
  labels: string[];
  totalSupplyPct: number;
}

interface HolderConcentration extends Record<string, unknown> {
  top1Pct: number;
  top5Pct: number;
  top10Pct: number;
  top1Address: `0x${string}` | null;
  deployerPct: number | null;
  ownerPct: number | null;
  liquidityPoolPct: number;
  burnedPct: number;
  excludedContractPct: number;
  suspiciousFlags: string[];
}

/**
 * Uses Blockscout's token holders endpoint (Robinhood Chain only) to rank real balances —
 * no fabricated distribution. Contract-owned balances (pools, lockers) are excluded so the
 * percentages reflect wallet concentration, matching "excluding pools" in the UI.
 */
async function discoverRobinhoodHolderConcentration(
  address: `0x${string}`,
  totalSupply: string | null,
  context: {
    holderCount?: number | null;
    deployerAddress?: `0x${string}` | null;
    ownerAddress?: `0x${string}` | null;
    liquidityPoolAddresses?: `0x${string}`[];
  } = {}
): Promise<DiscoveredHolderSnapshot | null> {
  if (!totalSupply || totalSupply === "0") {
    return null;
  }

  const holders = await fetchJson(
    `${robinhoodBlockscoutApiUrl}/tokens/${address}/holders?items_count=25`
  );
  if (!isRecord(holders) || !Array.isArray(holders.items)) {
    return null;
  }

  const rows = holders.items
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const addressRecord = isRecord(item.address) ? item.address : {};
      return {
        address: addressValue(addressRecord.hash),
        balanceRaw: stringValue(item.value),
        isContract: booleanValue(addressRecord.is_contract) ?? false
      };
    })
    .filter(
      (row): row is { address: `0x${string}`; balanceRaw: string; isContract: boolean } =>
        row.address !== null && row.balanceRaw !== null
    );

  let total: bigint;
  try {
    total = BigInt(totalSupply);
  } catch {
    return null;
  }
  if (total === 0n) {
    return null;
  }

  const normalizedBurnAddresses = knownBurnAddresses.map((burnAddress) =>
    burnAddress.toLowerCase()
  );
  const normalizedPools = (context.liquidityPoolAddresses ?? []).map((pool) => pool.toLowerCase());
  const normalizedDeployer = context.deployerAddress?.toLowerCase();
  const normalizedOwner = context.ownerAddress?.toLowerCase();
  const pctOfBalance = (balanceRaw: string): number => {
    try {
      return Number((BigInt(balanceRaw) * 10_000n) / total) / 100;
    } catch {
      return 0;
    }
  };
  const pctOfRows = (candidateRows: typeof rows): number => {
    const sum = candidateRows.reduce((acc, row) => acc + BigInt(row.balanceRaw), 0n);
    return Number((sum * 10_000n) / total) / 100;
  };
  const enrichedRows: EnrichedHolder[] = rows.map((row) => {
    const normalized = row.address.toLowerCase();
    const labels: string[] = [];
    if (normalized === normalizedDeployer) labels.push("DEPLOYER");
    if (normalized === normalizedOwner) labels.push("OWNER");
    if (normalizedBurnAddresses.includes(normalized)) labels.push("BURN");
    if (normalizedPools.includes(normalized)) labels.push("LIQUIDITY_POOL");
    labels.push(row.isContract ? "CONTRACT" : "EOA");

    return {
      ...row,
      labels,
      totalSupplyPct: pctOfBalance(row.balanceRaw)
    };
  });
  const distributionRows = enrichedRows.filter(
    (row) =>
      !row.isContract && !row.labels.includes("BURN") && !row.labels.includes("LIQUIDITY_POOL")
  );
  const pctOfTopN = (n: number): number => {
    const sum = distributionRows.slice(0, n).reduce((acc, row) => acc + BigInt(row.balanceRaw), 0n);
    return Number((sum * 10_000n) / total) / 100;
  };
  const deployerPct = normalizedDeployer
    ? (enrichedRows.find((row) => row.address.toLowerCase() === normalizedDeployer)
        ?.totalSupplyPct ?? 0)
    : null;
  const ownerPct = normalizedOwner
    ? (enrichedRows.find((row) => row.address.toLowerCase() === normalizedOwner)?.totalSupplyPct ??
      0)
    : null;
  const liquidityPoolPct = pctOfRows(
    enrichedRows.filter((row) => row.labels.includes("LIQUIDITY_POOL"))
  );
  const burnedPct = pctOfRows(enrichedRows.filter((row) => row.labels.includes("BURN")));
  const excludedContractPct = pctOfRows(enrichedRows.filter((row) => row.isContract));
  const top1Pct = pctOfTopN(1);
  const top5Pct = pctOfTopN(5);
  const top10Pct = pctOfTopN(10);
  const suspiciousFlags = [
    ...(top1Pct >= 20 ? ["TOP_1_WALLET_HIGH"] : []),
    ...(top10Pct >= 60 ? ["TOP_10_WALLETS_CRITICAL"] : []),
    ...(top10Pct >= 35 && top10Pct < 60 ? ["TOP_10_WALLETS_HIGH"] : []),
    ...(deployerPct !== null && deployerPct >= 5 ? ["DEPLOYER_BALANCE_HIGH"] : []),
    ...(ownerPct !== null && ownerPct >= 5 ? ["OWNER_BALANCE_HIGH"] : [])
  ];

  return {
    holderCount: context.holderCount ?? null,
    topHolders: enrichedRows.slice(0, 25),
    concentration: {
      top1Pct,
      top5Pct,
      top10Pct,
      top1Address: distributionRows[0]?.address ?? null,
      deployerPct,
      ownerPct,
      liquidityPoolPct,
      burnedPct,
      excludedContractPct,
      suspiciousFlags
    }
  };
}

function createHolderConcentrationDetectorResult(input: {
  address: `0x${string}`;
  blockNumber: bigint;
  snapshot: DiscoveredHolderSnapshot;
}): DetectorResult {
  const detector = {
    id: "holder-concentration",
    version: "0.1.0",
    name: "Holder concentration",
    description:
      "Analyzes top holder distribution, deployer/owner balances, and excluded pool/burn wallets."
  };
  const evidence = {
    type: "HOLDER_DATA" as const,
    summary: "Blockscout holder snapshot with pool, burn, contract, deployer, and owner labels.",
    data: {
      holderCount: input.snapshot.holderCount,
      topHolders: input.snapshot.topHolders,
      concentration: input.snapshot.concentration
    },
    blockNumber: input.blockNumber,
    address: input.address
  };
  const findings: DetectorResult["findings"] = [];

  if (input.snapshot.concentration.top10Pct >= 60) {
    findings.push({
      code: "TOP_HOLDER_CONCENTRATION_CRITICAL",
      detectorId: detector.id,
      detectorVersion: detector.version,
      title: "Top wallets control a critical share of supply",
      severity: "HIGH",
      category: "DISTRIBUTION_RISK",
      confidence: "HIGH",
      description:
        "The top 10 non-pool wallets control at least 60% of token supply, creating severe sell-pressure and manipulation risk.",
      technicalExplanation:
        "Genesis Sentinel excludes known burn, pool, and contract-held balances before summing top holder concentration.",
      evidence: [evidence],
      recommendation:
        "Treat the token as high distribution risk unless the wallets are independently explained and verifiably locked or vested."
    });
  } else if (input.snapshot.concentration.top10Pct >= 35) {
    findings.push({
      code: "TOP_HOLDER_CONCENTRATION_HIGH",
      detectorId: detector.id,
      detectorVersion: detector.version,
      title: "Top wallets control an elevated share of supply",
      severity: "MEDIUM",
      category: "DISTRIBUTION_RISK",
      confidence: "HIGH",
      description:
        "The top 10 non-pool wallets control at least 35% of token supply, which can increase dump or coordinated-wallet risk.",
      technicalExplanation:
        "Genesis Sentinel excludes known burn, pool, and contract-held balances before summing top holder concentration.",
      evidence: [evidence],
      recommendation:
        "Review the top holders before investing and watch for linked deployer or team wallets."
    });
  }

  if ((input.snapshot.concentration.deployerPct ?? 0) >= 5) {
    findings.push({
      code: "DEPLOYER_BALANCE_HIGH",
      detectorId: detector.id,
      detectorVersion: detector.version,
      title: "Deployer wallet still holds a material supply share",
      severity: "HIGH",
      category: "DISTRIBUTION_RISK",
      confidence: "HIGH",
      description: "The deployer wallet appears in the holder snapshot with at least 5% of supply.",
      technicalExplanation:
        "The deployer address from explorer metadata was matched against the token holder list.",
      evidence: [evidence],
      recommendation:
        "Require a clear vesting, lock, or team-wallet explanation before treating supply distribution as safe."
    });
  }

  if ((input.snapshot.concentration.ownerPct ?? 0) >= 5) {
    findings.push({
      code: "OWNER_BALANCE_HIGH",
      detectorId: detector.id,
      detectorVersion: detector.version,
      title: "Current owner wallet still holds a material supply share",
      severity: "HIGH",
      category: "DISTRIBUTION_RISK",
      confidence: "HIGH",
      description:
        "The current owner wallet appears in the holder snapshot with at least 5% of supply.",
      technicalExplanation:
        "The owner() result was matched against the token holder list for the scanned token.",
      evidence: [evidence],
      recommendation:
        "Combine ownership status with wallet balance review; an active owner with supply can be a major control risk."
    });
  }

  return {
    detector,
    checks: [
      {
        code:
          input.snapshot.concentration.suspiciousFlags.length > 0
            ? "HOLDER_DISTRIBUTION_RISK_DETECTED"
            : "HOLDER_DISTRIBUTION_REVIEWED",
        outcome: input.snapshot.concentration.suspiciousFlags.length > 0 ? "DETECTED" : "PASSED",
        confidence: "HIGH",
        evidence: [evidence]
      }
    ],
    findings
  };
}

async function createRobinhoodRouteTradeSimulations(input: {
  adapter: ChainAdapter;
  forkTradeSimulator?: ForkTradeSimulator;
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: bigint;
  tokenDecimals: number | null;
  pools: DiscoveredPool[];
  holderSnapshot: DiscoveredHolderSnapshot | null;
}): Promise<SimulationResult[]> {
  const pool = selectDeepestPool(
    input.pools.filter((candidate) => candidate.liquidityData.protocol === "UNISWAP_V2")
  );
  if (!pool) {
    return createUnsupportedTradeSimulations({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      blockNumber: input.blockNumber
    });
  }

  const reserveToken = bigintFromRecord(pool.liquidityData, "reserveTokenRaw");
  const reserveQuote = bigintFromRecord(pool.liquidityData, "reserveQuoteRaw");
  if (!reserveToken || !reserveQuote || reserveToken <= 0n || reserveQuote <= 0n) {
    return createUnsupportedTradeSimulations({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      blockNumber: input.blockNumber
    });
  }

  const buyQuoteAmount = reserveQuote / 1_000n > 0n ? reserveQuote / 1_000n : 1n;
  const sellTokenAmount = reserveToken / 1_000n > 0n ? reserveToken / 1_000n : 1n;
  const buyOutput = getAmountOut(buyQuoteAmount, reserveQuote, reserveToken);
  const sellOutput = getAmountOut(sellTokenAmount, reserveToken, reserveQuote);
  const buyStaticCall =
    pool.quoteTokenAddress.toLowerCase() === robinhoodWrappedNativeAddress.toLowerCase()
      ? await staticCallRouterNativeBuy(input.adapter, {
          tokenAddress: input.tokenAddress,
          blockNumber: input.blockNumber,
          amountInRaw: buyQuoteAmount,
          expectedTokenOutRaw: buyOutput
        })
      : {
          status: "SKIPPED" as const,
          reason: "Router static buy is only configured for native/WETH quote pools."
        };
  const sellTransferCall = await staticCallSellLegTransfer(input.adapter, {
    tokenAddress: input.tokenAddress,
    pairAddress: pool.poolAddress,
    blockNumber: input.blockNumber,
    amountRaw: sellTokenAmount,
    holderSnapshot: input.holderSnapshot
  });
  const forkResult = input.forkTradeSimulator
    ? await input
        .forkTradeSimulator({
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          blockNumber: input.blockNumber,
          poolAddress: pool.poolAddress,
          quoteTokenAddress: pool.quoteTokenAddress,
          quoteSymbol: pool.quoteSymbol,
          reserveTokenRaw: reserveToken,
          reserveQuoteRaw: reserveQuote,
          buyQuoteAmountRaw: buyQuoteAmount,
          expectedBuyTokenOutRaw: buyOutput
        })
        .catch(() => null)
    : null;
  const common = {
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    blockNumber: input.blockNumber,
    simulationTool: forkResult?.simulationTool ?? "0.1.0-uniswap-v2-route-quote",
    poolAddress: pool.poolAddress,
    dex: pool.dex,
    quoteTokenAddress: pool.quoteTokenAddress,
    quoteSymbol: pool.quoteSymbol,
    quoteDecimals: pool.quoteDecimals,
    tokenDecimals: input.tokenDecimals,
    warning: forkResult
      ? "Forked buy/sell simulation executed on a local chain snapshot. Results are risk indicators, not guarantees."
      : "Route quote only. This confirms pool math and route liquidity, but does not execute a forked buy/sell and cannot prove honeypot or exact transfer tax."
  };

  const buyOutcome =
    forkResult && !forkResult.canBuy
      ? "FAILED"
      : buyStaticCall.status === "REVERTED"
        ? "FAILED"
        : buyOutput > 0n
          ? "PASSED"
          : "INCONCLUSIVE";
  const buySimulation: SimulationResult = {
    kind: "BUY",
    outcome: buyOutcome,
    blockNumber: input.blockNumber,
    input: {
      ...common,
      amountInRaw: buyQuoteAmount.toString(),
      amountInSymbol: pool.quoteSymbol
    },
    result: {
      isRouteAvailable: buyOutput > 0n,
      expectedTokenOutRaw: buyOutput.toString(),
      reserveTokenRaw: reserveToken.toString(),
      reserveQuoteRaw: reserveQuote.toString(),
      staticCall: buyStaticCall,
      forkSimulation: forkResult,
      buyTaxBps: forkResult?.buyTaxBps ?? null,
      isHoneypot: forkResult?.isHoneypot ?? null
    },
    simulationTool: common.simulationTool
  };
  if (forkResult && !forkResult.canBuy) {
    buySimulation.revertReason = forkResult.error ?? "Forked buy transaction failed.";
  } else if (buyStaticCall.status === "REVERTED") {
    buySimulation.revertReason = buyStaticCall.reason;
  }

  const sellOutcome =
    forkResult && !forkResult.canSell
      ? "FAILED"
      : sellTransferCall.status === "REVERTED"
        ? "FAILED"
        : sellOutput > 0n
          ? "PASSED"
          : "INCONCLUSIVE";
  const sellSimulation: SimulationResult = {
    kind: "SELL",
    outcome: sellOutcome,
    blockNumber: input.blockNumber,
    input: {
      ...common,
      amountInRaw: sellTokenAmount.toString(),
      amountInSymbol: "TOKEN"
    },
    result: {
      isRouteAvailable: sellOutput > 0n,
      expectedQuoteOutRaw: sellOutput.toString(),
      reserveTokenRaw: reserveToken.toString(),
      reserveQuoteRaw: reserveQuote.toString(),
      sellLegTransferCall: sellTransferCall,
      forkSimulation: forkResult,
      sellTaxBps: forkResult?.sellTaxBps ?? null,
      isHoneypot: forkResult?.isHoneypot ?? (sellTransferCall.status === "REVERTED" ? true : null)
    },
    simulationTool: common.simulationTool
  };
  if (forkResult && !forkResult.canSell) {
    sellSimulation.revertReason = forkResult.error ?? "Forked sell transaction failed.";
  } else if (sellTransferCall.status === "REVERTED") {
    sellSimulation.revertReason = sellTransferCall.reason;
  }

  return [
    buySimulation,
    sellSimulation,
    {
      kind: "TRANSFER",
      outcome: "DATA_UNAVAILABLE",
      blockNumber: input.blockNumber,
      input: common,
      result: {
        transferTaxBps: null,
        reason: "Transfer behavior requires a forked call from a funded holder wallet."
      },
      simulationTool: common.simulationTool
    }
  ];
}

function selectDeepestPool(pools: DiscoveredPool[]): DiscoveredPool | null {
  if (pools.length === 0) {
    return null;
  }

  const sorted = [...pools].sort((a, b) => {
    const aUsd = numberFromRecord(a.liquidityData, "totalLiquidityUsd") ?? 0;
    const bUsd = numberFromRecord(b.liquidityData, "totalLiquidityUsd") ?? 0;
    if (aUsd !== bUsd) return bUsd - aUsd;
    const aQuote = bigintFromRecord(a.liquidityData, "reserveQuoteRaw") ?? 0n;
    const bQuote = bigintFromRecord(b.liquidityData, "reserveQuoteRaw") ?? 0n;
    return bQuote > aQuote ? 1 : bQuote < aQuote ? -1 : 0;
  });

  return sorted[0] ?? null;
}

type StaticCallResult =
  | { status: "PASSED"; outputRaw: string }
  | { status: "REVERTED"; reason: string }
  | { status: "SKIPPED"; reason: string };

async function staticCallRouterNativeBuy(
  adapter: ChainAdapter,
  input: {
    tokenAddress: `0x${string}`;
    blockNumber: bigint;
    amountInRaw: bigint;
    expectedTokenOutRaw: bigint;
  }
): Promise<StaticCallResult> {
  if (!adapter.traceCall) {
    return {
      status: "SKIPPED",
      reason: "Chain adapter does not expose eth_call."
    };
  }

  const data = encodeFunctionData({
    abi: uniswapV2RouterAbi,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [
      0n,
      [robinhoodWrappedNativeAddress, input.tokenAddress],
      sentinelStaticCallWallet,
      BigInt(Math.floor(Date.now() / 1000) + 3_600)
    ]
  });

  try {
    const result = await adapter.traceCall({
      from: sentinelStaticCallWallet,
      to: robinhoodUniswapV2RouterAddress,
      data,
      value: input.amountInRaw,
      blockNumber: input.blockNumber
    });

    return {
      status: "PASSED",
      outputRaw: typeof result.raw === "string" ? result.raw : JSON.stringify(result.raw)
    };
  } catch (error) {
    return {
      status: "REVERTED",
      reason: errorMessage(error)
    };
  }
}

async function staticCallSellLegTransfer(
  adapter: ChainAdapter,
  input: {
    tokenAddress: `0x${string}`;
    pairAddress: `0x${string}`;
    blockNumber: bigint;
    amountRaw: bigint;
    holderSnapshot: DiscoveredHolderSnapshot | null;
  }
): Promise<StaticCallResult> {
  if (!adapter.traceCall) {
    return {
      status: "SKIPPED",
      reason: "Chain adapter does not expose eth_call."
    };
  }

  const holder = input.holderSnapshot?.topHolders.find(
    (row) =>
      !row.isContract &&
      !row.labels.includes("BURN") &&
      !row.labels.includes("LIQUIDITY_POOL") &&
      BigInt(row.balanceRaw) > 0n
  );
  if (!holder) {
    return {
      status: "SKIPPED",
      reason: "No non-pool holder balance was available for sell-leg transfer static call."
    };
  }

  const holderBalance = BigInt(holder.balanceRaw);
  const amountRaw = holderBalance < input.amountRaw ? holderBalance : input.amountRaw;
  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [input.pairAddress, amountRaw]
  });

  try {
    const result = await adapter.traceCall({
      from: holder.address,
      to: input.tokenAddress,
      data,
      blockNumber: input.blockNumber
    });

    return {
      status: "PASSED",
      outputRaw: typeof result.raw === "string" ? result.raw : JSON.stringify(result.raw)
    };
  } catch (error) {
    return {
      status: "REVERTED",
      reason: errorMessage(error)
    };
  }
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0n;
  }

  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function readOwnerAddressFromDetectorResults(results: DetectorResult[]): `0x${string}` | null {
  const ownership = results.find((result) => result.detector.id === "ownership-status");
  const owner = ownership?.checks
    .flatMap((check) => check.evidence)
    .map((evidence) => evidence.data.owner)
    .find((value) => typeof value === "string");

  return addressValue(owner);
}

export interface ScanProcessorDependencies {
  scans: ScanRepository;
  getChainAdapter(chainId: number): ChainAdapter;
  forkTradeSimulator?: ForkTradeSimulator;
  now?: () => Date;
}

export interface ForkTradeSimulatorInput {
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: bigint;
  poolAddress: `0x${string}`;
  quoteTokenAddress: `0x${string}`;
  quoteSymbol: string;
  reserveTokenRaw: bigint;
  reserveQuoteRaw: bigint;
  buyQuoteAmountRaw: bigint;
  expectedBuyTokenOutRaw: bigint;
}

export interface ForkTradeSimulatorResult {
  simulationTool: string;
  canBuy: boolean;
  canSell: boolean;
  isHoneypot: boolean;
  buyTaxBps: number | null;
  sellTaxBps: number | null;
  buyTokenReceivedRaw?: string;
  sellQuoteReceivedRaw?: string;
  buyTxHash?: `0x${string}`;
  sellTxHash?: `0x${string}`;
  error?: string;
}

export type ForkTradeSimulator = (
  input: ForkTradeSimulatorInput
) => Promise<ForkTradeSimulatorResult | null>;

export async function processScanJob(
  job: { data: ScanJobData },
  dependencies: ScanProcessorDependencies
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const target = await dependencies.scans.getScanTarget(job.data.scanId);
  if (!target) {
    throw new Error(`Scan ${job.data.scanId} was not found.`);
  }

  if (target.state === "COMPLETED" || target.state === "PARTIALLY_COMPLETED") {
    return;
  }

  const adapter = dependencies.getChainAdapter(target.chainId);

  await dependencies.scans.updateScanState({
    scanId: target.scanId,
    state: "RESOLVING_CHAIN",
    startedAt: now()
  });
  await dependencies.scans.recordStage({
    scanId: target.scanId,
    name: "RESOLVING_CHAIN",
    status: "RUNNING",
    startedAt: now()
  });

  try {
    const blockNumber = await adapter.getBlockNumber();
    const block = await adapter.getBlock({ blockNumber });
    await dependencies.scans.recordScanBlock({
      scanId: target.scanId,
      blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1000)
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "RESOLVING_CHAIN",
      status: "SUCCEEDED",
      completedAt: now(),
      metadata: {
        blockNumber: blockNumber.toString(),
        blockHash: block.hash
      }
    });

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "FETCHING_CONTRACT"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "FETCHING_CONTRACT",
      status: "RUNNING",
      startedAt: now()
    });

    const bytecode = await adapter.getBytecode({
      address: target.address,
      blockNumber
    });
    await dependencies.scans.recordContractObservation({
      chainId: target.chainId,
      address: target.address,
      blockNumber,
      bytecode
    });

    const tokenProfile = await collectTokenProfile(adapter, {
      chainId: target.chainId,
      address: target.address,
      blockNumber,
      bytecode
    });
    await dependencies.scans.recordTokenProfile(tokenProfile);

    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "FETCHING_CONTRACT",
      status: "SUCCEEDED",
      completedAt: now(),
      metadata: {
        bytecodePresent: bytecode !== "0x"
      }
    });

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "ANALYZING_CONTRACT"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "ANALYZING_CONTRACT",
      status: "RUNNING",
      startedAt: now()
    });
    const detectorStartedAt = now();
    const detectorResults = await runFoundationDetectors(
      {
        bytecode,
        async getTokenMetadata(address) {
          return adapter.getTokenMetadata(address);
        },
        async getOwnerAddress(address) {
          return readOwnerAddress(adapter, address);
        }
      },
      {
        scanId: target.scanId,
        chainId: target.chainId,
        address: target.address,
        scannerVersion,
        blockNumber
      }
    );
    const sourceProfile: ContractSourceDetectorInput =
      adapter.name === "Robinhood Chain"
        ? await fetchExplorerContractSource(target.chainId, target.address).catch(
            () =>
              ({
                status: "UNAVAILABLE",
                address: target.address,
                sourceFiles: []
              }) satisfies ContractSourceDetectorInput
          )
        : ({
            status: "UNAVAILABLE",
            address: target.address,
            sourceFiles: []
          } satisfies ContractSourceDetectorInput);
    const sourceDetectorResult = await sourceCodeRiskDetector.run(sourceProfile, {
      scanId: target.scanId,
      chainId: target.chainId,
      address: target.address,
      scannerVersion,
      blockNumber
    });
    detectorResults.push(sourceDetectorResult);
    const detectorCompletedAt = now();
    for (const result of detectorResults) {
      await dependencies.scans.recordDetectorResult({
        scanId: target.scanId,
        result,
        startedAt: detectorStartedAt,
        completedAt: detectorCompletedAt
      });
    }
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "ANALYZING_CONTRACT",
      status: "SUCCEEDED",
      completedAt: now(),
      metadata: {
        detectorCount: detectorResults.length,
        findingCount: detectorResults.reduce((count, result) => count + result.findings.length, 0),
        sourceStatus: sourceProfile.status,
        sourceFileCount: sourceProfile.sourceFiles.length,
        sourceContractName: sourceProfile.contractName ?? null
      }
    });
    const ownerAddress = readOwnerAddressFromDetectorResults(detectorResults);

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "DISCOVERING_MARKETS"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "DISCOVERING_MARKETS",
      status: "RUNNING",
      startedAt: now()
    });
    const discoveredPools =
      adapter.name === "Robinhood Chain"
        ? await discoverRobinhoodLiquidity(adapter, target.address, blockNumber).catch(() => null)
        : null;

    if (discoveredPools && discoveredPools.length > 0) {
      for (const discoveredPool of discoveredPools) {
        await dependencies.scans.recordLiquidityPool({
          chainId: target.chainId,
          tokenAddress: target.address,
          poolAddress: discoveredPool.poolAddress,
          blockNumber,
          dex: discoveredPool.dex,
          quoteTokenAddress: discoveredPool.quoteTokenAddress,
          liquidityData: discoveredPool.liquidityData
        });
      }
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "DISCOVERING_MARKETS",
        status: "SUCCEEDED",
        completedAt: now(),
        metadata: {
          poolCount: discoveredPools.length,
          dexes: [...new Set(discoveredPools.map((pool) => pool.dex))],
          quoteSymbols: discoveredPools.map((pool) => pool.quoteSymbol),
          poolAddresses: discoveredPools.map((pool) => pool.poolAddress)
        }
      });
    } else if (adapter.name === "Robinhood Chain") {
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "DISCOVERING_MARKETS",
        status: "SUCCEEDED",
        completedAt: now(),
        metadata: {
          poolCount: 0,
          checkedDexes: ["Uniswap V3", "Uniswap V4", "Uniswap V2"],
          checkedQuoteSymbols: robinhoodQuoteTokens.map((quote) => quote.symbol),
          reason: "No Uniswap V3, V4, or V2 pool found against configured quote tokens."
        }
      });
    } else {
      const liquidityDiscovery = createUnsupportedLiquidityDiscovery();
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "DISCOVERING_MARKETS",
        status: "SKIPPED",
        completedAt: now(),
        metadata: {
          status: liquidityDiscovery.status,
          discoveryTool: liquidityDiscovery.discoveryTool,
          checkedDexes: liquidityDiscovery.checkedDexes,
          poolCount: liquidityDiscovery.pools.length,
          reason: liquidityDiscovery.reason
        }
      });
    }

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "ANALYZING_HOLDERS"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "ANALYZING_HOLDERS",
      status: "RUNNING",
      startedAt: now()
    });
    const holderSnapshot =
      adapter.name === "Robinhood Chain"
        ? await discoverRobinhoodHolderConcentration(target.address, tokenProfile.totalSupply, {
            holderCount: tokenProfile.holderCount,
            deployerAddress: tokenProfile.deployerAddress,
            ownerAddress,
            liquidityPoolAddresses: discoveredPools?.map((pool) => pool.poolAddress) ?? []
          }).catch(() => null)
        : null;
    const holderDetectorResults: DetectorResult[] = [];

    if (holderSnapshot) {
      await dependencies.scans.recordHolderSnapshot({
        chainId: target.chainId,
        tokenAddress: target.address,
        blockNumber,
        holderCount: holderSnapshot.holderCount,
        topHolders: { holders: holderSnapshot.topHolders },
        concentration: holderSnapshot.concentration
      });
      const holderDetectorResult = createHolderConcentrationDetectorResult({
        address: target.address,
        blockNumber,
        snapshot: holderSnapshot
      });
      holderDetectorResults.push(holderDetectorResult);
      await dependencies.scans.recordDetectorResult({
        scanId: target.scanId,
        result: holderDetectorResult,
        startedAt: now(),
        completedAt: now()
      });
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "ANALYZING_HOLDERS",
        status: "SUCCEEDED",
        completedAt: now(),
        metadata: {
          topHolderCount: holderSnapshot.topHolders.length,
          top10Pct: holderSnapshot.concentration.top10Pct,
          deployerPct: holderSnapshot.concentration.deployerPct,
          ownerPct: holderSnapshot.concentration.ownerPct,
          suspiciousFlags: holderSnapshot.concentration.suspiciousFlags
        }
      });
    } else {
      const holderAnalysis = createUnsupportedHolderAnalysis();
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "ANALYZING_HOLDERS",
        status: "SKIPPED",
        completedAt: now(),
        metadata: {
          status: holderAnalysis.status,
          analysisTool: holderAnalysis.analysisTool,
          dataSources: holderAnalysis.dataSources,
          snapshotCount: holderAnalysis.snapshots.length,
          reason: holderAnalysis.reason
        }
      });
    }

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "SIMULATING_TRADES"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "SIMULATING_TRADES",
      status: "RUNNING",
      startedAt: now()
    });
    const simulations =
      adapter.name === "Robinhood Chain" && discoveredPools && discoveredPools.length > 0
        ? await createRobinhoodRouteTradeSimulations({
            adapter,
            ...(dependencies.forkTradeSimulator
              ? { forkTradeSimulator: dependencies.forkTradeSimulator }
              : {}),
            chainId: target.chainId,
            tokenAddress: target.address,
            blockNumber,
            tokenDecimals: tokenProfile.decimals,
            pools: discoveredPools,
            holderSnapshot
          })
        : createUnsupportedTradeSimulations({
            chainId: target.chainId,
            tokenAddress: target.address,
            blockNumber
          });
    for (const simulation of simulations) {
      await dependencies.scans.recordSimulationRun({
        scanId: target.scanId,
        simulation
      });
    }
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "SIMULATING_TRADES",
      status: simulations.every((simulation) => simulation.outcome === "UNSUPPORTED")
        ? "SKIPPED"
        : "SUCCEEDED",
      completedAt: now(),
      metadata: {
        simulationCount: simulations.length,
        simulationTool: simulations[0]?.simulationTool ?? "0.1.0-unsupported",
        routeQuoted: simulations.some((simulation) => simulation.outcome === "PASSED"),
        reason: simulations.every((simulation) => simulation.outcome === "UNSUPPORTED")
          ? "No isolated simulation runner is configured."
          : simulations.some((simulation) => simulation.simulationTool === "0.1.0-ganache-fork")
            ? "Uniswap V2 route quote and Ganache fork buy/sell simulation completed for the selected pool."
            : "Uniswap V2 route quote completed. Stateful fork simulation is used when the selected pool is native/WETH quoted."
      }
    });

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "SCORING"
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "SCORING",
      status: "RUNNING",
      startedAt: now()
    });
    const allDetectorResults = [...detectorResults, ...holderDetectorResults];
    const riskAssessment = scoreFindings(
      allDetectorResults.flatMap((result) => result.findings),
      scannerVersion
    );
    if (riskAssessment) {
      await dependencies.scans.recordRiskAssessment({
        scanId: target.scanId,
        assessment: riskAssessment
      });
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "SCORING",
        status: "SUCCEEDED",
        completedAt: now(),
        metadata: {
          score: riskAssessment.score,
          level: riskAssessment.level,
          scoringVersion: riskAssessment.scoringVersion
        }
      });
    } else {
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "SCORING",
        status: "SKIPPED",
        completedAt: now(),
        metadata: {
          reason: "No detector findings were available to score."
        }
      });
    }

    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "PARTIALLY_COMPLETED",
      completedAt: now(),
      failureSummary:
        "Liquidity discovery, holder concentration, route quote simulation, and native/WETH fork buy/sell simulation are live for Robinhood Chain. Unsupported quote pools fall back to route checks."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan orchestration error";
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "FETCHING_CONTRACT",
      status: "FAILED",
      completedAt: now(),
      errorCode: "SCAN_ORCHESTRATION_FAILED",
      errorMessage: message
    });
    await dependencies.scans.updateScanState({
      scanId: target.scanId,
      state: "FAILED",
      completedAt: now(),
      failureSummary: message
    });
    throw error;
  }
}

interface TokenProfileInput {
  chainId: number;
  address: `0x${string}`;
  blockNumber: bigint;
  bytecode: `0x${string}`;
}

async function collectTokenProfile(adapter: ChainAdapter, input: TokenProfileInput) {
  if (input.bytecode === "0x") {
    return {
      chainId: input.chainId,
      address: input.address,
      blockNumber: input.blockNumber,
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: null,
      holderCount: null,
      sourceVerified: null,
      deployerAddress: null,
      contractCreatedAt: null,
      creationTxHash: null,
      tokenType: null,
      iconUrl: null,
      reputation: null,
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null
    };
  }

  const [metadata, explorer, dex] = await Promise.all([
    adapter.getTokenMetadata(input.address).catch(() => null),
    adapter.name === "Robinhood Chain"
      ? fetchExplorerTokenProfile(input.chainId, input.address).catch(() => null)
      : Promise.resolve(null),
    adapter.name === "Robinhood Chain"
      ? fetchDexScreenerTokenProfile(input.address).catch(() => null)
      : Promise.resolve(null)
  ]);

  return {
    chainId: input.chainId,
    address: input.address,
    blockNumber: input.blockNumber,
    name: metadata?.name ?? explorer?.name ?? dex?.name ?? null,
    symbol: metadata?.symbol ?? explorer?.symbol ?? dex?.symbol ?? null,
    decimals: metadata?.decimals ?? explorer?.decimals ?? null,
    totalSupply: explorer?.totalSupply ?? null,
    holderCount: explorer?.holderCount ?? null,
    sourceVerified: explorer?.sourceVerified ?? null,
    deployerAddress: explorer?.deployerAddress ?? null,
    contractCreatedAt: explorer?.contractCreatedAt ?? dex?.pairCreatedAt ?? null,
    creationTxHash: explorer?.creationTxHash ?? null,
    tokenType: explorer?.tokenType ?? dex?.labels ?? null,
    iconUrl: explorer?.iconUrl ?? dex?.iconUrl ?? null,
    reputation: explorer?.reputation ?? null,
    priceUsd: explorer?.priceUsd ?? dex?.priceUsd ?? null,
    marketCapUsd: explorer?.marketCapUsd ?? dex?.marketCapUsd ?? null,
    volume24hUsd: explorer?.volume24hUsd ?? dex?.volume24hUsd ?? null
  };
}

interface ExplorerTokenProfile {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  holderCount: number | null;
  sourceVerified: boolean | null;
  deployerAddress: `0x${string}` | null;
  contractCreatedAt: Date | null;
  creationTxHash: `0x${string}` | null;
  tokenType: string | null;
  iconUrl: string | null;
  reputation: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
}

interface DexScreenerTokenProfile {
  name: string | null;
  symbol: string | null;
  iconUrl: string | null;
  labels: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
  liquidityUsd: number | null;
  pairCreatedAt: Date | null;
}

async function fetchExplorerContractSource(
  chainId: number,
  address: `0x${string}`
): Promise<ContractSourceDetectorInput> {
  if (chainId !== 4663) {
    return {
      status: "UNAVAILABLE",
      address,
      sourceFiles: []
    };
  }

  const response = await fetchJson(
    `${robinhoodChainLegacyApiUrl()}?module=contract&action=getsourcecode&address=${address}`
  );
  if (!isRecord(response) || !Array.isArray(response.result) || !isRecord(response.result[0])) {
    return {
      status: "UNAVAILABLE",
      address,
      sourceFiles: []
    };
  }

  const record = response.result[0];
  const sourceFiles = extractSourceFiles(record);
  if (sourceFiles.length === 0) {
    return {
      status: "UNAVAILABLE",
      address,
      contractName: stringValue(record.ContractName),
      compilerVersion: stringValue(record.CompilerVersion),
      sourceFiles: []
    };
  }

  return {
    status: "VERIFIED",
    address,
    contractName: stringValue(record.ContractName),
    compilerVersion: stringValue(record.CompilerVersion),
    language: stringValue(record.Language),
    abi: parseMaybeJson(stringValue(record.ABI)),
    sourceFiles
  };
}

function robinhoodChainLegacyApiUrl(): string {
  return "https://robinhoodchain.blockscout.com/api";
}

function extractSourceFiles(
  record: Record<string, unknown>
): ContractSourceDetectorInput["sourceFiles"] {
  const files: ContractSourceDetectorInput["sourceFiles"] = [];
  const primarySource = stringValue(record.SourceCode);
  if (primarySource) {
    const parsedPrimary = parseSourceCodePayload(primarySource);
    if (parsedPrimary.length > 0) {
      files.push(...parsedPrimary);
    } else {
      files.push({
        filename:
          stringValue(record.FileName) ?? stringValue(record.ContractName) ?? "Contract.sol",
        sourceCode: primarySource
      });
    }
  }

  if (Array.isArray(record.AdditionalSources)) {
    for (const item of record.AdditionalSources) {
      if (!isRecord(item)) continue;
      const sourceCode = stringValue(item.SourceCode);
      if (!sourceCode) continue;
      files.push({
        filename: stringValue(item.Filename) ?? "AdditionalSource.sol",
        sourceCode
      });
    }
  }

  return dedupeSourceFiles(files).slice(0, 80);
}

function parseSourceCodePayload(sourceCode: string): ContractSourceDetectorInput["sourceFiles"] {
  const trimmed = sourceCode.trim();
  const normalized =
    trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(1, -1) : trimmed;
  const parsed = parseMaybeJson(normalized);
  if (!isRecord(parsed)) {
    return [];
  }

  const sources = isRecord(parsed.sources) ? parsed.sources : parsed;
  const files: ContractSourceDetectorInput["sourceFiles"] = [];
  for (const [filename, value] of Object.entries(sources)) {
    if (typeof value === "string") {
      files.push({ filename, sourceCode: value });
    } else if (isRecord(value) && typeof value.content === "string") {
      files.push({ filename, sourceCode: value.content });
    }
  }

  return files;
}

function dedupeSourceFiles(
  files: ContractSourceDetectorInput["sourceFiles"]
): ContractSourceDetectorInput["sourceFiles"] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.filename}:${file.sourceCode.length}:${file.sourceCode.slice(0, 64)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMaybeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fetchExplorerTokenProfile(
  chainId: number,
  address: `0x${string}`
): Promise<ExplorerTokenProfile | null> {
  if (chainId !== 4663) {
    return null;
  }

  const [token, search, addressInfo] = await Promise.all([
    fetchJson(`${robinhoodBlockscoutApiUrl}/tokens/${address}`),
    fetchJson(`${robinhoodBlockscoutApiUrl}/search?q=${encodeURIComponent(address)}`),
    fetchJson(`${robinhoodBlockscoutApiUrl}/addresses/${address}`)
  ]);

  const tokenRecord = isRecord(token) ? token : {};
  const searchItem = firstMatchingSearchItem(search, address);
  const addressRecord = isRecord(addressInfo) ? addressInfo : {};
  const creationTxHash = hexStringValue(addressRecord.creation_transaction_hash);
  const creationTx = creationTxHash
    ? await fetchJson(`${robinhoodBlockscoutApiUrl}/transactions/${creationTxHash}`).catch(
        () => null
      )
    : null;
  const creationTxRecord = isRecord(creationTx) ? creationTx : {};

  return {
    name: stringValue(tokenRecord.name) ?? stringValue(searchItem?.name) ?? null,
    symbol: stringValue(tokenRecord.symbol) ?? stringValue(searchItem?.symbol) ?? null,
    decimals: numberValue(tokenRecord.decimals),
    totalSupply:
      stringValue(tokenRecord.total_supply) ?? stringValue(searchItem?.total_supply) ?? null,
    holderCount: numberValue(tokenRecord.holders_count) ?? numberValue(searchItem?.holder_count),
    sourceVerified:
      booleanValue(addressRecord.is_verified) ??
      booleanValue(searchItem?.is_smart_contract_verified),
    deployerAddress: addressValue(addressRecord.creator_address_hash),
    contractCreatedAt: dateValue(creationTxRecord.timestamp),
    creationTxHash,
    tokenType: stringValue(tokenRecord.type),
    iconUrl: stringValue(tokenRecord.icon_url),
    reputation: stringValue(addressRecord.reputation) ?? stringValue(tokenRecord.reputation),
    priceUsd:
      decimalStringValue(tokenRecord.exchange_rate) ??
      decimalStringValue(searchItem?.exchange_rate),
    marketCapUsd:
      decimalStringValue(tokenRecord.circulating_market_cap) ??
      decimalStringValue(searchItem?.circulating_market_cap),
    volume24hUsd: decimalStringValue(tokenRecord.volume_24h)
  };
}

async function fetchDexScreenerTokenProfile(
  address: `0x${string}`
): Promise<DexScreenerTokenProfile | null> {
  const response = await fetchJson(
    `https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`
  );
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
  const bestPair = selectBestDexScreenerPair(matchingPairs.length > 0 ? matchingPairs : pairs);
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

  return {
    name: stringValue(baseToken.name),
    symbol: stringValue(baseToken.symbol),
    iconUrl: stringValue(info.imageUrl),
    labels,
    priceUsd: decimalStringValue(bestPair.priceUsd),
    marketCapUsd:
      decimalStringValue(bestPair.marketCap) ?? decimalStringValue(bestPair.fdv),
    volume24hUsd: decimalStringValue(volume.h24),
    liquidityUsd: numberValue(liquidity.usd),
    pairCreatedAt: timestampMsDateValue(bestPair.pairCreatedAt)
  };
}

function selectBestDexScreenerPair(pairs: Record<string, unknown>[]): Record<string, unknown> | null {
  const sorted = [...pairs].sort((a, b) => {
    const aLiquidity = numberValue(isRecord(a.liquidity) ? a.liquidity.usd : undefined) ?? 0;
    const bLiquidity = numberValue(isRecord(b.liquidity) ? b.liquidity.usd : undefined) ?? 0;
    return bLiquidity - aLiquidity;
  });
  return sorted[0] ?? null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

function firstMatchingSearchItem(
  value: unknown,
  address: `0x${string}`
): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }

  const normalizedAddress = address.toLowerCase();
  const items: unknown[] = value.items;
  const match = items.find((item) => {
    return isRecord(item) && stringValue(item.address_hash)?.toLowerCase() === normalizedAddress;
  });

  return isRecord(match) ? match : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function bigintFromRecord(record: Record<string, unknown>, key: string): bigint | null {
  const value = record[key];
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "eth_call reverted";
}

function hexStringValue(value: unknown): `0x${string}` | null {
  return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value)
    ? (value as `0x${string}`)
    : null;
}

function addressValue(value: unknown): `0x${string}` | null {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampMsDateValue(value: unknown): Date | null {
  const numeric = numberValue(value);
  if (numeric === null) {
    return null;
  }

  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decimalStringValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === "string" && value.length > 0 && Number.isFinite(Number(value))) {
    return value;
  }

  return null;
}

function numberValue(value: unknown): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
