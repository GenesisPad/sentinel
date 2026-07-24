import { encodeFunctionData, parseAbi, parseAbiItem, toEventSelector } from "viem";
import type { ChainAdapter, ChainLog } from "@genesis-sentinel/chain-adapters";
import { hashBytecode } from "@genesis-sentinel/database";
import type { ScanRepository } from "@genesis-sentinel/database";
import type { ScanJobData } from "@genesis-sentinel/queue";
import {
  getProviderSet,
  robinhoodUniswapV2RouterAddress,
  robinhoodWrappedNativeAddress,
  type DiscoveredPool,
  type HolderSnapshotResult as DiscoveredHolderSnapshot,
  type ProviderSet,
  addressValue,
  bigintFromRecord,
  numberFromRecord
} from "@genesis-sentinel/providers";
import type {
  ContractSourceDetectorInput,
  DetectorResult,
  SimulationResult
} from "@genesis-sentinel/security-engine";
import {
  abiFunctionNames,
  createUnsupportedHolderAnalysis,
  createUnsupportedLiquidityDiscovery,
  createUnsupportedTradeSimulations,
  deployerHistoryDetector,
  eip1167ImplementationAddress,
  genesispadLaunchDetector,
  dexInteractionSurfaceDetector,
  ledgerIntegrityDetector,
  liveTradingStateDetector,
  ownershipRolesAbiDetector,
  poolReserveIntegrityDetector,
  roleMembershipDetector,
  runFoundationDetectors,
  scoreFindings,
  sourceCodeRiskDetector,
  transferGateDetector,
  type LedgerAccountReconciliation,
  type LedgerReconciliation,
  type PoolReserveSample
} from "@genesis-sentinel/security-engine";
import { scannerVersion } from "@genesis-sentinel/shared";
import type { BytecodeReuseView, RelatedWalletEdge } from "@genesis-sentinel/shared";

const sentinelStaticCallWallet = "0x0000000000000000000000000000000000001001" as const;

const ownableAbi = parseAbi(["function owner() view returns (address)"]);
const uniswapV2RouterAbi = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) payable"
]);
const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

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

/**
 * Tries each candidate no-argument view function name in order and returns the first one that
 * successfully decodes as a bool, or null if none of them exist/succeed. Used for live
 * pause()/trading-toggle state reads where the exact function name varies between contracts
 * and there is no ABI-guaranteed single name to call.
 */
async function readBoolCandidate(
  adapter: ChainAdapter,
  address: `0x${string}`,
  candidateNames: string[],
  blockNumber: bigint
): Promise<boolean | null> {
  for (const name of candidateNames) {
    try {
      const abi = parseAbi([`function ${name}() view returns (bool)`]);
      return await adapter.readContract<boolean>({ address, abi, functionName: name, blockNumber });
    } catch {
      continue;
    }
  }
  return null;
}

const roleMemberCountAbi = parseAbi(["function getRoleMemberCount(bytes32 role) view returns (uint256)"]);
const wellKnownAccessControlRoleNames = ["DEFAULT_ADMIN_ROLE", "MINTER_ROLE", "PAUSER_ROLE"];

/**
 * Reads live getRoleMemberCount() results for each well-known AccessControl role whose bytes32
 * id getter is present in the ABI — but only when the contract also implements
 * AccessControlEnumerable (getRoleMemberCount itself present). Without enumeration, the only
 * alternative is hasRole(role, candidateAddress) against guessed addresses, which can find a
 * match by luck but can never prove absence — so unenumerable contracts are left unverifiable
 * here rather than clearing a finding on a check that couldn't actually rule anything out.
 */
