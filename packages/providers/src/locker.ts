import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";

/**
 * Provider-neutral LP-locker adapter (Milestone 3). Distinguishes "burned" (verified by
 * checking known burn-address balances directly on-chain — see robinhood-liquidity.ts) from
 * "locked" (requires a specific third-party locker contract's own lock records) and "unknown"
 * (neither burned nor verified locked). A website or explorer label claiming LP is "locked" is
 * not sufficient evidence on its own; only a real locker contract read counts.
 *
 * createGenesisLockerProvider (genesis-locker.ts) implements this against the real, deployed
 * Genesis Locker contract on Robinhood Chain. createUnsupportedLockerProvider remains the
 * fallback for chains with no locker wired.
 */
export interface LockStatusResult {
  status: "LOCKED" | "UNKNOWN" | "UNSUPPORTED";
  lockerId?: string;
  lockerAddress?: `0x${string}` | null;
  lockedAmountRaw?: string | null;
  lockExpiry?: Date | null;
  reason: string;
}

export interface LockerProvider {
  readonly id: string;
  /** The locker contract's own address, when this chain has a real one wired — lets callers
   * recognize "the deployer sent supply to the locker" as a locking action, not a wallet
   * transfer, without needing a separate registry of known-good infrastructure addresses. */
  readonly lockerAddress?: `0x${string}` | null;
  readonly lockerAddresses?: readonly `0x${string}`[];
  supportsChain(chainId: number): boolean;
  getLockStatus(input: {
    adapter: ChainAdapter;
    chainId: number;
    lpTokenAddress: `0x${string}`;
  }): Promise<LockStatusResult>;
}

export function createUnsupportedLockerProvider(): LockerProvider {
  return {
    id: "unsupported-locker",
    lockerAddress: null,
    lockerAddresses: [],
    supportsChain: () => false,
    async getLockStatus() {
      await Promise.resolve();
      return {
        status: "UNSUPPORTED",
        reason:
          "No LP-locker contract integration is configured for this chain. LP not sent to a known burn address is reported as unknown ownership, never as verified-locked."
      };
    }
  };
}

export function createCompositeLockerProvider(
  chainId: number,
  providers: readonly LockerProvider[]
): LockerProvider {
  const lockerAddresses = providers.flatMap((provider) =>
    provider.lockerAddresses?.length
      ? provider.lockerAddresses
      : provider.lockerAddress
        ? [provider.lockerAddress]
        : []
  );
  return {
    id: "composite-locker",
    lockerAddress: lockerAddresses[0] ?? null,
    lockerAddresses,
    supportsChain: (candidate) =>
      candidate === chainId && providers.some((provider) => provider.supportsChain(candidate)),
    async getLockStatus(input) {
      if (input.chainId !== chainId) {
        return { status: "UNSUPPORTED", reason: "No locker integration is configured for this chain." };
      }
      const results = await Promise.all(
        providers
          .filter((provider) => provider.supportsChain(input.chainId))
          .map((provider) => provider.getLockStatus(input))
      );
      const locked = results.filter((result) => result.status === "LOCKED");
      if (!locked.length) {
        return results.find((result) => result.status === "UNKNOWN") ?? {
          status: "UNSUPPORTED",
          reason: "No configured locker could verify an active lock for this LP token."
        };
      }
      const expiries = locked
        .map((result) => result.lockExpiry)
        .filter((expiry): expiry is Date => expiry instanceof Date);
      return {
        status: "LOCKED",
        lockerId: locked.map((result) => result.lockerId).filter(Boolean).join(","),
        lockerAddress: locked[0]?.lockerAddress ?? null,
        lockedAmountRaw: locked
          .reduce((sum, result) => sum + BigInt(result.lockedAmountRaw ?? "0"), 0n)
          .toString(),
        lockExpiry: expiries.length
          ? new Date(Math.max(...expiries.map((expiry) => expiry.getTime())))
          : null,
        reason: locked.map((result) => result.reason).join(" ")
      };
    }
  };
}
