import { describe, expect, it } from "vitest";
import { createGenesisPadLaunchProvider } from "./genesispad-registry.js";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";

const registryAddress = "0x0000000000000000000000000000000000dEaD" as const;
const tokenAddress = "0x0000000000000000000000000000000000000001" as const;

function stubAdapter(
  onReadContract: (functionName: string, args: readonly unknown[]) => unknown
): ChainAdapter {
  return {
    chainId: 4663,
    name: "Robinhood Chain",
    getBlockNumber: () => Promise.resolve(0n),
    getBlock: () => Promise.resolve({ number: 0n, timestamp: 0n, hash: null }),
    getBytecode: () => Promise.resolve("0x" as const),
    getStorageAt: () => Promise.resolve(`0x${"0".repeat(64)}` as const),
    readContract: (input) =>
      Promise.resolve(onReadContract(input.functionName, input.args ?? []) as never),
    getLogs: () => Promise.resolve([]),
    getTransaction: () => Promise.resolve(null),
    getTransactionReceipt: () => Promise.resolve(null),
    getTokenMetadata: (address) => Promise.resolve({ address, name: null, symbol: null, decimals: null })
  };
}

describe("createGenesisPadLaunchProvider", () => {
  it("returns null for a chain it is not configured for", async () => {
    const provider = createGenesisPadLaunchProvider({ chainId: 4663, registryAddress });
    const result = await provider.getLaunchInfo({
      adapter: stubAdapter(() => {
        throw new Error("should not be called");
      }),
      chainId: 1,
      tokenAddress
    });

    expect(result).toBeNull();
  });

  it("returns null when the registry reports the token is not registered", async () => {
    const provider = createGenesisPadLaunchProvider({ chainId: 4663, registryAddress });
    const result = await provider.getLaunchInfo({
      adapter: stubAdapter((functionName) => (functionName === "isRegistered" ? false : null)),
      chainId: 4663,
      tokenAddress
    });

    expect(result).toBeNull();
  });

  it("returns full launch info for a confirmed GenesisPad launch", async () => {
    const provider = createGenesisPadLaunchProvider({ chainId: 4663, registryAddress });
    const result = await provider.getLaunchInfo({
      adapter: stubAdapter((functionName) => {
        if (functionName === "isRegistered") return true;
        return {
          token: tokenAddress,
          originalCreator: "0x0000000000000000000000000000000000000002",
          currentRewardRecipient: "0x0000000000000000000000000000000000000002",
          pairedAsset: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
          pool: "0x0000000000000000000000000000000000000003",
          positionManager: "0x0000000000000000000000000000000000000004",
          locker: "0x0000000000000000000000000000000000000005",
          positionTokenId: 42n,
          permanentlyLocked: true,
          verified: false,
          launchTimestamp: 1_700_000_000n,
          launchBlock: 123n
        };
      }),
      chainId: 4663,
      tokenAddress
    });

    expect(result).toMatchObject({
      pool: "0x0000000000000000000000000000000000000003",
      positionTokenId: "42",
      permanentlyLocked: true,
      verified: false,
      launchBlock: "123"
    });
    expect(result?.launchTimestamp).toEqual(new Date(1_700_000_000_000));
  });

  it("returns null when the on-chain call fails", async () => {
    const provider = createGenesisPadLaunchProvider({ chainId: 4663, registryAddress });
    const result = await provider.getLaunchInfo({
      adapter: stubAdapter(() => {
        throw new Error("rpc failure");
      }),
      chainId: 4663,
      tokenAddress
    });

    expect(result).toBeNull();
  });
});
