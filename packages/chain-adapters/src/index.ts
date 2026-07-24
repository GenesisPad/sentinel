import type { AppEnv } from "@genesis-sentinel/config";
import type { Abi, Chain, Hash, Hex, PublicClient } from "viem";
import { createPublicClient, fallback, http, isAddress, parseAbi, zeroAddress } from "viem";
import { normalizeEvmAddress } from "@genesis-sentinel/shared";

export interface ChainConfig {
  chainId: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    primary?: string;
    fallbacks: string[];
    publicDefault?: string;
  };
  blockExplorers: Array<{
    name: string;
    url: string;
  }>;
  productionNotes: string[];
}

export interface ChainBlock {
  number: bigint;
  timestamp: bigint;
  hash: Hash | null;
}

export interface ContractReadInput<TAbi extends Abi = Abi, TFunctionName extends string = string> {
  address: `0x${string}`;
  abi: TAbi;
  functionName: TFunctionName;
  args?: readonly unknown[];
  blockNumber?: bigint;
}

export interface LogQuery {
  address?: `0x${string}` | `0x${string}`[];
  fromBlock?: bigint;
  toBlock?: bigint;
  topics?: readonly (Hex | Hex[] | null)[];
}

export interface ChainLog {
  address: `0x${string}`;
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex: number | null;
  topics: Hex[];
  data: Hex;
}

interface RpcLogResult {
  address: `0x${string}`;
  blockNumber: Hex | null;
  transactionHash: Hash | null;
  logIndex: Hex | null;
  topics: Hex[];
  data: Hex;
}

export interface ChainTransaction {
  hash: Hash;
  blockNumber: bigint | null;
  from: `0x${string}`;
  to: `0x${string}` | null;
  input: Hex;
  value: bigint;
}

export interface ChainReceipt {
  transactionHash: Hash;
  blockNumber: bigint;
  status: "success" | "reverted";
  gasUsed: bigint;
  contractAddress: `0x${string}` | null;
}

export interface TraceCallInput {
  from?: `0x${string}`;
  to: `0x${string}`;
  data?: Hex;
  value?: bigint;
  blockNumber?: bigint;
  /** Per-address state overrides for this call only (e.g. a synthetic native balance so a
   * zero-balance static-check wallet can probe a payable call without a real funding
   * transaction). Never persisted or broadcast — scoped to this one `eth_call`. */
  stateOverride?: Array<{ address: `0x${string}`; balance?: bigint }>;
}

export interface TraceResult {
  raw: unknown;
}

export interface TokenMetadata {
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}

export interface ChainAdapter {
  readonly chainId: number;
  readonly name: string;

  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<ChainBlock>;
  getBytecode(input: { address: `0x${string}`; blockNumber?: bigint }): Promise<Hex>;
  getStorageAt(input: { address: `0x${string}`; slot: Hex; blockNumber?: bigint }): Promise<Hex>;
  readContract<T>(input: ContractReadInput): Promise<T>;
  getLogs(input: LogQuery): Promise<ChainLog[]>;
  getTransaction(input: { hash: Hash }): Promise<ChainTransaction | null>;
  getTransactionReceipt(input: { hash: Hash }): Promise<ChainReceipt | null>;
  traceCall?(input: TraceCallInput): Promise<TraceResult>;
  getTokenMetadata(address: `0x${string}`): Promise<TokenMetadata>;
}

export const robinhoodChainPublicRpcUrl = "https://rpc.mainnet.chain.robinhood.com";
export const robinhoodChainBlockscoutUrl = "https://robinhoodchain.blockscout.com";

export const arcChainId = 5042;
export const arcChainPublicRpcUrl = "https://rpc.blockdaemon.mainnet.arc.io";
export const arcChainBlockscoutUrl = "https://arcscan.cc";

export const arcChainConfig: ChainConfig = {
  chainId: arcChainId,
  name: "Arc Chain",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  },
  rpcUrls: {
    publicDefault: arcChainPublicRpcUrl,
    fallbacks: []
  },
  blockExplorers: [
    {
      name: "ArcScan",
      url: arcChainBlockscoutUrl
    }
  ],
  productionNotes: [
    "Arc mainnet RPC is not officially published by Circle yet; configure ARC_RPC_URL for production.",
    "Arc uses USDC as native gas token with 18 decimals for gas/msg.value and 6 decimals for ERC-20."
  ]
};

export const stableChainId = 988;
export const stableChainPublicRpcUrl = "https://stable.drpc.org";
export const stableChainBlockscoutUrl = "https://stablescan.xyz";

export const stableChainConfig: ChainConfig = {
  chainId: stableChainId,
  name: "Stable Chain",
  nativeCurrency: {
    name: "USDT0",
    symbol: "USDT0",
    decimals: 18
  },
  rpcUrls: {
    publicDefault: stableChainPublicRpcUrl,
    fallbacks: []
  },
  blockExplorers: [
    {
      name: "StableScan",
      url: stableChainBlockscoutUrl
    }
  ],
  productionNotes: [
    "Stable's public RPC is rate-limited to 1,000 requests per 10 seconds per IP.",
    "Configure STABLE_RPC_URL and STABLE_FALLBACK_RPC_URLS for production deployments."
  ]
};

