import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import { describe, expect, it, vi } from "vitest";
import { createLegacyGenesisLockerProvider } from "./legacy-genesis-locker.js";

const lockerAddress = "0x2ca85f6bfe8f22219a6d90910935c405ce6a7239" as const;
const genLpToken = "0x7e25C2838428d162C704d0Ac0D28be5263495FCc" as const;
const emptyStorage: `0x${string}` = `0x${"0".repeat(64)}`;

function adapter(lock: Record<string, unknown>): ChainAdapter {
  return {
    chainId: 4663,
    name: "Robinhood Chain",
    getBlockNumber: () => Promise.resolve(0n),
    getBlock: () => Promise.resolve({ number: 0n, timestamp: 0n, hash: null }),
    getBytecode: () => Promise.resolve("0x"),
    getStorageAt: () => Promise.resolve(emptyStorage),
    readContract: (input) =>
      Promise.resolve((input.functionName === "lockCount" ? 1n : lock) as never),
    getLogs: () => Promise.resolve([]),
    getTransaction: () => Promise.resolve(null),
    getTransactionReceipt: () => Promise.resolve(null),
    getTokenMetadata: (address) =>
      Promise.resolve({ address, name: null, symbol: null, decimals: null })
  };
}

const genLock = {
  owner: "0x8CFa84924011b19765136Baea669AC81FE8bB561",
  token: genLpToken,
  isLpToken: true,
  amount: 8190302663405005158571n,
  unlockDate: 1785777479n,
  description: "genesisLock",
  withdrawn: false
};

describe("createLegacyGenesisLockerProvider", () => {
  it("recognizes the active $GEN bonding-curve LP lock", async () => {
    vi.setSystemTime(new Date("2026-07-23T20:00:00Z"));
    const result = await createLegacyGenesisLockerProvider({
      chainId: 4663,
      lockerAddress
    }).getLockStatus({ adapter: adapter(genLock), chainId: 4663, lpTokenAddress: genLpToken });

    expect(result.status).toBe("LOCKED");
    expect(result.lockedAmountRaw).toBe("8190302663405005158571");
    expect(result.lockExpiry).toEqual(new Date(1785777479 * 1000));
    vi.useRealTimers();
  });

  it("does not treat an expired or withdrawn lock as protected", async () => {
    vi.setSystemTime(new Date("2026-08-04T00:00:00Z"));
    const result = await createLegacyGenesisLockerProvider({
      chainId: 4663,
      lockerAddress
    }).getLockStatus({ adapter: adapter(genLock), chainId: 4663, lpTokenAddress: genLpToken });

    expect(result.status).toBe("UNKNOWN");
    vi.useRealTimers();
  });
});
