import { describe, expect, it } from "vitest";
import { toJsonRpcQuantity } from "./fork-simulator.js";

describe("toJsonRpcQuantity", () => {
  /**
   * Regression guard. The fork account balance was previously passed as a decimal string, which
   * Ganache rejects while constructing the server. Because that happens before the fork starts
   * and the caller catches fork errors, every scan silently fell back to route-quote and
   * reported honeypot and tax as "unknown" — with nothing recording that the simulator had
   * crashed. The format is the whole bug, so it is asserted directly.
   */
  it("formats the fork account balance as 0x-prefixed hex, never decimal", () => {
    const oneHundredEther = 100_000_000_000_000_000_000n;

    const formatted = toJsonRpcQuantity(oneHundredEther);

    expect(formatted).toBe("0x56bc75e2d63100000");
    expect(formatted.startsWith("0x")).toBe(true);
    expect(formatted).not.toBe(oneHundredEther.toString());
  });

  it("round-trips through BigInt", () => {
    for (const value of [0n, 1n, 255n, 10n ** 18n, 100_000_000_000_000_000_000n]) {
      expect(BigInt(toJsonRpcQuantity(value))).toBe(value);
    }
  });
});
