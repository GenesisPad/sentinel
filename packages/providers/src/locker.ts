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
