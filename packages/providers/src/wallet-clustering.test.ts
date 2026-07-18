import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import { findFundingWallet, findSupplyTransfersFromDeployer } from "./wallet-clustering.js";

const tokenAddress = "0x0000000000000000000000000000000000000001" as const;
const deployerAddress = "0x0000000000000000000000000000000000000002" as const;
const recipientAddress = "0x0000000000000000000000000000000000000003" as const;

function stubAdapter(
  onGetLogs: (parameters: Parameters<ChainAdapter["getLogs"]>[0]) => unknown
): ChainAdapter {
  return {
    chainId: 4663,
    name: "Robinhood Chain",
    getBlockNumber: () => Promise.resolve(0n),
    getBlock: () => Promise.resolve({ number: 0n, timestamp: 0n, hash: null }),
    getBytecode: () => Promise.resolve("0x" as const),
    getStorageAt: () => Promise.resolve(`0x${"0".repeat(64)}` as const),
    readContract: () => Promise.reject(new Error("not used")),
    getLogs: (parameters) => Promise.resolve(onGetLogs(parameters) as never),
    getTransaction: () => Promise.resolve(null),
    getTransactionReceipt: () => Promise.resolve(null),
    getTokenMetadata: (address) =>
      Promise.resolve({ address, name: null, symbol: null, decimals: null })
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("findSupplyTransfersFromDeployer", () => {
  it("reports a TRANSFERRED_SUPPLY_TO edge for a transfer above the threshold", async () => {
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );
    const topics = encodeEventTopics({
      abi: [transferEvent],
      eventName: "Transfer",
      args: { from: deployerAddress, to: recipientAddress }
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [50n]);

    const adapter = stubAdapter(() => [
      {
        address: tokenAddress,
        blockNumber: 100n,
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        logIndex: 0,
        topics,
        data
      }
    ]);

    const edges = await findSupplyTransfersFromDeployer(adapter, {
      tokenAddress,
      deployerAddress,
      fromBlock: 0n,
      toBlock: 100n,
      totalSupply: "1000"
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "TRANSFERRED_SUPPLY_TO",
      address: recipientAddress,
      firstObservedBlock: "100"
    });
  });

  it("filters out transfers below the supply threshold", async () => {
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );
    const topics = encodeEventTopics({
      abi: [transferEvent],
      eventName: "Transfer",
      args: { from: deployerAddress, to: recipientAddress }
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [1n]);

    const adapter = stubAdapter(() => [
      {
        address: tokenAddress,
        blockNumber: 100n,
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        logIndex: 0,
        topics,
        data
      }
    ]);

    const edges = await findSupplyTransfersFromDeployer(adapter, {
      tokenAddress,
      deployerAddress,
      fromBlock: 0n,
      toBlock: 100n,
      totalSupply: "1000"
    });

    expect(edges).toEqual([]);
  });

  it("returns no edges when the log fetch fails", async () => {
    const adapter = stubAdapter(() => {
      throw new Error("rpc failure");
    });

    const edges = await findSupplyTransfersFromDeployer(adapter, {
      tokenAddress,
      deployerAddress,
      fromBlock: 0n,
      toBlock: 100n,
      totalSupply: "1000"
    });

    expect(edges).toEqual([]);
  });
});

describe("findFundingWallet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no inbound native transfer is found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ items: [] }));

    const result = await findFundingWallet(deployerAddress, {
      apiBaseUrl: "https://example.blockscout.com/api/v2"
    });

    expect(result).toBeNull();
  });

  it("reports the sender of the deepest inbound native transfer found within the page bound", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        items: [
          {
            from: { hash: recipientAddress },
            value: "1000000000000000000",
            block_number: "50"
          }
        ],
        next_page_params: null
      })
    );

    const result = await findFundingWallet(deployerAddress, {
      apiBaseUrl: "https://example.blockscout.com/api/v2"
    });

    expect(result).toMatchObject({
      type: "FUNDED_BY",
      address: recipientAddress,
      firstObservedBlock: "50"
    });
  });
});