async function readRoleMembership(
  adapter: ChainAdapter,
  address: `0x${string}`,
  abi: unknown,
  blockNumber: bigint
): Promise<{ supportsEnumeration: boolean; roleHolderCounts: Record<string, number | null> }> {
  const functionNames = abiFunctionNames(abi);
  const supportsEnumeration = functionNames.has("getRoleMemberCount");
  if (!supportsEnumeration) {
    return { supportsEnumeration: false, roleHolderCounts: {} };
  }

  const roleHolderCounts: Record<string, number | null> = {};
  for (const roleName of wellKnownAccessControlRoleNames) {
    if (!functionNames.has(roleName)) continue;
    try {
      const roleGetterAbi = parseAbi([`function ${roleName}() view returns (bytes32)`]);
      const roleId = await adapter.readContract<`0x${string}`>({
        address,
        abi: roleGetterAbi,
        functionName: roleName,
        blockNumber
      });
      const count = await adapter.readContract<bigint>({
        address,
        abi: roleMemberCountAbi,
        functionName: "getRoleMemberCount",
        args: [roleId],
        blockNumber
      });
      roleHolderCounts[roleName] = typeof count === "bigint" ? Number(count) : null;
    } catch {
      roleHolderCounts[roleName] = null;
    }
  }

  return { supportsEnumeration, roleHolderCounts };
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
        "Require a clear vesting, lock, or team-wallet explanation before treating supply distribution as low detected risk."
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
    input.pools.filter(
      (candidate) =>
        candidate.liquidityData.protocol === "UNISWAP_V2" ||
        candidate.liquidityData.protocol === "UNISWAP_V3"
    )
  );
  if (!pool) {
    return createUnsupportedTradeSimulations({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      blockNumber: input.blockNumber
    });
  }

  const isV3 = pool.liquidityData.protocol === "UNISWAP_V3";
  const reserveToken = isV3
    ? bigintFromRecord(pool.liquidityData, "tokenBalanceRaw")
    : bigintFromRecord(pool.liquidityData, "reserveTokenRaw");
  const reserveQuote = isV3
    ? bigintFromRecord(pool.liquidityData, "quoteBalanceRaw")
    : bigintFromRecord(pool.liquidityData, "reserveQuoteRaw");
  if (!reserveToken || !reserveQuote || reserveToken <= 0n || reserveQuote <= 0n) {
    return createUnsupportedTradeSimulations({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      blockNumber: input.blockNumber
    });
  }

  const buyQuoteAmount = reserveQuote / 1_000n > 0n ? reserveQuote / 1_000n : 1n;
  const sellTokenAmount = reserveToken / 1_000n > 0n ? reserveToken / 1_000n : 1n;

  // V3 has no constant-product reserves; approximate expected output from the pool's current
  // spot price (sqrtPriceX96) instead. This ignores price impact/concentrated-liquidity depth,
  // same spirit as the V2 constant-product estimate — both are baselines for tax-percentage
  // comparison against the fork simulation's real measured output, not a precise quote.
  const feeTier = numberFromRecord(pool.liquidityData, "feeTier") ?? undefined;
  let buyOutput: bigint;
  let sellOutput: bigint;
  if (isV3) {
    const sqrtPriceX96 = bigintFromRecord(pool.liquidityData, "sqrtPriceX96Raw") ?? 0n;
    const token0 = addressValue(pool.liquidityData.token0);
    const tokenIsToken0 = token0 !== null && token0 === input.tokenAddress.toLowerCase();
    buyOutput = getV3SpotAmountOut(buyQuoteAmount, sqrtPriceX96, !tokenIsToken0);
    sellOutput = getV3SpotAmountOut(sellTokenAmount, sqrtPriceX96, tokenIsToken0);
  } else {
    buyOutput = getAmountOut(buyQuoteAmount, reserveQuote, reserveToken);
    sellOutput = getAmountOut(sellTokenAmount, reserveToken, reserveQuote);
  }
  const buyStaticCall = isV3
    ? {
        status: "SKIPPED" as const,
        reason:
          "Static eth_call pre-check is only implemented for the Uniswap V2 router; V3 relies on the fork simulation result when enabled."
      }
    : pool.quoteTokenAddress.toLowerCase() === robinhoodWrappedNativeAddress.toLowerCase()
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
  // Why the fork did or didn't run is recorded rather than swallowed. Silently discarding this
  // hid a fork-simulator crash for every scan: honeypot and tax simply read "unknown" forever
  // with nothing anywhere saying the simulator had failed rather than been skipped.
  let forkStatus: "EXECUTED" | "NOT_CONFIGURED" | "UNSUPPORTED_POOL" | "FAILED" = "NOT_CONFIGURED";
  let forkFailureReason: string | null = null;
  const forkResult = input.forkTradeSimulator
    ? await input
        .forkTradeSimulator({
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          blockNumber: input.blockNumber,
          poolAddress: pool.poolAddress,
          dex: pool.dex,
          ...(feeTier !== undefined ? { feeTier } : {}),
          quoteTokenAddress: pool.quoteTokenAddress,
          quoteSymbol: pool.quoteSymbol,
          reserveTokenRaw: reserveToken,
          reserveQuoteRaw: reserveQuote,
          buyQuoteAmountRaw: buyQuoteAmount,
          expectedBuyTokenOutRaw: buyOutput
        })
        .catch((error: unknown) => {
          forkFailureReason = errorMessage(error);
          return null;
        })
    : null;
  if (forkResult) {
    forkStatus = "EXECUTED";
  } else if (forkFailureReason !== null) {
    forkStatus = "FAILED";
  } else if (input.forkTradeSimulator) {
    // The simulator was wired but declined this pool (e.g. a non-native quote token).
    forkStatus = "UNSUPPORTED_POOL";
  }
  const common = {
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    blockNumber: input.blockNumber,
    simulationTool:
      forkResult?.simulationTool ??
      (isV3 ? "0.1.0-uniswap-v3-route-quote" : "0.1.0-uniswap-v2-route-quote"),
    poolAddress: pool.poolAddress,
    dex: pool.dex,
    quoteTokenAddress: pool.quoteTokenAddress,
    quoteSymbol: pool.quoteSymbol,
    quoteDecimals: pool.quoteDecimals,
    tokenDecimals: input.tokenDecimals,
    forkStatus,
    forkFailureReason,
    warning: forkResult
      ? "Forked buy/sell simulation executed on a local chain snapshot. Results are risk indicators, not guarantees."
      : "Route quote only. This confirms pool math and route liquidity, but does not execute a forked buy/sell and cannot prove honeypot or exact transfer tax."
  };

  // A real fork run is authoritative and must never be overridden by the lighter static/
  // route-quote signal — a stale or unrelated static-call revert (e.g. a probe wallet quirk
  // unrelated to buyability) must not mark a buy FAILED when the fork actually succeeded.
  const buyOutcome = forkResult
    ? forkResult.canBuy
      ? "PASSED"
      : "FAILED"
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
  if (forkResult) {
    if (!forkResult.canBuy) {
      buySimulation.revertReason = forkResult.error ?? "Forked buy transaction failed.";
    }
  } else if (buyStaticCall.status === "REVERTED") {
    buySimulation.revertReason = buyStaticCall.reason;
  }

  const sellOutcome = forkResult
    ? forkResult.canSell
      ? "PASSED"
      : "FAILED"
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
  if (forkResult) {
    if (!forkResult.canSell) {
      sellSimulation.revertReason = forkResult.error ?? "Forked sell transaction failed.";
    }
  } else if (sellTransferCall.status === "REVERTED") {
    sellSimulation.revertReason = sellTransferCall.reason;
  }

  const transferSimulation: SimulationResult =
    forkResult?.transferSucceeded !== undefined
      ? {
          kind: "TRANSFER",
          outcome: forkResult.transferSucceeded ? "PASSED" : "FAILED",
          blockNumber: input.blockNumber,
          input: common,
          result: {
            transferTaxBps: forkResult.transferTaxBps ?? null,
            forkSimulation: forkResult
          },
          simulationTool: common.simulationTool,
          ...(!forkResult.transferSucceeded
            ? { revertReason: forkResult.error ?? "Forked wallet-to-wallet transfer failed." }
            : {})
        }
      : {
          kind: "TRANSFER",
          outcome: "DATA_UNAVAILABLE",
          blockNumber: input.blockNumber,
          input: common,
          result: {
            transferTaxBps: null,
            reason: "Transfer behavior requires a forked call from a funded holder wallet."
          },
          simulationTool: common.simulationTool
        };

  return [buySimulation, sellSimulation, transferSimulation];
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
      blockNumber: input.blockNumber,
      // sentinelStaticCallWallet holds no real funds — this static-only probe wallet needs a
      // synthetic balance override for the call, or every buy check would fail on
      // "insufficient balance for gas * gasFee + value" regardless of whether the token is
      // actually buyable. Scoped to this one eth_call; never a real transaction.
      stateOverride: [{ address: sentinelStaticCallWallet, balance: input.amountInRaw * 2n }]
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