export const robinhoodChainConfig: ChainConfig = {
  chainId: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    publicDefault: robinhoodChainPublicRpcUrl,
    fallbacks: []
  },
  blockExplorers: [
    {
      name: "Robinhood Chain Blockscout",
      url: robinhoodChainBlockscoutUrl
    }
  ],
  productionNotes: [
    "Robinhood's public RPC is rate-limited and should not be treated as production-grade high-throughput infrastructure.",
    "Configure ROBINHOOD_RPC_URL and ROBINHOOD_FALLBACK_RPC_URLS for production deployments."
  ]
};

const erc20MetadataAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
]);

export function getRobinhoodChainConfig(
  env: Pick<AppEnv, "ROBINHOOD_RPC_URL" | "ROBINHOOD_FALLBACK_RPC_URLS">
): ChainConfig {
  const fallbacks = parseRpcUrlList(env.ROBINHOOD_FALLBACK_RPC_URLS);
  const rpcUrls: ChainConfig["rpcUrls"] = {
    publicDefault: robinhoodChainPublicRpcUrl,
    fallbacks
  };

  if (env.ROBINHOOD_RPC_URL) {
    rpcUrls.primary = env.ROBINHOOD_RPC_URL;
  }

  return {
    ...robinhoodChainConfig,
    rpcUrls
  };
}

export function parseRpcUrlList(value: string): string[] {
  return value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function resolveRpcUrls(
  config: ChainConfig,
  options?: { allowPublicDefault?: boolean }
): string[] {
  const urls = [config.rpcUrls.primary, ...config.rpcUrls.fallbacks].filter((url): url is string =>
    Boolean(url)
  );

  if (urls.length === 0 && options?.allowPublicDefault === true && config.rpcUrls.publicDefault) {
    return [config.rpcUrls.publicDefault];
  }

  return urls;
}

export function getArcChainConfig(
  env: Pick<AppEnv, "ARC_RPC_URL" | "ARC_FALLBACK_RPC_URLS">
): ChainConfig {
  const fallbacks = parseRpcUrlList(env.ARC_FALLBACK_RPC_URLS);
  const rpcUrls: ChainConfig["rpcUrls"] = {
    publicDefault: arcChainPublicRpcUrl,
    fallbacks
  };
  if (env.ARC_RPC_URL) {
    rpcUrls.primary = env.ARC_RPC_URL;
  }
  return {
    ...arcChainConfig,
    rpcUrls
  };
}

export function getStableChainConfig(
  env: Pick<AppEnv, "STABLE_RPC_URL" | "STABLE_FALLBACK_RPC_URLS">
): ChainConfig {
  const fallbacks = parseRpcUrlList(env.STABLE_FALLBACK_RPC_URLS);
  const rpcUrls: ChainConfig["rpcUrls"] = {
    publicDefault: stableChainPublicRpcUrl,
    fallbacks
  };
  if (env.STABLE_RPC_URL) {
    rpcUrls.primary = env.STABLE_RPC_URL;
  }
  return {
    ...stableChainConfig,
    rpcUrls
  };
}

export function createRobinhoodChainAdapter(
  env: Pick<AppEnv, "ROBINHOOD_RPC_URL" | "ROBINHOOD_FALLBACK_RPC_URLS">,
  options?: { allowPublicDefault?: boolean }
): ChainAdapter {
  const config = getRobinhoodChainConfig(env);
  return createViemChainAdapter(config, options);
}

export function createArcChainAdapter(
  env: Pick<AppEnv, "ARC_RPC_URL" | "ARC_FALLBACK_RPC_URLS">,
  options?: { allowPublicDefault?: boolean }
): ChainAdapter {
  const config = getArcChainConfig(env);
  return createViemChainAdapter(config, options);
}

export function createStableChainAdapter(
  env: Pick<AppEnv, "STABLE_RPC_URL" | "STABLE_FALLBACK_RPC_URLS">,
  options?: { allowPublicDefault?: boolean }
): ChainAdapter {
  const config = getStableChainConfig(env);
  return createViemChainAdapter(config, options);
}

export function createViemChainAdapter(
  config: ChainConfig,
  options?: {
    client?: PublicClient;
    allowPublicDefault?: boolean;
  }
): ChainAdapter {
  const client = options?.client ?? createClient(config, options);

  return {
    chainId: config.chainId,
    name: config.name,

    async getBlockNumber() {
      return client.getBlockNumber();
    },

    async getBlock(input) {
      const block = await client.getBlock({ blockNumber: input.blockNumber });
      return {
        number: block.number ?? input.blockNumber,
        timestamp: block.timestamp,
        hash: block.hash
      };
    },

    async getBytecode(input) {
      assertAddress(input.address);
      return (
        (await client.getBytecode({
          address: normalizeEvmAddress(input.address),
          blockNumber: input.blockNumber
        })) ?? "0x"
      );
    },

    async getStorageAt(input) {
      assertAddress(input.address);
      return (
        (await client.getStorageAt({
          address: normalizeEvmAddress(input.address),
          slot: input.slot,
          blockNumber: input.blockNumber
        })) ?? `0x${"0".repeat(64)}`
      );
    },

    async readContract<T>(input: ContractReadInput) {
      assertAddress(input.address);
      const readInput = {
        address: normalizeEvmAddress(input.address),
        abi: input.abi,
        functionName: input.functionName
      } satisfies {
        address: `0x${string}`;
        abi: Abi;
        functionName: string;
      };

      const result: unknown = await client.readContract({
        ...readInput,
        args: input.args,
        blockNumber: input.blockNumber
      });

      return result as T;
    },

    async getLogs(input) {
      const filter = {
        ...(input.address ? { address: input.address } : {}),
        ...(input.fromBlock !== undefined ? { fromBlock: toRpcBlock(input.fromBlock) } : {}),
        ...(input.toBlock !== undefined ? { toBlock: toRpcBlock(input.toBlock) } : {}),
        ...(input.topics ? { topics: [...input.topics] } : {})
      };
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [filter]
      })) as unknown as RpcLogResult[];

      return logs.map((log) => ({
        address: normalizeEvmAddress(log.address),
        blockNumber: log.blockNumber ? BigInt(log.blockNumber) : null,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex ? Number(BigInt(log.logIndex)) : null,
        topics: [...log.topics],
        data: log.data
      }));
    },

    async getTransaction(input) {
      const transaction = await client.getTransaction(input).catch((error: unknown) => {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      });

      if (!transaction) {
        return null;
      }

      return {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
        from: normalizeEvmAddress(transaction.from),
        to: transaction.to ? normalizeEvmAddress(transaction.to) : null,
        input: transaction.input,
        value: transaction.value
      };
    },

    async getTransactionReceipt(input) {
      const receipt = await client.getTransactionReceipt(input).catch((error: unknown) => {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      });

      if (!receipt) {
        return null;
      }

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
        contractAddress: receipt.contractAddress
          ? normalizeEvmAddress(receipt.contractAddress)
          : null
      };
    },

    async traceCall(input) {
      assertAddress(input.to);
      const result = await client.call({
        account: input.from,
        to: normalizeEvmAddress(input.to),
        data: input.data,
        value: input.value,
        blockNumber: input.blockNumber,
        ...(input.stateOverride
          ? {
              stateOverride: input.stateOverride.map((override) => ({
                address: override.address,
                ...(override.balance !== undefined ? { balance: override.balance } : {})
              }))
            }
          : {})
      });

      return {
        raw: result.data ?? "0x"
      };
    },

    async getTokenMetadata(address) {
      assertAddress(address);
      const normalizedAddress = normalizeEvmAddress(address);
      const [name, symbol, decimals] = await Promise.all([
        safeReadContract<string>(client, normalizedAddress, "name"),
        safeReadContract<string>(client, normalizedAddress, "symbol"),
        safeReadContract<number>(client, normalizedAddress, "decimals")
      ]);

      return {
        address: normalizedAddress,
        name,
        symbol,
        decimals
      };
    }
  };
}

