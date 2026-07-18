import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import type { ScanRepository } from "@genesis-sentinel/database";
import { processScanJob } from "./scan-worker.js";

function fetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createRepository(chainId = 4663) {
  const calls: string[] = [];
  const repository: ScanRepository = {
    async createOrGetQueuedScan() {
      await Promise.resolve();
      throw new Error("not used");
    },
    async getScan() {
      await Promise.resolve();
      throw new Error("not used");
    },
    async getScanResult() {
      await Promise.resolve();
      throw new Error("not used");
    },
    async getTokenFindings() {
      await Promise.resolve();
      throw new Error("not used");
    },
    async getRiskSnapshot() {
      await Promise.resolve();
      throw new Error("not used");
    },
    async getScanTarget(scanId) {
      await Promise.resolve();
      calls.push(`get:${scanId}`);
      return {
        scanId,
        chainId,
        address: "0x0000000000000000000000000000000000000001",
        state: "QUEUED",
        scanBlockNumber: null
      };
    },
    async updateScanState(input) {
      await Promise.resolve();
      calls.push(`state:${input.state}`);
    },
    async recordScanBlock(input) {
      await Promise.resolve();
      calls.push(`block:${input.blockNumber.toString()}`);
    },
    async recordStage(input) {
      await Promise.resolve();
      calls.push(`stage:${input.name}:${input.status}`);
    },
    async recordContractObservation(input) {
      await Promise.resolve();
      calls.push(`contract:${input.bytecode}`);
    },
    async recordTokenProfile(input) {
      await Promise.resolve();
      calls.push(`token:${input.symbol ?? "N/A"}:${input.decimals ?? "N/A"}`);
    },
    async recordDetectorResult(input) {
      await Promise.resolve();
      calls.push(`detector:${input.result.detector.id}:${input.result.findings.length}`);
    },
    async recordRiskAssessment(input) {
      await Promise.resolve();
      calls.push(`risk:${input.assessment.level}:${input.assessment.score}`);
    },
    async recordSimulationRun(input) {
      await Promise.resolve();
      calls.push(`simulation:${input.simulation.kind}:${input.simulation.outcome}`);
    },
    async recordLiquidityPool(input) {
      await Promise.resolve();
      calls.push(`liquidity:${input.poolAddress}`);
    },
    async recordHolderSnapshot(input) {
      await Promise.resolve();
      calls.push(`holders:${input.concentration ? "concentration" : "none"}`);
    },
    async getDeployerHistory(_chainId, deployerAddress) {
      await Promise.resolve();
      return {
        deployerAddress,
        previousTokenCount: 0,
        previousHighOrCriticalCount: 0,
        entries: []
      };
    },
    async getBytecodeReuse(_chainId, bytecodeHash) {
      await Promise.resolve();
      return { bytecodeHash, reusedByCount: 0, reusedByAddresses: [] };
    }
  };

  return { repository, calls };
}

