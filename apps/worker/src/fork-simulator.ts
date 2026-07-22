import net from "node:net";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AppEnv } from "@genesis-sentinel/config";
import type {
  ForkTradeSimulator,
  ForkTradeSimulatorInput,
  ForkTradeSimulatorResult
} from "./scan-worker.js";

const forkPrivateKey =
  "0x59c6995e998f97a5a0044966f0945384919a58a7c5b7ac3998c1c39a754e0b82" as const;
const forkNativeBalance = 100_000_000_000_000_000_000n;
const robinhoodUniswapV2RouterAddress = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" as const;
const robinhoodWrappedNativeAddress = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;
// Uniswap V3 SwapRouter02, verified by reading GenesisProtocolConfig.swapRouter() live on-chain
// (0x4C8a488f3C1139B189AFF60cac97787BCe9684F2) and cross-checked against Blockscout, which
// reports this address as a verified contract named "SwapRouter02".
const robinhoodUniswapV3RouterAddress = "0xcaf681a66d020601342297493863e78c959e5cb2" as const;
const routerAbi = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) payable"
]);
const swapRouter02Abi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)"
]);
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)"
]);
const wethAbi = parseAbi(["function deposit() external payable"]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)"
]);
const v3PoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function token0() view returns (address)"
]);
const uniswapV3PriceQ192 = 2n ** 192n;

/** Same spot-price approximation as scan-worker.ts's route-quote tier — used here only to
 * compute an expected-output baseline for tax-percentage comparison against the fork's real
 * measured V3 sell output. */
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

/**
 * Formats a bigint as a JSON-RPC quantity (0x-prefixed hex).
 *
 * Ganache validates account balances as JSON-RPC quantities and rejects decimal strings with
 * "Cannot wrap string value ... must be prefixed with 0x". Because that rejection happens while
 * building the server — before the fork starts — and the caller catches fork errors, passing a
 * decimal string made every scan fall back to route-quote with no error surfaced anywhere.
 * Honeypot and tax then read "unknown" on every token, which looked like missing data rather
 * than a broken simulator.
 */
export function toJsonRpcQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

export function createGanacheForkTradeSimulator(env: AppEnv): ForkTradeSimulator | undefined {
  if (!env.SIMULATION_FORK_ENABLED || !env.ROBINHOOD_RPC_URL) {
    return undefined;
  }

  return (input) =>
    withTimeout(
      runGanacheForkTradeSimulation(input, {
        rpcUrl: env.ROBINHOOD_RPC_URL!,
        nativeAmountWei: BigInt(env.SIMULATION_FORK_NATIVE_AMOUNT_WEI)
      }),
      env.SIMULATION_FORK_TIMEOUT_MS
    );
}

