import { describe, expect, it } from "vitest";
import { memoizeQuoteTokenPriceLookup } from "./robinhood-liquidity.js";

describe("memoizeQuoteTokenPriceLookup", () => {
  it("fetches each unique address at most once", async () => {
    let calls = 0;
    const lookup = memoizeQuoteTokenPriceLookup(() => {
      calls += 1;
      return Promise.resolve(3000);
    });

    // Real usage: V3 discovery fires one call per fee tier concurrently for the same quote
    // token — the bug this guards against is those concurrent calls being independent fetches
    // instead of sharing one in-flight request.
    const results = await Promise.all([
      lookup("0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
      lookup("0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
      lookup("0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
      lookup("0x0bd7d308f8e1639fab988df18a8011f41eacad73")
    ]);

    expect(calls).toBe(1);
    expect(results).toEqual([3000, 3000, 3000, 3000]);
  });

  it("is case-insensitive on the address key", async () => {
    let calls = 0;
    const lookup = memoizeQuoteTokenPriceLookup(() => {
      calls += 1;
      return Promise.resolve(1);
    });

    await lookup("0xABCDEF0000000000000000000000000000000001");
    await lookup("0xabcdef0000000000000000000000000000000001");

    expect(calls).toBe(1);
  });

  it("does not let a single failure poison a different address", async () => {
    const lookup = memoizeQuoteTokenPriceLookup((address) => {
      if (address === "0xbad0000000000000000000000000000000bad0") {
        return Promise.reject(new Error("price feed unavailable"));
      }
      return Promise.resolve(42);
    });

    await expect(lookup("0xbad0000000000000000000000000000000bad0")).rejects.toThrow();
    await expect(lookup("0xgood000000000000000000000000000000000d")).resolves.toBe(42);
  });

  it("gives every pool sharing a quote token the same result, not an inconsistent split", async () => {
    // Regression test for the real $PONS bug: without memoization, concurrent calls for the
    // same WETH address could independently succeed or fail, letting a tiny dust pool "win"
    // selectPrimaryLiquidityPool over the real, much larger pool whose call happened to fail.
    let callCount = 0;
    const flakyLookup = memoizeQuoteTokenPriceLookup(() => {
      callCount += 1;
      // Simulates a rate-limited/flaky upstream: if this ran per-call instead of once, some
      // callers would get the resolved price and others would still be mid-flight or retried
      // independently. Memoization means every caller shares this exact one outcome.
      return Promise.resolve(1916.44);
    });

    const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    const [feeTier100, feeTier500, feeTier3000, feeTier10000] = await Promise.all([
      flakyLookup(weth),
      flakyLookup(weth),
      flakyLookup(weth),
      flakyLookup(weth)
    ]);

    expect(callCount).toBe(1);
    expect(new Set([feeTier100, feeTier500, feeTier3000, feeTier10000])).toEqual(new Set([1916.44]));
  });
});