function createAdapter(
  bytecode: `0x${string}` = "0x6000",
  options: {
    name?: string;
    ownerAddress?: `0x${string}` | null;
    onReadContract?: (parameters: Parameters<ChainAdapter["readContract"]>[0]) => unknown;
    onGetLogs?: (parameters: Parameters<ChainAdapter["getLogs"]>[0]) => unknown;
    onTraceCall?: (parameters: Parameters<NonNullable<ChainAdapter["traceCall"]>>[0]) => unknown;
    onGetStorageAt?: (parameters: Parameters<ChainAdapter["getStorageAt"]>[0]) => unknown;
  } = {}
): ChainAdapter {
  return {
    chainId: 4663,
    name: options.name ?? "Mock Chain",
    async getBlockNumber() {
      await Promise.resolve();
      return 123n;
    },
    async getBlock() {
      await Promise.resolve();
      return {
        number: 123n,
        timestamp: 1_700_000_000n,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000123"
      };
    },
    async getBytecode() {
      await Promise.resolve();
      return bytecode;
    },
    async readContract<T>(parameters: Parameters<ChainAdapter["readContract"]>[0]): Promise<T> {
      await Promise.resolve();
      const readResult = options.onReadContract?.(parameters);
      if (readResult !== undefined) {
        return readResult as T;
      }
      if (parameters.functionName === "owner" && options.ownerAddress) {
        return options.ownerAddress as T;
      }
      throw new Error("not used");
    },
    async getLogs(parameters) {
      await Promise.resolve();
      return (
        (options.onGetLogs?.(parameters) as
          Awaited<ReturnType<ChainAdapter["getLogs"]>> | undefined) ?? []
      );
    },
    async getTransaction() {
      await Promise.resolve();
      return null;
    },
    async getTransactionReceipt() {
      await Promise.resolve();
      return null;
    },
    async traceCall(parameters) {
      await Promise.resolve();
      const result = options.onTraceCall?.(parameters);
      if (result instanceof Error) {
        throw result;
      }
      return { raw: result ?? "0x" };
    },
    async getTokenMetadata(address: `0x${string}`) {
      await Promise.resolve();
      return {
        address,
        name: "Token",
        symbol: "TOK",
        decimals: 18
      };
    },
    async getStorageAt(parameters) {
      await Promise.resolve();
      const result = options.onGetStorageAt?.(parameters);
      return (result as `0x${string}` | undefined) ?? `0x${"0".repeat(64)}`;
    }
  };
}

