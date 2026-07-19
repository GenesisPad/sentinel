import { parseAbi } from "viem";
import type { LockerProvider, LockStatusResult } from "./locker.js";

export interface GenesisLockerConfig {
  chainId: number;
  /**
   * Verified against C:\Projects\genesispad\genesis-locker\contracts\deployments\robinhood.json
   * and cross-confirmed in C:\Projects\genesispad\contracts\deployments\robinhood\
   * production-stack.json ("contracts.GenesisLocker"). Same address on both sibling repos.
   */
  lockerAddress: `0x${string}`;
}

// GenesisLocker/GenesisLockerV2 share an identical Lock struct and getTokenLocks/getLock
// interface (both contracts inspected directly in genesis-locker/contracts/contracts/).
const genesisLockerAbi = parseAbi([
  "struct GenesisLock { uint256 lockId; address token; address owner; address beneficiary; uint256 amount; uint256 withdrawnAmount; uint256 startTime; uint256 cliffTime; uint256 endTime; uint256 vestingInterval; bool isVesting; bool isLpToken; bool isPermanent; uint256 createdAt; string metadataURI; }",
  "function getTokenLocks(address token) view returns (uint256[])",
  "function getLock(uint256 lockId) view returns (GenesisLock)"
]);

interface GenesisLockStruct {
  lockId: bigint;
  token: `0x${string}`;
  owner: `0x${string}`;
  beneficiary: `0x${string}`;
  amount: bigint;
  withdrawnAmount: bigint;
  startTime: bigint;
  cliffTime: bigint;
  endTime: bigint;
  vestingInterval: bigint;
  isVesting: boolean;
  isLpToken: boolean;
  isPermanent: boolean;
  createdAt: bigint;
  metadataURI: string;
}

/**
 * Real LockerProvider implementation against the deployed Genesis Locker contract on
 * Robinhood Chain. Sums remaining (non-withdrawn) locked amounts across every lock record
 * `getTokenLocks` returns for the LP token address, so a partially-withdrawn or fully-expired
 * lock never gets reported as fully locked.
 */
export function createGenesisLockerProvider(config: GenesisLockerConfig): LockerProvider {
  return {
    id: "genesis-locker",
    lockerAddress: config.lockerAddress,
    supportsChain: (chainId) => chainId === config.chainId,

    async getLockStatus({ adapter, chainId, lpTokenAddress }): Promise<LockStatusResult> {
      if (chainId !== config.chainId) {
        return {
          status: "UNSUPPORTED",
          reason: "Genesis Locker is not configured for this chain."
        };
      }

      let lockIds: readonly bigint[];
      try {
        lockIds = await adapter.readContract<readonly bigint[]>({
          address: config.lockerAddress,
          abi: genesisLockerAbi,
          functionName: "getTokenLocks",
          args: [lpTokenAddress]
        });
      } catch {
        return {
          status: "UNKNOWN",
          lockerId: "genesis-locker",
          lockerAddress: config.lockerAddress,
          reason: "Genesis Locker getTokenLocks call failed; lock status could not be determined."
        };
      }

      if (lockIds.length === 0) {
        return {
          status: "UNKNOWN",
          lockerId: "genesis-locker",
          lockerAddress: config.lockerAddress,
          reason: "No Genesis Locker lock records exist for this LP token."
        };
      }

      const locks = await Promise.all(
        lockIds.map((lockId) =>
          adapter
            .readContract<GenesisLockStruct>({
              address: config.lockerAddress,
              abi: genesisLockerAbi,
              functionName: "getLock",
              args: [lockId]
            })
            .catch((): null => null)
        )
      );

      let totalRemaining = 0n;
      let maxEndTime = 0n;
      let anyPermanent = false;
      for (const lock of locks) {
        if (!lock) continue;
        const remaining = lock.amount - lock.withdrawnAmount;
        if (remaining <= 0n) continue;
        totalRemaining += remaining;
        if (lock.isPermanent) anyPermanent = true;
        if (lock.endTime > maxEndTime) maxEndTime = lock.endTime;
      }

      if (totalRemaining === 0n) {
        return {
          status: "UNKNOWN",
          lockerId: "genesis-locker",
          lockerAddress: config.lockerAddress,
          reason: "Every Genesis Locker lock found for this LP token has been fully withdrawn."
        };
      }

      const lockExpiry = anyPermanent ? null : new Date(Number(maxEndTime) * 1000);
      return {
        status: "LOCKED",
        lockerId: "genesis-locker",
        lockerAddress: config.lockerAddress,
        lockedAmountRaw: totalRemaining.toString(),
        lockExpiry,
        reason: anyPermanent
          ? "Permanently locked via Genesis Locker; the locked LP is not withdrawable by anyone."
          : `Locked via Genesis Locker until ${lockExpiry?.toISOString()}.`
      };
    }
  };
}