const uniswapV3PriceQ192 = 2n ** 192n;

/**
 * Approximates a Uniswap V3 swap's output from the pool's current spot price alone (ignoring
 * price impact and concentrated-liquidity depth) — a baseline for tax-percentage comparison
 * against the fork simulation's real measured output, same role `getAmountOut` plays for V2.
 * `zeroForOne` is true when the swap direction is token0 -> token1.
 */
function getV3SpotAmountOut(amountIn: bigint, sqrtPriceX96: bigint, zeroForOne: boolean): bigint {
  if (amountIn <= 0n || sqrtPriceX96 <= 0n) {
    return 0n;
  }

  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (priceX192 <= 0n) {
    return 0n;
  }

  return zeroForOne
    ? (amountIn * priceX192) / uniswapV3PriceQ192
    : (amountIn * uniswapV3PriceQ192) / priceX192;
}

function readOwnerAddressFromDetectorResults(results: DetectorResult[]): `0x${string}` | null {
  const ownership = results.find((result) => result.detector.id === "ownership-status");
  const owner = ownership?.checks
    .flatMap((check) => check.evidence)
    .map((evidence) => evidence.data.owner)
    .find((value) => typeof value === "string");

  return addressValue(owner);
}

const burnOrZeroAddresses = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead"
]);

/**
 * Assembles real, evidence-backed related-wallet edges (Milestone 6): DEPLOYED_BY/OWNED_BY
 * from data this scan already collected, SHARED_BYTECODE from Sentinel's own scan history,
 * and (when a wallet-clustering provider is wired for this chain) FUNDED_BY/
 * TRANSFERRED_SUPPLY_TO from bounded on-chain/explorer lookups. Never infers a relationship
 * from timing coincidence.
 */