async function runGanacheForkTradeSimulation(
  input: ForkTradeSimulatorInput,
  config: { rpcUrl: string; nativeAmountWei: bigint }
): Promise<ForkTradeSimulatorResult | null> {
  if (input.quoteTokenAddress.toLowerCase() !== robinhoodWrappedNativeAddress.toLowerCase()) {
    return null;
  }

  const port = await getFreePort();
  const server = ganache.server({
    logging: { quiet: true },
    fork: {
      url: config.rpcUrl,
      blockNumber: Number(input.blockNumber)
    },
    wallet: {
      accounts: [{ secretKey: forkPrivateKey, balance: toJsonRpcQuantity(forkNativeBalance) }]
    },
    miner: {
      blockGasLimit: 30_000_000n
    },
    chain: {
      chainId: input.chainId
    }
  });

  try {
    await server.listen(port, "127.0.0.1");
    const localRpcUrl = `http://127.0.0.1:${port}`;
    const chain = createForkChain(input.chainId, localRpcUrl);
    const account = privateKeyToAccount(forkPrivateKey);
    const publicClient = createPublicClient({ chain, transport: http(localRpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(localRpcUrl) });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);

    const isV3 = input.dex === "Uniswap V3";
    if (isV3 && !input.feeTier) {
      return {
        simulationTool: "0.1.0-ganache-fork",
        canBuy: false,
        canSell: false,
        isHoneypot: true,
        buyTaxBps: null,
        sellTaxBps: null,
        error: "Missing Uniswap V3 fee tier; cannot route a fork swap for this pool."
      };
    }

    const tokenBeforeBuy = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    let buyTxHash: `0x${string}`;
    if (isV3) {
      await walletClient.writeContract({
        address: robinhoodWrappedNativeAddress,
        abi: wethAbi,
        functionName: "deposit",
        value: config.nativeAmountWei,
        gas: 200_000n
      });
      await walletClient.writeContract({
        address: robinhoodWrappedNativeAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [robinhoodUniswapV3RouterAddress, config.nativeAmountWei],
        gas: 200_000n
      });
      buyTxHash = await walletClient.writeContract({
        address: robinhoodUniswapV3RouterAddress,
        abi: swapRouter02Abi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: robinhoodWrappedNativeAddress,
            tokenOut: input.tokenAddress,
            fee: input.feeTier!,
            recipient: account.address,
            amountIn: config.nativeAmountWei,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n
          }
        ],
        gas: 3_000_000n
      });
    } else {
      buyTxHash = await walletClient.writeContract({
        address: robinhoodUniswapV2RouterAddress,
        abi: routerAbi,
        functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
        args: [0n, [robinhoodWrappedNativeAddress, input.tokenAddress], account.address, deadline],
        value: config.nativeAmountWei,
        gas: 3_000_000n
      });
    }
    await publicClient.waitForTransactionReceipt({ hash: buyTxHash });
    const tokenAfterBuy = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    const buyReceived = tokenAfterBuy - tokenBeforeBuy;
    const buyReceipt = await publicClient.getTransactionReceipt({ hash: buyTxHash });
    if (buyReceived <= 0n) {
      return {
        simulationTool: "0.1.0-ganache-fork",
        canBuy: false,
        canSell: false,
        isHoneypot: true,
        buyTaxBps: null,
        sellTaxBps: null,
        buyTxHash,
        buyGasUsed: buyReceipt.gasUsed.toString(),
        buyTokenReceivedRaw: buyReceived.toString(),
        error: "Forked buy completed but received no tokens."
      };
    }

    const buyTaxBps = taxBps(input.expectedBuyTokenOutRaw, buyReceived);

    // Small wallet-to-wallet transfer test against a second, freshly generated fork-only
    // account — measures transfer tax and whether transfers are blocked outright, distinct
    // from the sell-leg transfer inside the router swap.
    const transferTestAmount = buyReceived / 10n > 0n ? buyReceived / 10n : buyReceived;
    const transferTest = await runTransferTest(publicClient, walletClient, {
      tokenAddress: input.tokenAddress,
      from: account.address,
      amount: transferTestAmount
    });

    const remainingAfterTransfer = buyReceived - (transferTest.succeeded ? transferTestAmount : 0n);
    const partialSellAmount =
      remainingAfterTransfer / 10n > 0n ? remainingAfterTransfer / 10n : remainingAfterTransfer;
    const partialSellTest = await runSellTest(publicClient, walletClient, input, {
      tokenAddress: input.tokenAddress,
      account: account.address,
      amount: partialSellAmount,
      deadline
    });

    const remainderForFullSell = remainingAfterTransfer - (partialSellTest.succeeded ? partialSellAmount : 0n);
    const fullSell = await runSellTest(publicClient, walletClient, input, {
      tokenAddress: input.tokenAddress,
      account: account.address,
      amount: remainderForFullSell > 0n ? remainderForFullSell : remainingAfterTransfer,
      deadline
    });
    const sellReceived = fullSell.received;

    return {
      simulationTool: "0.1.0-ganache-fork",
      canBuy: true,
      canSell: sellReceived > 0n,
      isHoneypot: sellReceived <= 0n,
      buyTaxBps,
      sellTaxBps: fullSell.taxBps,
      buyTokenReceivedRaw: buyReceived.toString(),
      sellQuoteReceivedRaw: sellReceived.toString(),
      buyTxHash,
      buyGasUsed: buyReceipt.gasUsed.toString(),
      partialSellSucceeded: partialSellTest.succeeded,
      partialSellTaxBps: partialSellTest.taxBps,
      transferSucceeded: transferTest.succeeded,
      transferTaxBps: transferTest.taxBps,
      ...(fullSell.txHash ? { sellTxHash: fullSell.txHash } : {}),
      ...(fullSell.gasUsed ? { sellGasUsed: fullSell.gasUsed } : {}),
      ...(transferTest.txHash ? { transferTxHash: transferTest.txHash } : {}),
      ...(sellReceived <= 0n ? { error: "Forked sell completed but returned no quote token." } : {})
    };
  } catch (error) {
    return {
      simulationTool: "0.1.0-ganache-fork",
      canBuy: false,
      canSell: false,
      isHoneypot: true,
      buyTaxBps: null,
      sellTaxBps: null,
      error: error instanceof Error ? error.message : "Forked trade simulation failed."
    };
  } finally {
    await server.close().catch(() => undefined);
  }
}

interface TransferTestResult {
  succeeded: boolean;
  taxBps: number | null;
  txHash?: `0x${string}`;
}

/**
 * Wallet-to-wallet transfer test: sends `amount` from the fork buyer to a second, freshly
 * generated fork-only account (never funded, never used outside this fork) and measures
 * received vs sent to detect transfer tax or an outright transfer block.
 */
async function runTransferTest(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  input: { tokenAddress: `0x${string}`; from: `0x${string}`; amount: bigint }
): Promise<TransferTestResult> {
  if (input.amount <= 0n) {
    return { succeeded: false, taxBps: null };
  }

  const recipient = privateKeyToAccount(generatePrivateKey());
  try {
    const balanceBefore = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [recipient.address]
    });
    const txHash = await walletClient.writeContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient.address, input.amount],
      gas: 200_000n,
      account: input.from,
      chain: null
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    const balanceAfter = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [recipient.address]
    });
    const received = balanceAfter - balanceBefore;

    return {
      succeeded: received > 0n,
      taxBps: taxBps(input.amount, received),
      txHash
    };
  } catch {
    return { succeeded: false, taxBps: null };
  }
}

