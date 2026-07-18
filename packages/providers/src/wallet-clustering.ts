import { parseAbiItem, toEventSelector, type Hex } from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import type { RelatedWalletEdge } from "@genesis-sentinel/shared";
import { decimalStringValue, fetchJson, isRecord, stringValue } from "./http.js";

export interface WalletClusteringProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  findFundingWallet(input: {
    chainId: number;
    address: `0x${string}`;
  }): Promise<RelatedWalletEdge | null>;
  findSupplyTransfers(input: {
    adapter: ChainAdapter;
    chainId: number;
    tokenAddress: `0x${string}`;
    deployerAddress: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
    totalSupply: string | null;
  }): Promise<RelatedWalletEdge[]>;
}

/**
 * Real, evidence-backed wallet-relationship edges (Milestone 6) — never inferred from timing
 * coincidence (e.g. two wallets buying near the same time is explicitly NOT sufficient
 * evidence on its own). Each function here returns edges only when it found a concrete
 * on-chain observation, and documents the bound it searched within.
 */

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
const transferTopic = toEventSelector(transferEvent);

export interface SupplyTransferScanInput {
  tokenAddress: `0x${string}`;
  deployerAddress: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  totalSupply: string | null;
}

/**
 * Scans ERC20 Transfer events from the deployer address within [fromBlock, toBlock] and
 * reports recipients that received at least 1% of total supply (or any nonzero amount when
 * total supply isn't known) as TRANSFERRED_SUPPLY_TO edges. Bounded by the caller-supplied
 * block range — does not scan beyond it.
 */
export async function findSupplyTransfersFromDeployer(
  adapter: ChainAdapter,
  input: SupplyTransferScanInput,
  options: { minSupplyPctThreshold?: number; maxEdges?: number } = {}
): Promise<RelatedWalletEdge[]> {
  const thresholdPct = options.minSupplyPctThreshold ?? 1;
  const maxEdges = options.maxEdges ?? 10;

  let total: bigint | null = null;
  if (input.totalSupply) {
    try {
      total = BigInt(input.totalSupply);
    } catch {
      total = null;
    }
  }

  try {
    const logs = await adapter.getLogs({
      address: input.tokenAddress,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      topics: [transferTopic, addressToTopic(input.deployerAddress)]
    });

    const edges: RelatedWalletEdge[] = [];
    const seen = new Set<string>();
    for (const log of logs) {
      const toTopic = log.topics[2];
      if (log.topics.length < 3 || !toTopic) continue;

      const toAddress = topicToAddress(toTopic);
      let amount: bigint;
      try {
        amount = BigInt(log.data);
      } catch {
        continue;
      }
      if (amount <= 0n) continue;

      const pct = total && total > 0n ? Number((amount * 10_000n) / total) / 100 : null;
      if (pct !== null && pct < thresholdPct) continue;

      const key = toAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        type: "TRANSFERRED_SUPPLY_TO",
        address: toAddress,
        confidence: "HIGH",
        evidence:
          pct !== null
            ? `Deployer transferred ~${pct.toFixed(1)}% of total supply to this address (block ${log.blockNumber ?? "unknown"}).`
            : `Deployer transferred ${amount.toString()} raw token units to this address (block ${log.blockNumber ?? "unknown"}); total supply was unavailable to compute a percentage.`,
        source: "erc20-transfer-log-scan",
        ...(log.blockNumber !== null && log.blockNumber !== undefined
          ? { firstObservedBlock: log.blockNumber.toString() }
          : {})
      });

      if (edges.length >= maxEdges) break;
    }

    return edges;
  } catch {
    return [];
  }
}

export interface FundingWalletLookupConfig {
  apiBaseUrl: string;
  maxPages?: number;
}

/**
 * Walks up to `maxPages` pages of a Blockscout address's inbound-transaction history (newest
 * first, Blockscout's default order) looking for native-value transfers, and reports the
 * sender of the one found deepest into that bounded window as a best-effort FUNDED_BY edge.
 * This is NOT guaranteed to be the address's very first-ever funding transaction — only the
 * earliest one found within the page bound — and the evidence text says so explicitly.
 */
export async function findFundingWallet(
  address: `0x${string}`,
  config: FundingWalletLookupConfig
): Promise<RelatedWalletEdge | null> {
  const maxPages = config.maxPages ?? 5;
  let url = `${config.apiBaseUrl}/addresses/${address}/transactions?filter=to`;
  let earliestFound: { from: `0x${string}`; blockNumber: string | null } | null = null;

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchJson(url).catch(() => null);
    if (!isRecord(response) || !Array.isArray(response.items)) {
      break;
    }

    for (const item of response.items) {
      if (!isRecord(item)) continue;
      const value = decimalStringValue(item.value);
      const fromRecord = isRecord(item.from) ? item.from : null;
      const fromHash = stringValue(fromRecord?.hash);
      if (!fromHash || !value || Number(value) <= 0) continue;

      earliestFound = {
        from: fromHash.toLowerCase() as `0x${string}`,
        blockNumber: stringValue(item.block_number) ?? stringValue(item.block)
      };
    }

    const nextParams = isRecord(response.next_page_params) ? response.next_page_params : null;
    if (!nextParams) {
      break;
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(nextParams)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        query.set(key, String(value));
      }
    }
    url = `${config.apiBaseUrl}/addresses/${address}/transactions?filter=to&${query.toString()}`;
  }

  if (!earliestFound) {
    return null;
  }

  return {
    type: "FUNDED_BY",
    address: earliestFound.from,
    confidence: "MEDIUM",
    evidence: `Earliest inbound native-value transfer found within the first ${maxPages} page(s) of this address's transaction history came from this wallet. Transfers further back in history were not searched.`,
    source: "blockscout-transaction-history",
    ...(earliestFound.blockNumber ? { firstObservedBlock: earliestFound.blockNumber } : {})
  };
}

function addressToTopic(address: `0x${string}`): Hex {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function topicToAddress(topic: Hex): `0x${string}` {
  return `0x${topic.slice(-40)}`;
}

export interface BlockscoutWalletClusteringConfig {
  chainId: number;
  apiBaseUrl: string;
}

export function createBlockscoutWalletClusteringProvider(
  config: BlockscoutWalletClusteringConfig
): WalletClusteringProvider {
  return {
    id: "blockscout-wallet-clustering",
    supportsChain: (chainId) => chainId === config.chainId,

    async findFundingWallet({ chainId, address }) {
      if (chainId !== config.chainId) {
        return null;
      }
      return findFundingWallet(address, { apiBaseUrl: config.apiBaseUrl });
    },

    async findSupplyTransfers({ adapter, chainId, tokenAddress, deployerAddress, fromBlock, toBlock, totalSupply }) {
      if (chainId !== config.chainId) {
        return [];
      }
      return findSupplyTransfersFromDeployer(adapter, {
        tokenAddress,
        deployerAddress,
        fromBlock,
        toBlock,
        totalSupply
      });
    }
  };
}