async function buildRelatedWalletEdges(input: {
  adapter: ChainAdapter;
  providers: ProviderSet | null;
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: bigint;
  deployerAddress: `0x${string}` | null;
  ownerAddress: `0x${string}` | null;
  totalSupply: string | null;
  bytecodeReuse: BytecodeReuseView | null;
  /** Addresses (lowercased) of this token's own discovered liquidity pools and the chain's real
   * locker contract — supply sent here is the deployer seeding the pool or locking tokens, not
   * a wallet relationship, and must never be reported as a "transferred supply to a wallet"
   * finding. */
  knownPoolAddresses: Set<string>;
}): Promise<RelatedWalletEdge[]> {
  const edges: RelatedWalletEdge[] = [];
  const ownerIsActive =
    input.ownerAddress !== null && !burnOrZeroAddresses.has(input.ownerAddress.toLowerCase());

  if (input.deployerAddress) {
    edges.push({
      type: "DEPLOYED_BY",
      address: input.deployerAddress,
      confidence: "HIGH",
      evidence: "Explorer token profile reports this address as the contract deployer.",
      source: "explorer-token-profile"
    });
  }

  if (ownerIsActive && input.ownerAddress) {
    edges.push({
      type: "OWNED_BY",
      address: input.ownerAddress,
      confidence: "HIGH",
      evidence: "owner() returned this address directly on-chain at the scan block.",
      source: "on-chain-owner-read"
    });
  }

  if (input.bytecodeReuse) {
    for (const address of input.bytecodeReuse.reusedByAddresses) {
      edges.push({
        type: "SHARED_BYTECODE",
        address,
        confidence: "HIGH",
        evidence:
          "This contract's runtime bytecode hash exactly matches this address's, per Sentinel's own scan history.",
        source: "bytecode-hash-match"
      });
    }
  }

  // Renouncing ownership does not erase the deployer's or a previous owner's history — both are
  // still tracked below regardless of the current (possibly renounced) owner() result.
  let previousOwner: `0x${string}` | null = null;
  if (!ownerIsActive && input.providers?.walletClustering) {
    const previousOwnerResult = await input.providers.walletClustering
      .findPreviousOwner({
        chainId: input.chainId,
        adapter: input.adapter,
        tokenAddress: input.tokenAddress,
        fromBlock: 0n,
        toBlock: input.blockNumber
      })
      .catch((): null => null);
    if (
      previousOwnerResult &&
      previousOwnerResult.address.toLowerCase() !== input.deployerAddress?.toLowerCase()
    ) {
      previousOwner = previousOwnerResult.address;
      edges.push({
        type: "PREVIOUSLY_OWNED_BY",
        address: previousOwner,
        confidence: "HIGH",
        evidence:
          "Recovered from an OwnershipTransferred log where ownership was transferred to a burn/zero address (renouncement); this address held ownership immediately before that.",
        source: "ownership-transferred-log-scan",
        ...(previousOwnerResult.blockNumber
          ? { firstObservedBlock: previousOwnerResult.blockNumber }
          : {})
      });
    }
  }

  if (input.providers?.walletClustering) {
    const trackedWallets = new Map<string, { address: `0x${string}`; roleLabel: string }>();
    if (input.deployerAddress) {
      trackedWallets.set(input.deployerAddress.toLowerCase(), {
        address: input.deployerAddress,
        roleLabel: "deployer"
      });
    }
    if (ownerIsActive && input.ownerAddress) {
      trackedWallets.set(input.ownerAddress.toLowerCase(), {
        address: input.ownerAddress,
        roleLabel: "current owner"
      });
    }
    if (previousOwner) {
      trackedWallets.set(previousOwner.toLowerCase(), {
        address: previousOwner,
        roleLabel: "previous owner (since renounced)"
      });
    }

    const walletClustering = input.providers.walletClustering;
    for (const { address, roleLabel } of trackedWallets.values()) {
      const fundedByEdge = await walletClustering
        .findFundingWallet({ chainId: input.chainId, address, roleLabel })
        .catch((): null => null);
      if (fundedByEdge) {
        edges.push(fundedByEdge);
      }

      const supplyEdges = await walletClustering
        .findSupplyTransfers({
          adapter: input.adapter,
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          fromAddress: address,
          roleLabel,
          fromBlock: 0n,
          toBlock: input.blockNumber,
          totalSupply: input.totalSupply
        })
        .catch((): RelatedWalletEdge[] => []);
      // A deployer/owner sending most or all of the supply to the token's own liquidity pool is
      // exactly how every DEX launch seeds trading — expected, not a distribution risk. Reporting
      // it as "transferred supply to this wallet" is a false claim about a pool contract.
      edges.push(
        ...supplyEdges.filter((edge) => !input.knownPoolAddresses.has(edge.address.toLowerCase()))
      );
    }
  }

  return enrichEdgesWithBalances(edges, {
    adapter: input.adapter,
    tokenAddress: input.tokenAddress,
    blockNumber: input.blockNumber,
    totalSupply: input.totalSupply
  });
}

const erc20BalanceOfAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)"
]);
const erc20TotalSupplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

/**
 * Throwaway addresses used to probe a suspected transfer gate. They hold nothing and have never
 * transacted, so an operator cannot have pre-authorized them — if a gate accepts these, it is
 * not restricting by wallet.
 */
const transferGateProbeOrigins: `0x${string}`[] = [
  "0x00000000000000000000000000000000000f0001",
  "0x00000000000000000000000000000000000f0002"
];

async function readCodeAt(
  adapter: ChainAdapter,
  address: `0x${string}`,
  blockNumber: bigint
): Promise<`0x${string}` | null> {
  try {
    const code = await adapter.getBytecode({ address, blockNumber });
    return code && code !== "0x" ? code : null;
  } catch {
    return null;
  }
}

/**
 * Calls an address with empty calldata, which is what a token's transfer hook triggers when it
 * pokes a gate. Resolves false when the call reverts, meaning that origin would be blocked.
 */
async function probeEmptyCall(
  adapter: ChainAdapter,
  address: `0x${string}`,
  origin: `0x${string}`,
  blockNumber: bigint
): Promise<boolean> {
  if (!adapter.traceCall) return true;
  try {
    await adapter.traceCall({ from: origin, to: address, data: "0x", blockNumber });
    return true;
  } catch {
    return false;
  }
}

function topicToAddress(topic: `0x${string}`): `0x${string}` {
  return `0x${topic.slice(-40)}`.toLowerCase() as `0x${string}`;
}

/** How many top holders are reconciled. Each costs two balanceOf reads. */
const ledgerReconciliationAccountLimit = 12;
/**
 * Block window reconciled, ending at the scan block. Bounded deliberately: one getLogs call has
 * to cover it, and this detector is aimed at tokens that are actively deleting balances now.
 * A deletion older than this window is outside the search and is not reported — the scan says
 * nothing about it rather than implying the ledger was clean.
 */
const ledgerReconciliationWindowBlocks = 20_000n;
const transferEventTopic = toEventSelector(
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")
);

