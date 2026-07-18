import { describe, expect, it } from "vitest";
import { createUnsupportedLockerProvider } from "./locker.js";

describe("createUnsupportedLockerProvider", () => {
  it("never claims a chain is supported", () => {
    const locker = createUnsupportedLockerProvider();
    expect(locker.supportsChain(4663)).toBe(false);
    expect(locker.supportsChain(1)).toBe(false);
  });

  it("reports UNSUPPORTED rather than guessing a lock status", async () => {
    const locker = createUnsupportedLockerProvider();
    const result = await locker.getLockStatus({
      adapter: {} as never,
      chainId: 4663,
      lpTokenAddress: "0x0000000000000000000000000000000000000001"
    });

    expect(result.status).toBe("UNSUPPORTED");
    expect(result.reason).toBeTruthy();
  });
});
