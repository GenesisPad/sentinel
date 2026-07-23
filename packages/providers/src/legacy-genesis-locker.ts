import { parseAbi } from "viem";
import type { LockerProvider, LockStatusResult } from "./locker.js";

export interface LegacyGenesisLockerConfig {
  chainId: number;
  lockerAddress: `0x${string}`;
}

const legacyGenesisLockerAbi = parseAbi([
  "function lockCount() view returns (uint256)",
  "struct LegacyLock { address owner; address token; bool isLpToken; uint256 amount; uint256 unlockDate; string description; bool withdrawn; }",
  "function getLock(uint256 lockId) view returns (LegacyLock)"
]);

interface LegacyLock {
  owner: `0x${string}`;
  token: `0x${string}`;
  isLpToken: boolean;
  amount: bigint;
  unlockDate: bigint;
  description: string;
  withdrawn: boolean;
}

/** Reads the verified GenesisLocker used by the original bonding-curve GenesisPad. */
export function createLegacyGenesisLockerProvider(
  config: LegacyGenesisLockerConfig
): LockerProvider {
  return {
    id: "legacy-genesis-locker",
    lockerAddress: config.lockerAddress,
    lockerAddresses: [config.lockerAddress],
    supportsChain: (chainId) => chainId === config.chainId,
    async getLockStatus({ adapter, chainId, lpTokenAddress }): Promise<LockStatusResult> {
      if (chainId !== config.chainId) {
        return { status: "UNSUPPORTED", reason: "Legacy Genesis Locker is not configured for this chain." };
      }
      let count: bigint;
      try {
        count = await adapter.readContract<bigint>({
          address: config.lockerAddress,
          abi: legacyGenesisLockerAbi,
          functionName: "lockCount"
        });
      } catch {
        return {
          status: "UNKNOWN",
          lockerId: "legacy-genesis-locker",
          lockerAddress: config.lockerAddress,
          reason: "Legacy Genesis Locker lockCount call failed; lock status could not be determined."
        };
      }
      const locks = await Promise.all(
        Array.from({ length: Number(count) }, (_, lockId) =>
          adapter.readContract<LegacyLock>({
            address: config.lockerAddress,
            abi: legacyGenesisLockerAbi,
            functionName: "getLock",
            args: [BigInt(lockId)]
          }).catch((): null => null)
        )
      );
      const now = BigInt(Math.floor(Date.now() / 1000));
      const active = locks.filter(
        (lock): lock is LegacyLock =>
          lock !== null &&
          lock.token.toLowerCase() === lpTokenAddress.toLowerCase() &&
          lock.isLpToken &&
          !lock.withdrawn &&
          lock.amount > 0n &&
          lock.unlockDate > now
      );
      if (!active.length) {
        return {
          status: "UNKNOWN",
          lockerId: "legacy-genesis-locker",
          lockerAddress: config.lockerAddress,
          reason: "No active, unwithdrawn legacy LP lock exists for this pool token."
        };
      }
      const expirySeconds = active.reduce(
        (latest, lock) => lock.unlockDate > latest ? lock.unlockDate : latest,
        0n
      );
      const expiry = new Date(Number(expirySeconds) * 1000);
      return {
        status: "LOCKED",
        lockerId: "legacy-genesis-locker",
        lockerAddress: config.lockerAddress,
        lockedAmountRaw: active.reduce((sum, lock) => sum + lock.amount, 0n).toString(),
        lockExpiry: expiry,
        reason: `Locked via the verified legacy Genesis Locker until ${expiry.toISOString()}.`
      };
    }
  };
}