/**
 * Builds the balance-vs-Transfer-event reconciliation for a set of holders. ERC-20 requires
 * every balance change to emit Transfer, so `after` must equal `before + in - out`; anything
 * else means the contract writes balances outside the ERC-20 interface.
 */
async function readLedgerReconciliation(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  input: { accounts: `0x${string}`[]; blockNumber: bigint }
): Promise<LedgerReconciliation | null> {
  if (input.accounts.length === 0) return null;
  const fromBlock =
    input.blockNumber > ledgerReconciliationWindowBlocks
      ? input.blockNumber - ledgerReconciliationWindowBlocks
      : 0n;
  const toBlock = input.blockNumber;
  if (toBlock <= fromBlock) return null;

  let logs: ChainLog[];
  try {
    logs = await adapter.getLogs({
      address: tokenAddress,
      fromBlock: fromBlock + 1n,
      toBlock,
      topics: [transferEventTopic]
    });
  } catch {
    return null;
  }

  const tracked = new Map<string, { in: bigint; out: bigint }>();
  for (const account of input.accounts) {
    tracked.set(account.toLowerCase(), { in: 0n, out: 0n });
  }

  for (const log of logs) {
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (!fromTopic || !toTopic) continue;
    let amount: bigint;
    try {
      amount = BigInt(log.data);
    } catch {
      continue;
    }
    const sender = tracked.get(topicToAddress(fromTopic).toLowerCase());
    if (sender) sender.out += amount;
    const recipient = tracked.get(topicToAddress(toTopic).toLowerCase());
    if (recipient) recipient.in += amount;
  }

  const readBalance = async (account: `0x${string}`, at: bigint): Promise<bigint | null> => {
    try {
      const balance = await adapter.readContract<bigint>({
        address: tokenAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [account],
        blockNumber: at
      });
      return typeof balance === "bigint" ? balance : null;
    } catch {
      return null;
    }
  };
  const readSupply = async (at: bigint): Promise<string | null> => {
    try {
      const supply = await adapter.readContract<bigint>({
        address: tokenAddress,
        abi: erc20TotalSupplyAbi,
        functionName: "totalSupply",
        blockNumber: at
      });
      return typeof supply === "bigint" ? supply.toString() : null;
    } catch {
      return null;
    }
  };

  const accounts: LedgerAccountReconciliation[] = [];
  for (const account of input.accounts) {
    const [before, after] = await Promise.all([
      readBalance(account, fromBlock),
      readBalance(account, toBlock)
    ]);
    // A failed read cannot be distinguished from a zero balance, so skip rather than invent a
    // discrepancy out of an RPC error.
    if (before === null || after === null) continue;
    const movement = tracked.get(account.toLowerCase()) ?? { in: 0n, out: 0n };
    accounts.push({
      address: account,
      balanceBefore: before.toString(),
      balanceAfter: after.toString(),
      transferredIn: movement.in.toString(),
      transferredOut: movement.out.toString()
    });
  }

  if (accounts.length === 0) return null;
  const [totalSupplyBefore, totalSupplyAfter] = await Promise.all([
    readSupply(fromBlock),
    readSupply(toBlock)
  ]);

  return {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    accounts,
    totalSupplyBefore,
    totalSupplyAfter
  };
}

/**
 * Pairs each discovered pool's self-reported token reserve with the real balance the token
 * contract says that pool holds. A pool whose reported reserve far exceeds its real balance is
 * quoting a price backed by tokens that are not there.
 */
async function readPoolReserveSamples(
  adapter: ChainAdapter,
  tokenAddress: `0x${string}`,
  pools: DiscoveredPool[] | null,
  blockNumber: bigint
): Promise<PoolReserveSample[] | null> {
  if (!pools || pools.length === 0) return null;

  const samples: PoolReserveSample[] = [];
  for (const pool of pools) {
    const isV3 = pool.liquidityData.protocol === "UNISWAP_V3";
    const reported = isV3
      ? bigintFromRecord(pool.liquidityData, "tokenBalanceRaw")
      : bigintFromRecord(pool.liquidityData, "reserveTokenRaw");
    if (reported === null || reported <= 0n) continue;

    let actual: bigint;
    try {
      actual = await adapter.readContract<bigint>({
        address: tokenAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [pool.poolAddress],
        blockNumber
      });
    } catch {
      continue;
    }
    if (typeof actual !== "bigint") continue;

    samples.push({
      poolAddress: pool.poolAddress,
      ...(typeof pool.liquidityData.protocol === "string"
        ? { protocol: pool.liquidityData.protocol }
        : {}),
      reportedTokenReserveRaw: reported.toString(),
      actualTokenBalanceRaw: actual.toString()
    });
  }

  return samples.length > 0 ? samples : null;
}

/**
 * Reads each clustered wallet's real token balance on-chain at the scan block, so the dev
 * cluster can report what every connected address actually holds. The holder snapshot only
 * covers the top N holders, so without this a connected wallet outside that set reports
 * "unknown" rather than its real (often small but non-zero) balance. A failed read leaves the
 * balance absent rather than defaulting to zero, so an RPC error never understates the cluster.
 */
