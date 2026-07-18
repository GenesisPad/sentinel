import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";
import type { ContractSourceDetectorInput } from "@genesis-sentinel/security-engine";
import type { GenesisPadLaunchProvider } from "./genesispad-registry.js";
import type { LockerProvider } from "./locker.js";

/**
 * Provider-neutral domain contracts for the evidence lookups a scan needs beyond raw RPC
 * access: contract source, explorer token profile, holder data, liquidity discovery, and
 * market profile. Concrete providers (Blockscout, DexScreener, on-chain DEX discovery, and
 * future Etherscan-compatible/Sourcify providers) implement these interfaces so worker
 * orchestration never has to branch on a specific vendor or chain adapter name.
 *
 * See docs/architecture/providers.md for the fallback order used per domain.
 */

export type ContractSourceResult = ContractSourceDetectorInput;

/**
 * Aggregate source lookup consumed by worker orchestration/detectors. Built by composing
 * one or more ContractSourceProvider instances (see below) in a configured fallback order —
 * see createContractSourceChain in contract-source-chain.ts.
 */
export interface SourceProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  getContractSource(input: {
    chainId: number;
    address: `0x${string}`;
  }): Promise<ContractSourceResult>;
}

export interface ContractSourceProviderInput {
  chainId: number;
  address: `0x${string}`;
  /** Optional, cache-key-only context; never sent to the vendor. */
  bytecodeHash?: string;
}

export interface ContractVerificationResult {
  status: "VERIFIED" | "UNVERIFIED" | "UNAVAILABLE";
  provider: string;
  contractName?: string | null;
  compilerVersion?: string | null;
  optimizationEnabled?: boolean | null;
  optimizationRuns?: number | null;
  language?: string | null;
  /** True when the vendor confirmed the verified source recompiles to the observed runtime
   * bytecode. False when the vendor flags a mismatch. Null when the vendor does not report
   * this. Never inferred locally — only forwarded from the vendor's own signal. */
  bytecodeMatches?: boolean | null;
}

export interface ContractSourceFile {
  filename: string;
  sourceCode: string;
}

export interface VerifiedContractSource {
  contractName?: string | null;
  compilerVersion?: string | null;
  language?: string | null;
  sourceFiles: ContractSourceFile[];
}

export interface ProxyImplementationResult {
  implementationAddress: `0x${string}`;
  proxyPattern: "EIP1967" | "UNKNOWN";
}

/**
 * Granular per-vendor source-verification capability, modeled closely on Milestone 1's
 * ContractSourceProvider interface. Concrete vendors (Sourcify, Blockscout) implement this;
 * createContractSourceChain composes an ordered list of these into the single SourceProvider
 * worker orchestration actually calls, so adding a vendor never touches scan-worker.ts.
 */
export interface ContractSourceProvider {
  readonly id: string;
  supports(chainId: number): boolean;
  getVerification(input: ContractSourceProviderInput): Promise<ContractVerificationResult>;
  getSource(input: ContractSourceProviderInput): Promise<VerifiedContractSource | null>;
  getAbi(input: ContractSourceProviderInput): Promise<unknown[] | null>;
  getImplementation?(
    input: ContractSourceProviderInput
  ): Promise<ProxyImplementationResult | null>;
}

export interface ExplorerTokenProfile {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  holderCount: number | null;
  sourceVerified: boolean | null;
  deployerAddress: `0x${string}` | null;
  contractCreatedAt: Date | null;
  creationTxHash: `0x${string}` | null;
  tokenType: string | null;
  iconUrl: string | null;
  reputation: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
}

export interface ExplorerProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  getTokenProfile(input: {
    chainId: number;
    address: `0x${string}`;
  }): Promise<ExplorerTokenProfile | null>;
  getTokenPriceUsd(input: { chainId: number; address: `0x${string}` }): Promise<number | null>;
}

export interface MarketProfile {
  name: string | null;
  symbol: string | null;
  iconUrl: string | null;
  labels: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
  liquidityUsd: number | null;
  pairCreatedAt: Date | null;
}

export interface MarketDataProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  getMarketProfile(input: {
    chainId: number;
    address: `0x${string}`;
  }): Promise<MarketProfile | null>;
}

export interface EnrichedHolder {
  address: `0x${string}`;
  balanceRaw: string;
  isContract: boolean;
  labels: string[];
  totalSupplyPct: number;
}

export interface HolderConcentration extends Record<string, unknown> {
  top1Pct: number;
  top5Pct: number;
  top10Pct: number;
  top1Address: `0x${string}` | null;
  deployerPct: number | null;
  ownerPct: number | null;
  liquidityPoolPct: number;
  burnedPct: number;
  excludedContractPct: number;
  suspiciousFlags: string[];
}

export interface HolderSnapshotResult {
  holderCount: number | null;
  topHolders: EnrichedHolder[];
  concentration: HolderConcentration;
}

export interface HolderProviderContext {
  holderCount?: number | null;
  deployerAddress?: `0x${string}` | null;
  ownerAddress?: `0x${string}` | null;
  liquidityPoolAddresses?: `0x${string}`[];
}

export interface HolderProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  getHolderSnapshot(input: {
    chainId: number;
    address: `0x${string}`;
    totalSupply: string | null;
    context?: HolderProviderContext;
  }): Promise<HolderSnapshotResult | null>;
}

export interface DiscoveredPool {
  poolAddress: `0x${string}`;
  dex: string;
  quoteTokenAddress: `0x${string}`;
  quoteSymbol: string;
  quoteDecimals: number;
  liquidityData: Record<string, unknown>;
}

export interface LiquidityProviderCoverage {
  discoveryTool: string;
  checkedDexes: string[];
  checkedQuoteSymbols: string[];
}

export interface LiquidityProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  describeCoverage(): LiquidityProviderCoverage;
  discoverPools(input: {
    adapter: ChainAdapter;
    chainId: number;
    tokenAddress: `0x${string}`;
    blockNumber: bigint;
  }): Promise<DiscoveredPool[]>;
}

export interface ProviderSet {
  source: SourceProvider;
  explorer: ExplorerProvider;
  market: MarketDataProvider;
  holder: HolderProvider;
  liquidity: LiquidityProvider;
  locker: LockerProvider;
  /** Optional: only meaningful for chains with a GenesisPad launch registry deployed. */
  launchpad?: GenesisPadLaunchProvider;
}