describe("scan worker orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records chain resolution, bytecode fetch, and partial completion on a chain with no wired providers", async () => {
    const { repository, calls } = createRepository(1);

    await processScanJob(
      {
        data: {
          scanId: "scan-1",
          chainId: 1,
          address: "0x0000000000000000000000000000000000000001"
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter();
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toEqual([
      "get:scan-1",
      "state:RESOLVING_CHAIN",
      "stage:RESOLVING_CHAIN:RUNNING",
      "block:123",
      "stage:RESOLVING_CHAIN:SUCCEEDED",
      "state:FETCHING_CONTRACT",
      "stage:FETCHING_CONTRACT:RUNNING",
      "contract:0x6000",
      "token:TOK:18",
      "stage:FETCHING_CONTRACT:SUCCEEDED",
      "state:ANALYZING_CONTRACT",
      "stage:ANALYZING_CONTRACT:RUNNING",
      "detector:contract-code-existence:0",
      "detector:erc20-metadata:0",
      "detector:ownership-status:0",
      "detector:eip1967-proxy-storage:0",
      "detector:dangerous-opcode-surface:0",
      "detector:ownership-selector-patterns:0",
      "detector:proxy-selector-patterns:0",
      "detector:mint-selector-patterns:0",
      "detector:pause-selector-patterns:0",
      "detector:blacklist-selector-patterns:0",
      "detector:max-transaction-selector-patterns:0",
      "detector:trading-control-selector-patterns:0",
      "detector:fee-exclusion-selector-patterns:0",
      "detector:source-code-risk-patterns:0",
      "detector:ownership-roles-abi:0",
      "detector:live-trading-state:0",
      "detector:genesispad-launch-provenance:0",
      "detector:deployer-history:0",
      "stage:ANALYZING_CONTRACT:SUCCEEDED",
      "state:DISCOVERING_MARKETS",
      "stage:DISCOVERING_MARKETS:RUNNING",
      "stage:DISCOVERING_MARKETS:SKIPPED",
      "state:ANALYZING_HOLDERS",
      "stage:ANALYZING_HOLDERS:RUNNING",
      "stage:ANALYZING_HOLDERS:SKIPPED",
      "state:SIMULATING_TRADES",
      "stage:SIMULATING_TRADES:RUNNING",
      "simulation:BUY:UNSUPPORTED",
      "simulation:SELL:UNSUPPORTED",
      "simulation:TRANSFER:UNSUPPORTED",
      "stage:SIMULATING_TRADES:SKIPPED",
      "state:SCORING",
      "stage:SCORING:RUNNING",
      "stage:SCORING:SKIPPED",
      "state:PARTIALLY_COMPLETED"
    ]);
  });

  it("persists detector-based risk when findings are available", async () => {
    const { repository, calls } = createRepository(1);

    await processScanJob(
      {
        data: {
          scanId: "scan-2",
          chainId: 1,
          address: "0x0000000000000000000000000000000000000001"
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6340c10f196000");
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain("detector:mint-selector-patterns:1");
    expect(calls).toContain("simulation:BUY:UNSUPPORTED");
    expect(calls).toContain("risk:HIGH:60");
    expect(calls).toContain("stage:SCORING:SUCCEEDED");
  });

  it("persists holder concentration findings for Robinhood holder snapshots", async () => {
    const { repository, calls } = createRepository();
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const deployerAddress = "0x00000000000000000000000000000000000000d1";
    const ownerAddress = "0x00000000000000000000000000000000000000aa";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      const body = url.includes("/holders")
        ? {
            items: [
              {
                address: {
                  hash: "0x00000000000000000000000000000000000000b1",
                  is_contract: false
                },
                value: "400"
              },
              {
                address: {
                  hash: deployerAddress,
                  is_contract: false
                },
                value: "100"
              },
              {
                address: {
                  hash: ownerAddress,
                  is_contract: false
                },
                value: "80"
              },
              {
                address: {
                  hash: "0x00000000000000000000000000000000000000c0",
                  is_contract: true
                },
                value: "300"
              },
              {
                address: {
                  hash: "0x000000000000000000000000000000000000dead",
                  is_contract: false
                },
                value: "100"
              }
            ]
          }
        : url.includes("/tokens/")
          ? {
              name: "Token",
              symbol: "TOK",
              decimals: "18",
              total_supply: "1000",
              holders_count: "5"
            }
          : url.includes("/addresses/")
            ? {
                creator_address_hash: deployerAddress,
                is_verified: true
              }
            : { items: [] };

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    });

    await processScanJob(
      {
        data: {
          scanId: "scan-3",
          chainId: 4663,
          address: tokenAddress
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6000", {
            name: "Robinhood Chain",
            ownerAddress
          });
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain("holders:concentration");
    expect(calls).toContain("detector:holder-concentration:3");
    expect(calls.some((call) => /^risk:(HIGH|CRITICAL):/u.test(call))).toBe(true);
  });

  it("records route quote simulations when a Robinhood Uniswap V2 pool is discovered", async () => {
    const { repository, calls } = createRepository();
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const pairAddress = "0x00000000000000000000000000000000000000f1";
    const traceCalls: Array<Parameters<NonNullable<ChainAdapter["traceCall"]>>[0]> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      const body = url.includes("/holders")
        ? {
            items: [
              {
                address: {
                  hash: "0x00000000000000000000000000000000000000b1",
                  is_contract: false
                },
                value: "1000000000000000000000"
              }
            ]
          }
        : url.includes("/tokens/0x0000000000000000000000000000000000000001")
          ? {
              name: "Token",
              symbol: "TOK",
              decimals: "18",
              total_supply: "1000000000000000000000",
              holders_count: "1"
            }
          : url.includes("/tokens/")
            ? { exchange_rate: "1" }
            : url.includes("/addresses/")
              ? { is_verified: true }
              : { items: [] };

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    });

    await processScanJob(
      {
        data: {
          scanId: "scan-4",
          chainId: 4663,
          address: tokenAddress
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6000", {
            name: "Robinhood Chain",
            onReadContract(parameters) {
              if (parameters.functionName === "getPair") {
                return parameters.args?.[1] === "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
                  ? pairAddress
                  : "0x0000000000000000000000000000000000000000";
              }
              if (parameters.functionName === "getReserves") {
                return [1_000_000_000_000_000_000_000n, 10_000_000_000_000_000_000n, 0];
              }
              if (parameters.functionName === "token0") {
                return tokenAddress;
              }
              if (parameters.functionName === "totalSupply") {
                return 1000n;
              }
              if (parameters.functionName === "balanceOf") {
                return 0n;
              }
              return undefined;
            },
            onTraceCall(parameters) {
              traceCalls.push(parameters);
              return "0x";
            }
          });
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain(`liquidity:${pairAddress}`);
    expect(calls).toContain("simulation:BUY:PASSED");
    expect(calls).toContain("simulation:SELL:PASSED");
    expect(calls).toContain("simulation:TRANSFER:DATA_UNAVAILABLE");
    expect(calls).toContain("stage:SIMULATING_TRADES:SUCCEEDED");
    expect(traceCalls).toHaveLength(2);
    expect(traceCalls[0]).toMatchObject({
      from: "0x0000000000000000000000000000000000001001",
      to: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba"
    });
    expect(traceCalls[1]).toMatchObject({
      from: "0x00000000000000000000000000000000000000b1",
      to: tokenAddress
    });
  });

  it("records Robinhood Uniswap V3 pools without treating them as V2 route simulations", async () => {
    const { repository, calls } = createRepository();
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const poolAddress = "0x00000000000000000000000000000000000000f3";
    const wethAddress = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      const body = url.includes("/holders")
        ? { items: [] }
        : url.includes(`/tokens/${wethAddress}`)
          ? { exchange_rate: "1" }
          : url.includes("/tokens/")
            ? {
                name: "Token",
                symbol: "TOK",
                decimals: "18",
                total_supply: "1000000000000000000000",
                holders_count: "1"
              }
            : url.includes("/addresses/")
              ? { is_verified: true }
              : { items: [] };

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    });

    await processScanJob(
      {
        data: {
          scanId: "scan-v3",
          chainId: 4663,
          address: tokenAddress
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6000", {
            name: "Robinhood Chain",
            onReadContract(parameters) {
              if (parameters.functionName === "getPool") {
                return parameters.args?.[1] === wethAddress && parameters.args?.[2] === 3000
                  ? poolAddress
                  : "0x0000000000000000000000000000000000000000";
              }
              if (parameters.functionName === "liquidity") {
                return 123456n;
              }
              if (parameters.functionName === "slot0") {
                return [79_228_162_514_264_337_593_543_950_336n, 0, 0, 0, 0, 0, true];
              }
              if (parameters.functionName === "token0") {
                return tokenAddress;
              }
              if (parameters.functionName === "token1") {
                return wethAddress;
              }
              if (parameters.functionName === "fee") {
                return 3000;
              }
              if (parameters.functionName === "balanceOf") {
                return parameters.address === tokenAddress ? 1_000_000n : 100n;
              }
              return undefined;
            }
          });
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain(`liquidity:${poolAddress}`);
    expect(calls).toContain("simulation:BUY:UNSUPPORTED");
    expect(calls).toContain("simulation:SELL:UNSUPPORTED");
    expect(calls).toContain("stage:SIMULATING_TRADES:SKIPPED");
  });

  it("records Robinhood Uniswap V4 PoolManager pools from initialization logs", async () => {
    const { repository, calls } = createRepository();
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const wethAddress = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    const poolManagerAddress = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
    const stateViewAddress = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
    const poolId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;
    const v4InitializeEvent = parseAbiItem(
      "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
    );
    const initializeTopics = encodeEventTopics({
      abi: [v4InitializeEvent],
      eventName: "Initialize",
      args: {
        id: poolId,
        currency0: tokenAddress,
        currency1: wethAddress
      }
    });
    const initializeData = encodeAbiParameters(
      [
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
        { type: "uint160" },
        { type: "int24" }
      ],
      [
        3000,
        60,
        "0x0000000000000000000000000000000000000000",
        79_228_162_514_264_337_593_543_950_336n,
        0
      ]
    );
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      const body = url.includes("/holders")
        ? { items: [] }
        : url.includes("/tokens/")
          ? {
              name: "Token",
              symbol: "TOK",
              decimals: "18",
              total_supply: "1000000000000000000000",
              holders_count: "1",
              exchange_rate: "1"
            }
          : url.includes("/addresses/")
            ? { is_verified: true }
            : { items: [] };

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    });

    await processScanJob(
      {
        data: {
          scanId: "scan-v4",
          chainId: 4663,
          address: tokenAddress
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6000", {
            name: "Robinhood Chain",
            onReadContract(parameters) {
              if (parameters.functionName === "getPool") {
                return "0x0000000000000000000000000000000000000000";
              }
              if (
                parameters.address === stateViewAddress &&
                parameters.functionName === "getSlot0"
              ) {
                return [79_228_162_514_264_337_593_543_950_336n, 0, 0, 3000];
              }
              if (
                parameters.address === stateViewAddress &&
                parameters.functionName === "getLiquidity"
              ) {
                return 456789n;
              }
              return undefined;
            },
            onGetLogs(parameters) {
              return parameters.address === poolManagerAddress
                ? [
                    {
                      address: poolManagerAddress,
                      blockNumber: 120n,
                      transactionHash:
                        "0x0000000000000000000000000000000000000000000000000000000000000120",
                      logIndex: 0,
                      topics: [...initializeTopics],
                      data: initializeData
                    }
                  ]
                : [];
            }
          });
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain("liquidity:0x1234567890abcdef1234567890abcdef12345678");
    expect(calls).toContain("simulation:BUY:UNSUPPORTED");
    expect(calls).toContain("simulation:SELL:UNSUPPORTED");
    expect(calls).toContain("stage:SIMULATING_TRADES:SKIPPED");
  });

  it("marks sell failed when holder transfer to pair reverts in static call", async () => {
    const { repository, calls } = createRepository();
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const pairAddress = "0x00000000000000000000000000000000000000f1";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = fetchUrl(input);
      const body = url.includes("/holders")
        ? {
            items: [
              {
                address: {
                  hash: "0x00000000000000000000000000000000000000b1",
                  is_contract: false
                },
                value: "1000000000000000000000"
              }
            ]
          }
        : url.includes("/tokens/0x0000000000000000000000000000000000000001")
          ? {
              name: "Token",
              symbol: "TOK",
              decimals: "18",
              total_supply: "1000000000000000000000",
              holders_count: "1"
            }
          : url.includes("/tokens/")
            ? { exchange_rate: "1" }
            : url.includes("/addresses/")
              ? { is_verified: true }
              : { items: [] };

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    });

    await processScanJob(
      {
        data: {
          scanId: "scan-5",
          chainId: 4663,
          address: tokenAddress
        }
      },
      {
        scans: repository,
        getChainAdapter() {
          return createAdapter("0x6000", {
            name: "Robinhood Chain",
            onReadContract(parameters) {
              if (parameters.functionName === "getPair") {
                return parameters.args?.[1] === "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
                  ? pairAddress
                  : "0x0000000000000000000000000000000000000000";
              }
              if (parameters.functionName === "getReserves") {
                return [1_000_000_000_000_000_000_000n, 10_000_000_000_000_000_000n, 0];
              }
              if (parameters.functionName === "token0") {
                return tokenAddress;
              }
              if (parameters.functionName === "totalSupply") {
                return 1000n;
              }
              if (parameters.functionName === "balanceOf") {
                return 0n;
              }
              return undefined;
            },
            onTraceCall(parameters) {
              if (parameters.to === tokenAddress) {
                return new Error("execution reverted: blacklist");
              }
              return "0x";
            }
          });
        },
        now: () => new Date("2026-07-11T00:00:00.000Z")
      }
    );

    expect(calls).toContain("simulation:BUY:PASSED");
    expect(calls).toContain("simulation:SELL:FAILED");
  });
});