async function enrichEdgesWithBalances(
  edges: RelatedWalletEdge[],
  input: {
    adapter: ChainAdapter;
    tokenAddress: `0x${string}`;
    blockNumber: bigint;
    totalSupply: string | null;
  }
): Promise<RelatedWalletEdge[]> {
  let total: bigint | null = null;
  if (input.totalSupply) {
    try {
      total = BigInt(input.totalSupply);
    } catch {
      total = null;
    }
  }

  const balanceByAddress = new Map<string, bigint>();
  for (const address of new Set(edges.map((edge) => edge.address.toLowerCase()))) {
    try {
      const balance = await input.adapter.readContract<bigint>({
        address: input.tokenAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [address],
        blockNumber: input.blockNumber
      });
      if (typeof balance === "bigint") {
        balanceByAddress.set(address, balance);
      }
    } catch {
      /* leave this wallet's balance unknown rather than claiming it holds nothing */
    }
  }

  return edges.map((edge) => {
    const balance = balanceByAddress.get(edge.address.toLowerCase());
    if (balance === undefined) return edge;
    return {
      ...edge,
      balanceRaw: balance.toString(),
      ...(total !== null && total > 0n
        ? { holdingPct: Number((balance * 100_000_000n) / total) / 1_000_000 }
        : {})
    };
  });
}

/**
 * Feeds Milestone 6 wallet-clustering edges into Milestone 4 holder concentration: excludes
 * DEPLOYED_BY/OWNED_BY (already reported separately as deployerPct/ownerPct) and returns the
 * remaining connected addresses (previous owner, funding sources, supply recipients,
 * shared-bytecode deployments) so concentration can flag them as connected rather than
 * counting them as unrelated wallets.
 */