interface SellTestResult {
  succeeded: boolean;
  taxBps: number | null;
  received: bigint;
  txHash?: `0x${string}`;
  gasUsed?: string;
}

/** Approves and sells `amount` of the token via the router, reusing live pool reserves to
 * compute the expected quote output for tax comparison. Used for both the small partial-sell
 * test and the final full/remainder sell so "small sell passes, large sell fails" is
 * distinguishable from a flat honeypot. */
async function runSellTest(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  input: ForkTradeSimulatorInput,
  params: { tokenAddress: `0x${string}`; account: `0x${string}`; amount: bigint; deadline: bigint }
): Promise<SellTestResult> {
  if (params.amount <= 0n) {
    return { succeeded: false, taxBps: null, received: 0n };
  }

  const isV3 = input.dex === "Uniswap V3";

  try {
    const routerAddress = isV3 ? robinhoodUniswapV3RouterAddress : robinhoodUniswapV2RouterAddress;
    const approveTxHash = await walletClient.writeContract({
      address: params.tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [routerAddress, params.amount],
      gas: 500_000n,
      account: params.account,
      chain: null
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

    const expectedOut = isV3
      ? await expectedV3SellOut(publicClient, input, params.amount)
      : await expectedSellOutAfterBuy(publicClient, input, params.amount);
    const quoteBefore = await publicClient.readContract({
      address: robinhoodWrappedNativeAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [params.account]
    });
    const txHash = isV3
      ? await walletClient.writeContract({
          address: robinhoodUniswapV3RouterAddress,
          abi: swapRouter02Abi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: params.tokenAddress,
              tokenOut: robinhoodWrappedNativeAddress,
              fee: input.feeTier!,
              recipient: params.account,
              amountIn: params.amount,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n
            }
          ],
          gas: 3_000_000n,
          account: params.account,
          chain: null
        })
      : await walletClient.writeContract({
          address: robinhoodUniswapV2RouterAddress,
          abi: routerAbi,
          functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
          args: [
            params.amount,
            0n,
            [params.tokenAddress, robinhoodWrappedNativeAddress],
            params.account,
            params.deadline
          ],
          gas: 3_000_000n,
          account: params.account,
          chain: null
        });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const quoteAfter = await publicClient.readContract({
      address: robinhoodWrappedNativeAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [params.account]
    });
    const received = quoteAfter - quoteBefore;

    return {
      succeeded: received > 0n,
      taxBps: taxBps(expectedOut, received),
      received,
      txHash,
      gasUsed: receipt.gasUsed.toString()
    };
  } catch {
    return { succeeded: false, taxBps: null, received: 0n };
  }
}

async function expectedSellOutAfterBuy(
  publicClient: ReturnType<typeof createPublicClient>,
  input: ForkTradeSimulatorInput,
  amountIn: bigint
): Promise<bigint> {
  const [reserves, token0] = await Promise.all([
    publicClient.readContract({
      address: input.poolAddress,
      abi: pairAbi,
      functionName: "getReserves"
    }),
    publicClient.readContract({
      address: input.poolAddress,
      abi: pairAbi,
      functionName: "token0"
    })
  ]);
  const tokenIsToken0 = token0.toLowerCase() === input.tokenAddress.toLowerCase();
  const reserveToken = tokenIsToken0 ? reserves[0] : reserves[1];
  const reserveQuote = tokenIsToken0 ? reserves[1] : reserves[0];

  return getAmountOut(amountIn, reserveToken, reserveQuote);
}

/** V3 counterpart to expectedSellOutAfterBuy — reads the pool's live post-buy spot price
 * instead of constant-product reserves. */
async function expectedV3SellOut(
  publicClient: ReturnType<typeof createPublicClient>,
  input: ForkTradeSimulatorInput,
  amountIn: bigint
): Promise<bigint> {
  const [slot0, token0] = await Promise.all([
    publicClient.readContract({
      address: input.poolAddress,
      abi: v3PoolAbi,
      functionName: "slot0"
    }),
    publicClient.readContract({
      address: input.poolAddress,
      abi: v3PoolAbi,
      functionName: "token0"
    })
  ]);
  const tokenIsToken0 = token0.toLowerCase() === input.tokenAddress.toLowerCase();

  return getV3SpotAmountOut(amountIn, slot0[0], tokenIsToken0);
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0n;
  }

  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function taxBps(expected: bigint, actual: bigint): number | null {
  if (expected <= 0n || actual >= expected) {
    return expected > 0n ? 0 : null;
  }

  return Number(((expected - actual) * 10_000n) / expected);
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Could not reserve a local fork port."));
        }
      });
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Fork simulation timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createForkChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: "Genesis Sentinel local fork",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [rpcUrl]
      }
    }
  };
}
