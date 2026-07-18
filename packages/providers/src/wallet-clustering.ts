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
    /** Human-readable role of `address` (e.g. "deployer", "current owner", "previous owner"),
     * folded into the returned edge's evidence text so it's clear which tracked wallet this
     * funding trace belongs to. */
    roleLabel: string;
  }): Promise<RelatedWalletEdge | null>;
  findSupplyTransfers(input: {
    adapter: ChainAdapter;
    chainId: number;
    tokenAddress: `0x${string}`;
    /** The wallet whose outgoing Transfer events are scanned — the deployer, the current
     * owner, or a previous owner recovered from an ownership-renouncement log. */
    fromAddress: `0x${string}`;
    roleLabel: string;
    fromBlock: bigint;
    toBlock: bigint;
    totalSupply: string | null;
  }): Promise<RelatedWalletEdge[]>;
  /**
   * Recovers the wallet that renounced ownership, when the current owner is a burn/zero
   * address, by scanning `OwnershipTransferred` logs for the renouncement transaction. Returns
   * null when no renouncement log is found (e.g. ownership was never set, or the contract
   * doesn't emit the standard event) — never a guess.
   */
  findPreviousOwner(input: {
    adapter: ChainAdapter;
    chainId: number;
    tokenAddress: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<PreviousOwnerResult | null>;
}

export interface PreviousOwnerResult {
  address: `0x${string}`;
  blockNumber: string | null;
}

const burnOrZeroAddresses = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead"
]);

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

const ownershipTransferredEvent = parseAbiItem(
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)"
);
const ownershipTransferredTopic = toEventSelector(ownershipTransferredEvent);

export interface SupplyTransferScanInput {
  tokenAddress: `0x${string}`;
  /** The wallet whose outgoing Transfer events are scanned — deployer, current owner, or a
   * recovered previous owner. */
  fromAddress: `0x${string}`;
  /** Human-readable role of `fromAddress`, folded into the returned edges' evidence text. */
  roleLabel: string;
  fromBlock: bigint;
  toBlock: bigint;
  totalSupply: string | null;
}

/**
 * Scans ERC20 Transfer events from `input.fromAddress` within [fromBlock, toBlock] and reports
 * recipients that received at least 1% of total supply (or any nonzero amount when total
 * supply isn't known) as TRANSFERRED_SUPPLY_TO edges. Bounded by the caller-supplied block
 * range — does not scan beyond it. Works for any tracked wallet (deployer, current owner, or a
 * previous owner recovered from a renouncement log), not only the deployer.
 */
export async function findSupplyTransfersFrom(
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
      topics: [transferTopic, addressToTopic(input.fromAddress)]
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
            ? `This token's ${input.roleLabel} transferred ~${pct.toFixed(1)}% of total supply to this address (block ${log.blockNumber ?? "unknown"}).`
            : `This token's ${input.roleLabel} transferred ${amount.toString()} raw token units to this address (block ${log.blockNumber ?? "unknown"}); total supply was unavailable to compute a percentage.`,
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

/**
 * Recovers the wallet that renounced ownership by scanning `OwnershipTransferred` logs for the
 * transaction whose `newOwner` is a known burn/zero address, and returning that log's
 * `previousOwner`. Reports the most recent such renouncement in range. Returns null when no
 * renouncement log is found — e.g. the contract never renounced, or doesn't emit the standard
 * OpenZeppelin `Ownable` event — never a guess.
 */
export async function findPreviousOwnerFromRenouncement(
  adapter: ChainAdapter,
  input: { tokenAddress: `0x${string}`; fromBlock: bigint; toBlock: bigint }
): Promise<PreviousOwnerResult | null> {
  try {
    const logs = await adapter.getLogs({
      address: input.tokenAddress,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      topics: [ownershipTransferredTopic]
    });

    let latest: PreviousOwnerResult | null = null;
    let latestBlock = -1n;
    for (const log of logs) {
      const previousOwnerTopic = log.topics[1];
      const newOwnerTopic = log.topics[2];
      if (log.topics.length < 3 || !previousOwnerTopic || !newOwnerTopic) continue;

      const newOwner = topicToAddress(newOwnerTopic);
      if (!burnOrZeroAddresses.has(newOwner.toLowerCase())) continue;

      const previousOwner = topicToAddress(previousOwnerTopic);
      if (burnOrZeroAddresses.has(previousOwner.toLowerCase())) continue;

      const block = log.blockNumber ?? 0n;
      if (block >= latestBlock) {
        latestBlock = block;
        latest = { address: previousOwner, blockNumber: log.blockNumber?.toString() ?? null };
      }
    }

    return latest;
  } catch {
    return null;
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
  config: FundingWalletLookupConfig,
  roleLabel = "this address"
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
    evidence: `Earliest inbound native-value transfer found within the first ${maxPages} page(s) of the ${roleLabel}'s transaction history came from this wallet. Transfers further back in history were not searched.`,
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

    async findFundingWallet({ chainId, address, roleLabel }) {
      if (chainId !== config.chainId) {
        return null;
      }
      return findFundingWallet(address, { apiBaseUrl: config.apiBaseUrl }, roleLabel);
    },

    async findSupplyTransfers({
      adapter,
      chainId,
      tokenAddress,
      fromAddress,
      roleLabel,
      fromBlock,
      toBlock,
      totalSupply
    }) {
      if (chainId !== config.chainId) {
        return [];
      }
      return findSupplyTransfersFrom(adapter, {
        tokenAddress,
        fromAddress,
        roleLabel,
        fromBlock,
        toBlock,
        totalSupply
      });
    },

    async findPreviousOwner({ chainId, adapter, tokenAddress, fromBlock, toBlock }) {
      if (chainId !== config.chainId) {
        return null;
      }
      return findPreviousOwnerFromRenouncement(adapter, { tokenAddress, fromBlock, toBlock });
    }
  };
}