function relatedWalletAddressesForHolders(edges: RelatedWalletEdge[]): `0x${string}`[] {
  const addresses = new Set<string>();
  const result: `0x${string}`[] = [];
  for (const edge of edges) {
    if (edge.type === "DEPLOYED_BY" || edge.type === "OWNED_BY") continue;
    const key = edge.address.toLowerCase();
    if (addresses.has(key)) continue;
    addresses.add(key);
    result.push(edge.address);
  }
  return result;
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
  /** "Uniswap V2" or "Uniswap V3" (per DiscoveredPool.dex) — selects which router/swap ABI the
   * fork simulator uses. */
  dex: string;
  /** Uniswap V3 fee tier for the discovered pool. Required when `dex` is "Uniswap V3". */
  feeTier?: number;
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
  buyGasUsed?: string;
  sellGasUsed?: string;
  error?: string;
  /** Small (~10% of the bought amount) sell tested before the full/remainder sell, so a
   * "small sell succeeds but larger sell fails" pattern is distinguishable from a flat
   * honeypot. Undefined when the fork didn't reach this step (e.g. the buy itself failed). */
  partialSellSucceeded?: boolean;
  partialSellTaxBps?: number | null;
  /** Wallet-to-wallet transfer test: sends a small slice of the bought tokens from the fork
   * buyer to a second, freshly generated fork-only account and measures received vs sent. */
  transferSucceeded?: boolean;
  transferTaxBps?: number | null;
  transferTxHash?: `0x${string}`;
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
  const providers = getProviderSet(target.chainId);

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

    const tokenProfile = await collectTokenProfile(adapter, providers, {
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
        },
        async getStorageAt(slot) {
          return adapter.getStorageAt({ address: target.address, slot, blockNumber });
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
    // EIP-1167 clones contain only a tiny delegation stub; their actual token logic and ABI live
    // at the immutable implementation address embedded in runtime bytecode. Analyse that verified
    // implementation source while continuing to execute live reads against the clone address.
    const sourceAnalysisAddress = eip1167ImplementationAddress(bytecode) ?? target.address;
    const sourceProfile: ContractSourceDetectorInput = providers
      ? await providers.source
          .getContractSource({ chainId: target.chainId, address: sourceAnalysisAddress })
          .catch(
            () =>
              ({
                status: "UNAVAILABLE",
                address: sourceAnalysisAddress,
                sourceFiles: []
              }) satisfies ContractSourceDetectorInput
          )
      : ({
          status: "UNAVAILABLE",
          address: sourceAnalysisAddress,
          sourceFiles: []
        } satisfies ContractSourceDetectorInput);
    const detectorRunContext = {
      scanId: target.scanId,
      chainId: target.chainId,
      address: target.address,
      scannerVersion,
      blockNumber
    };
    const sourceDetectorResult = await sourceCodeRiskDetector.run(sourceProfile, detectorRunContext);
    const ownershipRolesResult = await ownershipRolesAbiDetector.run(
      sourceProfile,
      detectorRunContext
    );
    const roleMembershipResult = await roleMembershipDetector.run(
      await readRoleMembership(adapter, target.address, sourceProfile.abi, blockNumber),
      detectorRunContext
    );
    const liveTradingStateResult = await liveTradingStateDetector.run(
      {
        readPausedState: () => readBoolCandidate(adapter, target.address, ["paused"], blockNumber),
        readTradingOpenState: () =>
          readBoolCandidate(
            adapter,
            target.address,
            ["tradingOpen", "tradingEnabled", "tradingActive"],
            blockNumber
          )
      },
      detectorRunContext
    );
    const genesispadLaunch = providers?.launchpad
      ? await providers.launchpad
          .getLaunchInfo({ adapter, chainId: target.chainId, tokenAddress: target.address })
          .catch(() => null)
      : null;
    const genesispadLaunchResult = await genesispadLaunchDetector.run(
      { launch: genesispadLaunch },
      detectorRunContext
    );
    // Explorers attribute contract creation to whichever address's CREATE/CREATE2 call directly
    // spawned the bytecode — for a token launched through a factory/launchpad, that's the
    // factory contract, never the person who actually signed and paid for the deployment.
    // Priority: (1) the on-chain GenesisLaunchRegistry's `originalCreator`, the most authoritative
    // source for GenesisPad's current direct-V3 launch model; (2) the creation transaction's own
    // sender when the explorer detected a factory-mediated deployment (deployerIsLaunchFactory) —
    // this generalizes to ANY launchpad, not just GenesisPad, since it's derived from the raw
    // transaction (tx.from vs. tx.to.is_contract), not a specific registry. Verified against a
    // real launchpad's launchToken transaction (Noxa Launchpad — also used by $CASHCAT, hence
    // the shared factory address — a third-party launchpad, not GenesisPad's own registry-
    // tracked launch flow) where both signals agree on the same real creator.
    const correctedDeployerAddress =
      genesispadLaunch?.originalCreator ??
      (tokenProfile.deployerIsLaunchFactory ? tokenProfile.creationTxSenderAddress : null);
    const effectiveDeployerAddress = correctedDeployerAddress ?? tokenProfile.deployerAddress;
    if (
      correctedDeployerAddress &&
      correctedDeployerAddress.toLowerCase() !== tokenProfile.deployerAddress?.toLowerCase()
    ) {
      await dependencies.scans
        .recordTokenProfile({ ...tokenProfile, deployerAddress: correctedDeployerAddress })
        .catch(() => undefined);
    }
    const deployerHistory = effectiveDeployerAddress
      ? await dependencies.scans
          .getDeployerHistory(target.chainId, effectiveDeployerAddress, target.address)
          .catch(() => null)
      : null;
    const bytecodeHash = bytecode !== "0x" ? hashBytecode(bytecode) : null;
    const bytecodeReuse = bytecodeHash
      ? await dependencies.scans
          .getBytecodeReuse(target.chainId, bytecodeHash, target.address)
          .catch(() => null)
      : null;
    const ownerAddressForEdges = readOwnerAddressFromDetectorResults(detectorResults);
    // Liquidity pools are normally discovered later, in the DISCOVERING_MARKETS stage — but
    // wallet-clustering needs to know pool addresses NOW, before that stage runs, so it never
    // mislabels a deployer seeding its own pool as "transferred supply to a wallet" (a token
    // launch legitimately sends the bulk of its supply to its own pool; that's expected
    // behavior, not a distribution risk). Fetched here once and reused at DISCOVERING_MARKETS
    // below instead of calling the provider twice.
    const discoveredPools = providers
      ? await providers.liquidity
          .discoverPools({ adapter, chainId: target.chainId, tokenAddress: target.address, blockNumber })
          .catch(() => null)
      : null;
    // Also excludes the chain's real locker contract (e.g. Genesis Locker) when one is wired —
    // the deployer sending supply there is a locking action, not a wallet transfer. Verified
    // against a real false positive ($GEN): ~1% of supply sent to the name-tagged GenesisLocker
    // contract was being reported as "transferred to another wallet" alongside genuinely
    // unlabeled recipients, when it's the opposite of a risk.
    const knownInfrastructureAddresses = new Set(
      [
        ...(discoveredPools ?? []).map((pool) => pool.poolAddress.toLowerCase()),
        ...(providers?.locker.lockerAddresses?.map((address) => address.toLowerCase()) ??
          (providers?.locker.lockerAddress
            ? [providers.locker.lockerAddress.toLowerCase()]
            : []))
      ]
    );
    const relatedWalletEdges = await buildRelatedWalletEdges({
      adapter,
      providers,
      chainId: target.chainId,
      tokenAddress: target.address,
      blockNumber,
      deployerAddress: effectiveDeployerAddress,
      ownerAddress: ownerAddressForEdges,
      totalSupply: tokenProfile.totalSupply,
      bytecodeReuse,
      knownPoolAddresses: knownInfrastructureAddresses
    });
    const deployerHistoryResult = await deployerHistoryDetector.run(
      {
        deployerHistory,
        bytecodeReuse,
        relatedWalletEdges,
        isMinimalProxy: eip1167ImplementationAddress(bytecode) !== null
      },
      detectorRunContext
    );
    const dexInteractionResult = await dexInteractionSurfaceDetector.run(
      { bytecode },
      detectorRunContext
    );
    const poolReserveResult = await poolReserveIntegrityDetector.run(
      {
        readPoolReserves: () =>
          readPoolReserveSamples(adapter, target.address, discoveredPools, blockNumber)
      },
      detectorRunContext
    );
    const transferGateResult = await transferGateDetector.run(
      {
        bytecode,
        resolveCode: (address) => readCodeAt(adapter, address, blockNumber),
        probeCall: (address, origin) => probeEmptyCall(adapter, address, origin, blockNumber),
        probeOrigins: transferGateProbeOrigins,
        ownershipRenounced:
          ownerAddressForEdges === null
            ? null
            : burnOrZeroAddresses.has(ownerAddressForEdges.toLowerCase()),
        ignoredAddresses: [
          robinhoodUniswapV2RouterAddress,
          robinhoodWrappedNativeAddress,
          ...(discoveredPools ?? []).map((pool) => pool.poolAddress),
          ...(discoveredPools ?? []).map((pool) => pool.quoteTokenAddress)
        ]
      },
      detectorRunContext
    );
    detectorResults.push(
      sourceDetectorResult,
      ownershipRolesResult,
      roleMembershipResult,
      liveTradingStateResult,
      genesispadLaunchResult,
      deployerHistoryResult,
      dexInteractionResult,
      poolReserveResult,
      transferGateResult
    );
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
    // discoveredPools was already fetched above (before wallet-clustering ran) — reused here
    // rather than calling providers.liquidity.discoverPools a second time.
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
    } else if (providers) {
      const coverage = providers.liquidity.describeCoverage();
      await dependencies.scans.recordStage({
        scanId: target.scanId,
        name: "DISCOVERING_MARKETS",
        status: "SUCCEEDED",
        completedAt: now(),
        metadata: {
          poolCount: 0,
          checkedDexes: coverage.checkedDexes,
          checkedQuoteSymbols: coverage.checkedQuoteSymbols,
          reason: `No pool found against configured quote tokens using ${coverage.discoveryTool}.`
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
    const holderSnapshot = providers
      ? await providers.holder
          .getHolderSnapshot({
            chainId: target.chainId,
            address: target.address,
            totalSupply: tokenProfile.totalSupply,
            context: {
              holderCount: tokenProfile.holderCount,
              deployerAddress: effectiveDeployerAddress,
              ownerAddress,
              liquidityPoolAddresses: discoveredPools?.map((pool) => pool.poolAddress) ?? [],
              relatedWalletAddresses: relatedWalletAddressesForHolders(relatedWalletEdges)
            }
          })
          .catch(() => null)
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

      // Runs here rather than with the contract detectors because it reconciles real holder
      // balances, which only exist once the holder snapshot has been taken.
      const ledgerIntegrityResult = await ledgerIntegrityDetector.run(
        {
          readReconciliation: () =>
            readLedgerReconciliation(adapter, target.address, {
              accounts: holderSnapshot.topHolders
                .slice(0, ledgerReconciliationAccountLimit)
                .map((holder) => holder.address),
              blockNumber
            })
        },
        detectorRunContext
      );
      holderDetectorResults.push(ledgerIntegrityResult);
      await dependencies.scans.recordDetectorResult({
        scanId: target.scanId,
        result: ledgerIntegrityResult,
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
      providers && discoveredPools && discoveredPools.length > 0
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
    const riskAssessment = scoreFindings(allDetectorResults, scannerVersion);
    await dependencies.scans.recordRiskAssessment({
      scanId: target.scanId,
      assessment: riskAssessment
    });
    await dependencies.scans.recordStage({
      scanId: target.scanId,
      name: "SCORING",
      status: riskAssessment.score === null ? "SKIPPED" : "SUCCEEDED",
      completedAt: now(),
      metadata:
        riskAssessment.score === null
          ? {
              reason: "No detector findings were available to score.",
              unableToAssessReasons: riskAssessment.unableToAssessReasons
            }
          : {
              score: riskAssessment.score,
              level: riskAssessment.level,
              scoringVersion: riskAssessment.scoringVersion
            }
    });

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

async function collectTokenProfile(
  adapter: ChainAdapter,
  providers: ProviderSet | null,
  input: TokenProfileInput
) {
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
      creationTxSenderAddress: null,
      deployerIsLaunchFactory: false,
      contractCreatedAt: null,
      creationTxHash: null,
      tokenType: null,
      iconUrl: null,
      reputation: null,
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null,
      dexPaid: null
    };
  }

  const [metadata, explorer, market] = await Promise.all([
    adapter.getTokenMetadata(input.address).catch(() => null),
    providers
      ? providers.explorer
          .getTokenProfile({ chainId: input.chainId, address: input.address })
          .catch(() => null)
      : Promise.resolve(null),
    providers
      ? providers.market
          .getMarketProfile({ chainId: input.chainId, address: input.address })
          .catch(() => null)
      : Promise.resolve(null)
  ]);

  return {
    chainId: input.chainId,
    address: input.address,
    blockNumber: input.blockNumber,
    name: metadata?.name ?? explorer?.name ?? market?.name ?? null,
    symbol: metadata?.symbol ?? explorer?.symbol ?? market?.symbol ?? null,
    decimals: metadata?.decimals ?? explorer?.decimals ?? null,
    totalSupply: explorer?.totalSupply ?? null,
    holderCount: explorer?.holderCount ?? null,
    sourceVerified: explorer?.sourceVerified ?? null,
    deployerAddress: explorer?.deployerAddress ?? null,
    creationTxSenderAddress: explorer?.creationTxSenderAddress ?? null,
    deployerIsLaunchFactory: explorer?.deployerIsLaunchFactory ?? false,
    contractCreatedAt: explorer?.contractCreatedAt ?? market?.pairCreatedAt ?? null,
    creationTxHash: explorer?.creationTxHash ?? null,
    tokenType: explorer?.tokenType ?? market?.labels ?? null,
    iconUrl: explorer?.iconUrl ?? market?.iconUrl ?? null,
    reputation: explorer?.reputation ?? null,
    priceUsd: explorer?.priceUsd ?? market?.priceUsd ?? null,
    marketCapUsd: explorer?.marketCapUsd ?? market?.marketCapUsd ?? null,
    volume24hUsd: explorer?.volume24hUsd ?? market?.volume24hUsd ?? null,
    dexPaid: market?.dexPaid ?? null
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "eth_call reverted";
}