function toRpcBlock(blockNumber: bigint): Hex {
  return `0x${blockNumber.toString(16)}`;
}

function createClient(
  config: ChainConfig,
  options?: { allowPublicDefault?: boolean }
): PublicClient {
  const urls = resolveRpcUrls(config, options);
  if (urls.length === 0) {
    throw new Error(`No RPC URL configured for ${config.name}.`);
  }

  return createPublicClient({
    chain: toViemChain(config),
    transport: fallback(urls.map((url) => http(url, { timeout: 10_000 })))
  });
}

function toViemChain(config: ChainConfig): Chain {
  const defaultRpcUrl =
    config.rpcUrls.primary ?? config.rpcUrls.publicDefault ?? config.rpcUrls.fallbacks[0];
  const explorer = config.blockExplorers[0];

  if (!defaultRpcUrl) {
    throw new Error(`No RPC URL configured for ${config.name}.`);
  }

  return {
    id: config.chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: {
        http: [defaultRpcUrl]
      }
    },
    blockExplorers: explorer
      ? {
          default: explorer
        }
      : undefined
  };
}

function assertAddress(address: `0x${string}`): void {
  if (!isAddress(address, { strict: false }) || address === zeroAddress) {
    throw new Error("Expected a non-zero EVM address.");
  }
}

async function safeReadContract<T>(
  client: PublicClient,
  address: `0x${string}`,
  functionName: "name" | "symbol" | "decimals"
): Promise<T | null> {
  try {
    return (await client.readContract({
      address,
      abi: erc20MetadataAbi,
      functionName
    })) as T;
  } catch {
    return null;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /not found|could not find|not be found/i.test(error.message);
}
