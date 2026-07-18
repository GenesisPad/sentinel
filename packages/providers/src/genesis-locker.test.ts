import { describe, expect, it } from "vitest";
import { createGenesisLockerProvider } from "./genesis-locker.js";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";

const lockerAddress = "0x0000000000000000000000000000000000dEaD" as const;
const lpTokenAddress = "0x0000000000000000000000000000000000000001" as const;

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

function lockStruct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lockId: 1n,
    token: lpTokenAddress,
    owner: "0x0000000000000000000000000000000000000002",
    beneficiary: "0x0000000000000000000000000000000000000002",
    amount: 1000n,
    withdrawnAmount: 0n,
    startTime: 0n,
    cliffTime: 0n,
    endTime: 2_000_000_000n,
    vestingInterval: 1n,
    isVesting: false,
    isLpToken: true,
    isPermanent: false,
    createdAt: 0n,
    metadataURI: "",
    ...overrides
  };
}

describe("createGenesisLockerProvider", () => {
  it("reports UNSUPPORTED for a chain it is not configured for", async () => {
    const provider = createGenesisLockerProvider({ chainId: 4663, lockerAddress });
    const result = await provider.getLockStatus({
      adapter: stubAdapter(() => {
        throw new Error("should not be called");
      }),
      chainId: 1,
      lpTokenAddress
    });

    expect(result.status).toBe("UNSUPPORTED");
  });

  it("reports UNKNOWN when no lock records exist for the LP token", async () => {
    const provider = createGenesisLockerProvider({ chainId: 4663, lockerAddress });
    const result = await provider.getLockStatus({
      adapter: stubAdapter(() => []),
      chainId: 4663,
      lpTokenAddress
    });

    expect(result.status).toBe("UNKNOWN");
  });

  it("reports LOCKED with the remaining amount and expiry for an active lock", async () => {
    const provider = createGenesisLockerProvider({ chainId: 4663, lockerAddress });
    const result = await provider.getLockStatus({
      adapter: stubAdapter((functionName) =>
        functionName === "getTokenLocks" ? [1n] : lockStruct()
      ),
      chainId: 4663,
      lpTokenAddress
    });

    expect(result.status).toBe("LOCKED");
    expect(result.lockedAmountRaw).toBe("1000");
    expect(result.lockExpiry).toEqual(new Date(2_000_000_000_000));
  });

  it("reports UNKNOWN when every lock for the token has been fully withdrawn", async () => {
    const provider = createGenesisLockerProvider({ chainId: 4663, lockerAddress });
    const result = await provider.getLockStatus({
      adapter: stubAdapter((functionName) =>
        functionName === "getTokenLocks" ? [1n] : lockStruct({ withdrawnAmount: 1000n })
      ),
      chainId: 4663,
      lpTokenAddress
    });

    expect(result.status).toBe("UNKNOWN");
  });

  it("reports LOCKED with no expiry when the lock is permanent", async () => {
    const provider = createGenesisLockerProvider({ chainId: 4663, lockerAddress });
    const result = await provider.getLockStatus({
      adapter: stubAdapter((functionName) =>
        functionName === "getTokenLocks" ? [1n] : lockStruct({ isPermanent: true })
      ),
      chainId: 4663,
      lpTokenAddress
    });

    expect(result.status).toBe("LOCKED");
    expect(result.lockExpiry).toBeNull();
  });
});
