import { parseAbi } from "viem";
import type { ChainAdapter } from "@genesis-sentinel/chain-adapters";

/**
 * Detects whether a token was launched via GenesisPad's current direct-Uniswap-V3 launch
 * flow, using the on-chain GenesisLaunchRegistry as the sole source of truth — never a
 * website label or a guess from token metadata. GenesisPad's older bonding-curve launcher
 * (GenesisPad.sol/GenesisLauncher.sol) is intentionally not queried here; this only recognizes
 * the current direct-V3 launch model. Verified against:
 *   C:\Projects\genesispad\contracts\deployments\robinhood\direct-v3-stack.json
 *   ("sourceOfTruth": true, "launchModel": "DIRECT_UNISWAP_V3")
 * and C:\Projects\genesispad\contracts\src\GenesisLaunchRegistry.sol for the ABI shape.
 */
export interface GenesisPadRegistryConfig {
  chainId: number;
  registryAddress: `0x${string}`;
}

export interface GenesisPadLaunchInfo {
  originalCreator: `0x${string}`;
  pairedAsset: `0x${string}`;
  pool: `0x${string}`;
  positionManager: `0x${string}`;
  locker: `0x${string}`;
  positionTokenId: string;
  permanentlyLocked: boolean;
  verified: boolean;
  launchTimestamp: Date;
  launchBlock: string;
}

export interface GenesisPadLaunchProvider {
  readonly id: string;
  supportsChain(chainId: number): boolean;
  getLaunchInfo(input: {
    adapter: ChainAdapter;
    chainId: number;
    tokenAddress: `0x${string}`;
  }): Promise<GenesisPadLaunchInfo | null>;
}

const genesisLaunchRegistryAbi = parseAbi([
  "struct LaunchRecord { address token; address originalCreator; address currentRewardRecipient; address pairedAsset; address pool; address positionManager; address locker; uint256 positionTokenId; uint24 poolFee; int24 tickLower; int24 tickUpper; uint160 initialSqrtPriceX96; uint256 totalSupply; uint256 initialCreatorBuy; uint256 deploymentFeePaid; uint16 creatorPairFeeShareBps; uint16 protocolPairFeeShareBps; uint16 tokenBurnShareBps; uint16 protocolTokenFeeShareBps; uint64 launchTimestamp; uint64 launchBlock; bool permanentlyLocked; bool governanceEnabled; bool verificationSubmitted; bool verified; uint32 launchPolicyVersion; uint32 launchRangeStrategyVersion; uint32 templateVersion; address tokenDeployer; bytes32 creationCodeHash; }",
  "function isRegistered(address token) view returns (bool)",
  "function getLaunch(address token) view returns (LaunchRecord)"
]);

interface LaunchRecordStruct {
  token: `0x${string}`;
  originalCreator: `0x${string}`;
  currentRewardRecipient: `0x${string}`;
  pairedAsset: `0x${string}`;
  pool: `0x${string}`;
  positionManager: `0x${string}`;
  locker: `0x${string}`;
  positionTokenId: bigint;
  permanentlyLocked: boolean;
  verified: boolean;
  launchTimestamp: bigint;
  launchBlock: bigint;
}

export function createGenesisPadLaunchProvider(
  config: GenesisPadRegistryConfig
): GenesisPadLaunchProvider {
  return {
    id: "genesispad-launch-registry",
    supportsChain: (chainId) => chainId === config.chainId,

    async getLaunchInfo({ adapter, chainId, tokenAddress }): Promise<GenesisPadLaunchInfo | null> {
      if (chainId !== config.chainId) {
        return null;
      }

      try {
        const isRegistered = await adapter.readContract<boolean>({
          address: config.registryAddress,
          abi: genesisLaunchRegistryAbi,
          functionName: "isRegistered",
          args: [tokenAddress]
        });
        if (!isRegistered) {
          return null;
        }

        const record = await adapter.readContract<LaunchRecordStruct>({
          address: config.registryAddress,
          abi: genesisLaunchRegistryAbi,
          functionName: "getLaunch",
          args: [tokenAddress]
        });

        return {
          originalCreator: record.originalCreator,
          pairedAsset: record.pairedAsset,
          pool: record.pool,
          positionManager: record.positionManager,
          locker: record.locker,
          positionTokenId: record.positionTokenId.toString(),
          permanentlyLocked: record.permanentlyLocked,
          verified: record.verified,
          launchTimestamp: new Date(Number(record.launchTimestamp) * 1000),
          launchBlock: record.launchBlock.toString()
        };
      } catch {
        return null;
      }
    }
  };
}
