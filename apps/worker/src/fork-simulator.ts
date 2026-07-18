import net from "node:net";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
const routerAbi = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) payable"
]);
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)"
]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)"
]);

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
      accounts: [{ secretKey: forkPrivateKey, balance: forkNativeBalance.toString() }]
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

    const tokenBeforeBuy = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    const buyTxHash = await walletClient.writeContract({
      address: robinhoodUniswapV2RouterAddress,
      abi: routerAbi,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [0n, [robinhoodWrappedNativeAddress, input.tokenAddress], account.address, deadline],
      value: config.nativeAmountWei,
      gas: 3_000_000n
    });
    await publicClient.waitForTransactionReceipt({ hash: buyTxHash });
    const tokenAfterBuy = await publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    const buyReceived = tokenAfterBuy - tokenBeforeBuy;
    if (buyReceived <= 0n) {
      return {
        simulationTool: "0.1.0-ganache-fork",
        canBuy: false,
        canSell: false,
        isHoneypot: true,
        buyTaxBps: null,
        sellTaxBps: null,
        buyTxHash,
        buyTokenReceivedRaw: buyReceived.toString(),
        error: "Forked buy completed but received no tokens."
      };
    }

    const buyTaxBps = taxBps(input.expectedBuyTokenOutRaw, buyReceived);
    const approveTxHash = await walletClient.writeContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [robinhoodUniswapV2RouterAddress, buyReceived],
      gas: 500_000n
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

    const expectedSellQuoteOut = await expectedSellOutAfterBuy(publicClient, input, buyReceived);
    const quoteBeforeSell = await publicClient.readContract({
      address: robinhoodWrappedNativeAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    const sellTxHash = await walletClient.writeContract({
      address: robinhoodUniswapV2RouterAddress,
      abi: routerAbi,
      functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      args: [
        buyReceived,
        0n,
        [input.tokenAddress, robinhoodWrappedNativeAddress],
        account.address,
        deadline
      ],
      gas: 3_000_000n
    });
    await publicClient.waitForTransactionReceipt({ hash: sellTxHash });
    const quoteAfterSell = await publicClient.readContract({
      address: robinhoodWrappedNativeAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    const sellReceived = quoteAfterSell - quoteBeforeSell;

    return {
      simulationTool: "0.1.0-ganache-fork",
      canBuy: true,
      canSell: sellReceived > 0n,
      isHoneypot: sellReceived <= 0n,
      buyTaxBps,
      sellTaxBps: taxBps(expectedSellQuoteOut, sellReceived),
      buyTokenReceivedRaw: buyReceived.toString(),
      sellQuoteReceivedRaw: sellReceived.toString(),
      buyTxHash,
      sellTxHash,
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
