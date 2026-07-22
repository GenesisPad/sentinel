import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import {
  contractCodeExistenceDetector,
  createUnsupportedHolderAnalysis,
  createUnsupportedLiquidityDiscovery,
  createUnsupportedTradeSimulations,
  createEmptyDetectorResult,
  dangerousOpcodeDetector,
  deployerHistoryDetector,
  dexInteractionSurfaceDetector,
  eip1967ProxyDetector,
  genesispadLaunchDetector,
  ledgerIntegrityDetector,
  liveTradingStateDetector,
  poolReserveIntegrityDetector,
  ownershipRolesAbiDetector,
  ownershipStatusDetector,
  runFoundationDetectors,
  scoreFindings,
  selectorPatternDetectors,
  sourceCodeRiskDetector,
  transferGateDetector,
  type DetectorMetadata
} from "./index.js";

const noOwner = () => Promise.resolve(null);
const zeroSlot = `0x${"0".repeat(64)}` as const;
const noStorage = () => Promise.resolve(zeroSlot);

const context = {
  scanId: "scan-1",
  chainId: 4663,
  address: "0x0000000000000000000000000000000000000001" as const,
  scannerVersion: "0.1.0-foundation",
  blockNumber: 123n
};

describe("detector contracts", () => {
  it("creates empty detector results without implying a passed check", () => {
    const detector: DetectorMetadata = {
      id: "contract-code-existence",
      version: "0.1.0",
      name: "Contract code existence",
      description: "Checks whether bytecode exists at the target address."
    };

    const result = createEmptyDetectorResult(detector);

    expect(result.findings).toEqual([]);
    expect(result.checks).toEqual([]);
    expect(result.detector.id).toBe("contract-code-existence");
  });
});

describe("foundation detectors", () => {
  it("detects absent bytecode with bytecode evidence", async () => {
    const result = await contractCodeExistenceDetector.run({ bytecode: "0x" }, context);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "CONTRACT_CODE_ABSENT",
      severity: "HIGH"
    });
    expect(result.findings[0]?.evidence[0]).toMatchObject({
      type: "BYTECODE",
      blockNumber: 123n
    });
  });

  it("passes code existence when bytecode is present", async () => {
    const result = await contractCodeExistenceDetector.run({ bytecode: "0x6000" }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ outcome: "PASSED" });
  });

  it("detects mint selector surface without claiming exploitability", async () => {
    const mintDetector = selectorPatternDetectors.find(
      (detector) => detector.metadata.id === "mint-selector-patterns"
    );

    const result = await mintDetector!.run({ bytecode: "0x6340c10f196000" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "MINT_CAPABILITY_SURFACE",
      confidence: "MEDIUM"
    });
    expect(result.findings[0]?.technicalExplanation).toContain("Selector presence");
  });

  it("retrieves metadata and runs all foundation detectors", async () => {
    const results = await runFoundationDetectors(
      {
        bytecode: "0x6000",
        async getTokenMetadata() {
          await Promise.resolve();
          return {
            name: "Token",
            symbol: "TOK",
            decimals: 18
          };
        },
        getOwnerAddress: noOwner,
        getStorageAt: noStorage
      },
      context
    );

    expect(results.map((result) => result.detector.id)).toContain("erc20-metadata");
    expect(results.map((result) => result.detector.id)).toContain("ownership-status");
    expect(results.flatMap((result) => result.findings)).toEqual([]);
  });

  it("flags incomplete ERC-20 metadata as a low-severity review signal", async () => {
    const results = await runFoundationDetectors(
      {
        bytecode: "0x6000",
        async getTokenMetadata() {
          await Promise.resolve();
          return {
            name: null,
            symbol: "TOK",
            decimals: null
          };
        },
        getOwnerAddress: noOwner,
        getStorageAt: noStorage
      },
      context
    );

    const finding = results
      .flatMap((result) => result.findings)
      .find((item) => item.code === "ERC20_METADATA_INCOMPLETE");
    expect(finding).toMatchObject({
      severity: "LOW",
      category: "REPUTATION_RISK"
    });
  });
});

describe("ownership status detector", () => {
  it("treats a burn-address owner as renounced, not just absence of a selector", async () => {
    const result = await ownershipStatusDetector.run(
      { getOwnerAddress: () => Promise.resolve("0x000000000000000000000000000000000000dead") },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "OWNERSHIP_RENOUNCED", outcome: "PASSED" });
  });

  it("flags an active owner address as not renounced", async () => {
    const result = await ownershipStatusDetector.run(
      { getOwnerAddress: () => Promise.resolve("0x1111111111111111111111111111111111111a") },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "OWNERSHIP_NOT_RENOUNCED",
      severity: "MEDIUM",
      category: "CONTRACT_CONTROL"
    });
  });

  it("reports data-unavailable rather than guessing when owner() can't be read", async () => {
    const result = await ownershipStatusDetector.run({ getOwnerAddress: noOwner }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "OWNER_READ_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });
});

describe("eip1967 proxy storage detector", () => {
  it("reports absence when every EIP-1967 slot is zero, not just no selector match", async () => {
    const result = await eip1967ProxyDetector.run({ getStorageAt: noStorage }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "EIP1967_PROXY_ABSENT", outcome: "PASSED" });
  });

  it("detects a proxy from the real implementation storage slot value", async () => {
    const implementationSlotValue =
      `0x${"0".repeat(24)}1111111111111111111111111111111111111111` as const;
    const result = await eip1967ProxyDetector.run(
      {
        getStorageAt: (slot) =>
          Promise.resolve(
            slot === "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb"
              ? implementationSlotValue
              : zeroSlot
          )
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "EIP1967_PROXY_DETECTED",
      severity: "HIGH",
      category: "CONTRACT_CONTROL"
    });
    expect(result.findings[0]?.description).toContain("1111111111111111111111111111111111111111");
  });

  it("detects a beacon proxy when only the beacon slot is set", async () => {
    const beaconSlotValue =
      `0x${"0".repeat(24)}2222222222222222222222222222222222222222` as const;
    const result = await eip1967ProxyDetector.run(
      {
        getStorageAt: (slot) =>
          Promise.resolve(
            slot === "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"
              ? beaconSlotValue
              : zeroSlot
          )
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "EIP1967_BEACON_PROXY_DETECTED" });
  });
});

describe("dangerous opcode detector", () => {
  it("passes when neither DELEGATECALL nor SELFDESTRUCT appear as real instructions", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x600035" }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "DANGEROUS_OPCODES_ABSENT", outcome: "PASSED" });
  });

  it("does not flag a byte that only appears as PUSH immediate data", async () => {
    // PUSH2 0xf400 pushes the bytes f4 00 as data, not as instructions.
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x61f40000" }, context);

    expect(result.findings).toEqual([]);
  });

  it("detects a real DELEGATECALL instruction", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x6000f4" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "DELEGATECALL_OPCODE_PRESENT",
      severity: "MEDIUM"
    });
  });

  it("detects a real SELFDESTRUCT instruction", async () => {
    const result = await dangerousOpcodeDetector.run({ bytecode: "0x6000ff" }, context);

    expect(result.findings[0]).toMatchObject({
      code: "SELFDESTRUCT_OPCODE_PRESENT",
      severity: "HIGH"
    });
  });
});

describe("new selector-pattern detectors", () => {
  it("detects max-transaction/max-wallet selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "max-transaction-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("setMaxTxAmount(uint256)").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "MAX_TRANSACTION_CAPABILITY_SURFACE",
      category: "TRADING_SAFETY"
    });
  });

  it("does not flag a read-only maxWalletAmount()/maxTransactionAmount() getter with no setter present", async () => {
    // Reproduces a real false positive: a token with immutable, no-owner, no-setter max-wallet/
    // max-tx limits (Solidity auto-generates a public getter for any `public` state variable,
    // including immutable ones) was flagged as having a mutable "control surface" purely because
    // the getter's selector happened to match this list — with no setter anywhere in the bytecode.
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "max-transaction-selector-patterns"
    );
    const result = await detector!.run(
      {
        bytecode: `0x${toFunctionSelector("maxWalletAmount()").slice(2)}${toFunctionSelector("maxTransactionAmount()").slice(2)}6000`
      },
      context
    );

    expect(result.findings).toEqual([]);
  });

  it("detects trading-control selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "trading-control-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("enableTrading()").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CONTROL_SURFACE", severity: "HIGH" });
  });

  it("detects cooldown selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "cooldown-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("setCooldown(uint256)").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "COOLDOWN_CAPABILITY_SURFACE",
      category: "TRADING_SAFETY"
    });
  });

  it("detects fee-exclusion (whitelist) selector surface", async () => {
    const detector = selectorPatternDetectors.find(
      (d) => d.metadata.id === "fee-exclusion-selector-patterns"
    );
    const result = await detector!.run(
      { bytecode: `0x${toFunctionSelector("excludeFromFees(address,bool)").slice(2)}6000` },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "FEE_EXCLUSION_CAPABILITY_SURFACE" });
  });
});

describe("source-code risk detector", () => {
  it("reports data unavailable when verified source is missing", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "UNAVAILABLE",
        address: context.address,
        sourceFiles: []
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "SOURCE_CODE_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });

  it("detects blacklist, cooldowns, trading gates, tax controls, obfuscated addresses, and minting in verified source", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "RiskyToken",
        compilerVersion: "v0.8.26",
        language: "solidity",
        sourceFiles: [
          {
            filename: "RiskyToken.sol",
            sourceCode: `
              contract RiskyToken {
                mapping(address => bool) public isBlacklisted;
                bool public tradingEnabled;
                uint256 public buyTax;
                function enableTrading() external onlyOwner { tradingEnabled = true; }
                function setBlacklist(address account, bool value) external onlyOwner { isBlacklisted[account] = value; }
                function setCooldown(uint256 value) external onlyOwner { cooldown = value; }
                function setBuyFee(uint256 value) external onlyOwner { buyTax = value; }
                function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }
                function hiddenWallet() external pure returns (address) {
                  return address(uint160(0x1111111111111111111111111111111111111111));
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "SOURCE_BLACKLIST_CONTROL",
        "SOURCE_TRADING_COOLDOWN_CONTROL",
        "SOURCE_TRADING_TOGGLE",
        "SOURCE_TAX_OR_LIMIT_CONTROL",
        "SOURCE_OBFUSCATED_ADDRESS",
        "SOURCE_MINT_OR_SUPPLY_CONTROL"
      ])
    );
    expect(result.findings[0]?.evidence[0]).toMatchObject({ type: "EXTERNAL_SOURCE" });
  });

  it("does not treat a plain router constant as an obfuscated address", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "PlainRouterToken",
        compilerVersion: "v0.8.26",
        language: "solidity",
        sourceFiles: [
          {
            filename: "PlainRouterToken.sol",
            sourceCode: `
              contract PlainRouterToken {
                address public constant ROUTER = 0x1111111111111111111111111111111111111111;
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).not.toContain("SOURCE_OBFUSCATED_ADDRESS");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "SOURCE_OBFUSCATED_ADDRESS_ABSENT", outcome: "PASSED" })
    );
  });

  it("does not flag immutable max-wallet/max-tx limits with no owner or setter as a tax/limit control", async () => {
    // Reproduces a real false positive verified against a live deployed token (CASHCAT):
    // maxWalletAmount/maxTxAmount are immutable, set once in the constructor, enforced only for
    // a fixed anti-snipe block window, with no owner and no setter anywhere in the contract. The
    // only occurrence of "maxWallet" in source was a custom error's parameter name
    // (`error MaxWalletExceeded(..., uint256 maxWallet)`), which the old bare-word pattern
    // treated as evidence of a mutable "control surface" that does not exist.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "LaunchToken",
        compilerVersion: "v0.8.30",
        language: "solidity",
        sourceFiles: [
          {
            filename: "LaunchToken.sol",
            sourceCode: `
              contract LaunchToken {
                error MaxWalletExceeded(address account, uint256 balanceAfter, uint256 maxWallet);
                error MaxTxExceeded(address account, uint256 amount, uint256 maxTx);

                uint256 public immutable maxWalletAmount;
                uint256 public immutable maxTxAmount;

                function maxWalletLimit() external view returns (uint256) { return maxWalletAmount; }
                function maxTxLimit() external view returns (uint256) { return maxTxAmount; }

                function _update(address from, address to, uint256 value) internal {
                  if (to != address(0)) {
                    uint256 balanceAfter = value;
                    if (balanceAfter > maxWalletAmount) {
                      revert MaxWalletExceeded(to, balanceAfter, maxWalletAmount);
                    }
                  }
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).not.toContain("SOURCE_TAX_OR_LIMIT_CONTROL");
  });

  it("does not flag a local buyTax/sellTax variable computing an already-fixed, capped tax as a control surface", async () => {
    // Reproduces a real false positive verified against a live deployed token ($GEN):
    // buyTax/sellTax are per-call local variables computing the tax owed on this transfer from
    // an immutable, constructor-capped totalTax (MAX_TOTAL_TAX_BPS = 500, i.e. 5%, enforced at
    // construction) — there is no setter for totalTax anywhere. The old bare-word pattern
    // treated the mere presence of "buyTax"/"sellTax" identifiers as evidence of an adjustable
    // fee, when they're just the computed withholding amount.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "GenesisToken",
        compilerVersion: "v0.8.20",
        language: "solidity",
        sourceFiles: [
          {
            filename: "GenesisToken.sol",
            sourceCode: `
              contract GenesisToken {
                uint16 public totalTax;
                uint16 public constant MAX_TOTAL_TAX_BPS = 500;

                constructor(uint16 totalTax_) {
                  totalTax = totalTax_;
                }

                function _update(address from, address to, uint256 value) internal {
                  uint256 buyTax = (value * totalTax) / 10000;
                  uint256 sellTax = (value * totalTax) / 10000;
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).not.toContain("SOURCE_TAX_OR_LIMIT_CONTROL");
  });

  it("does not flag a fixed-recipient ETH-only .call as an arbitrary external call", async () => {
    // Reproduces a real false positive verified against $GEN: taxRecipients is set once in the
    // constructor with no setter, and each recipient is paid via .call{value: share}("") — empty
    // calldata, so the target's fallback/receive is the most that can ever run; there is no
    // arbitrary-function-invocation risk. .delegatecall is still always flagged.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "GenesisToken",
        compilerVersion: "v0.8.20",
        language: "solidity",
        sourceFiles: [
          {
            filename: "GenesisToken.sol",
            sourceCode: `
              contract GenesisToken {
                address[] public taxRecipients;

                function _distribute(uint256 ethBalance) internal {
                  for (uint i = 0; i < taxRecipients.length; i++) {
                    (bool success, ) = taxRecipients[i].call{value: ethBalance}("");
                  }
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).not.toContain("SOURCE_ARBITRARY_EXTERNAL_CALL");
  });

  it("still flags .call with real calldata and .delegatecall as arbitrary external calls", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Risky.sol",
            sourceCode: `
              contract Risky {
                function proxyCall(address target, bytes calldata data) external {
                  (bool ok, ) = target.call(data);
                }
                function forward(address impl, bytes calldata data) external {
                  (bool ok, ) = impl.delegatecall(data);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toContain("SOURCE_ARBITRARY_EXTERNAL_CALL");
  });

  it("detects ownership recovery and forced-transfer surfaces in verified source", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "HiddenOwner.sol",
            sourceCode: `
              contract HiddenOwner {
                address private _owner;
                function reclaimOwnership() external { _owner = msg.sender; }
                function forceTransfer(address from, address to, uint256 amount) external onlyOwner {
                  _transfer(from, to, amount);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["SOURCE_OWNERSHIP_RECOVERY_SURFACE", "SOURCE_ADMIN_TRANSFER_SURFACE"])
    );
    expect(
      result.findings.find((finding) => finding.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({
      severity: "CRITICAL"
    });
  });

  it("downgrades a rescue function that explicitly excludes this contract's own token", async () => {
    // Real-world shape: the overwhelming majority of rescue/recover/sweep functions can only
    // recover foreign tokens accidentally sent to the contract — they revert if called with the
    // contract's own token address, so they can never touch this token's holder balances.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "SafeRescue.sol",
            sourceCode: `
              contract SafeRescue {
                function rescueToken(address token, uint256 amount) external onlyOwner {
                  require(token != address(this), "cannot rescue own token");
                  IERC20(token).transfer(msg.sender, amount);
                }
              }
            `
          }
        ]
      },
      context
    );

    const finding = result.findings.find((f) => f.code === "SOURCE_ADMIN_TRANSFER_SURFACE");
    expect(finding).toMatchObject({ severity: "INFO" });
    expect(finding?.technicalExplanation).toContain("Verified benign");
    expect(finding?.technicalExplanation).toContain("foreign tokens");
  });

  it("does not downgrade a rescue function that can still target its own token", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "UnsafeRescue.sol",
            sourceCode: `
              contract UnsafeRescue {
                function rescueToken(address token, uint256 amount) external onlyOwner {
                  IERC20(token).transfer(msg.sender, amount);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(
      result.findings.find((f) => f.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({ severity: "CRITICAL" });
  });

  it("downgrades a standard allowance-gated burnFrom but not an unrestricted one", async () => {
    const gated = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Burnable.sol",
            sourceCode: `
              contract Burnable {
                function burnFrom(address account, uint256 value) public {
                  _spendAllowance(account, msg.sender, value);
                  _burn(account, value);
                }
              }
            `
          }
        ]
      },
      context
    );
    expect(
      gated.findings.find((f) => f.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({ severity: "INFO" });

    const unrestricted = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Burnable.sol",
            sourceCode: `
              contract Burnable {
                function burnFrom(address account, uint256 value) public onlyOwner {
                  _burn(account, value);
                }
              }
            `
          }
        ]
      },
      context
    );
    expect(
      unrestricted.findings.find((f) => f.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({ severity: "CRITICAL" });
  });

  it("keeps full severity when a benign rescue function coexists with a real forceTransfer elsewhere", async () => {
    // Guards the aggregate-verdict design: one verified-safe match must never mask a separate,
    // unrelated dangerous match caught by the same rule.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Mixed.sol",
            sourceCode: `
              contract Mixed {
                function rescueToken(address token, uint256 amount) external onlyOwner {
                  require(token != address(this), "cannot rescue own token");
                  IERC20(token).transfer(msg.sender, amount);
                }
                function forceTransfer(address from, address to, uint256 amount) external onlyOwner {
                  _transfer(from, to, amount);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(
      result.findings.find((f) => f.code === "SOURCE_ADMIN_TRANSFER_SURFACE")
    ).toMatchObject({ severity: "CRITICAL" });
  });

  it("does not flag a function signature declared only inside an imported interface", async () => {
    // Regression test for a real production false positive: PonsLauncherToken
    // (0x62c71cd34a52c30d894419cbcc55db2afa8032ea on Robinhood Chain) was flagged for "mint or
    // supply-control functions" solely because its own genuinely-imported ILaunchpad.sol
    // interface declares Uniswap V3's position-manager signature
    // `function mint(MintParams calldata params) external payable returns (...)`. The token
    // itself never implements mint and cannot call it on itself — the interface only describes
    // how to call the position manager, a different contract entirely. Unlike the sibling-file
    // test above, this interface IS part of the real import closure (so import-closure scoping
    // alone can't exclude it) — only recognizing "no Solidity interface has a function body, so
    // it can never be a capability of this contract" can.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "LaunchToken",
        sourceFiles: [
          {
            filename: "LaunchToken.sol",
            sourceCode: `
              import {IPositionManagerLike} from "./interfaces/ILaunchpad.sol";
              contract LaunchToken {
                address public immutable positionManager;
                constructor(address positionManager_) { positionManager = positionManager_; }
              }
            `
          },
          {
            filename: "interfaces/ILaunchpad.sol",
            sourceCode: `
              interface IPositionManagerLike {
                function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity);
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((f) => f.code)).not.toContain("SOURCE_MINT_OR_SUPPLY_CONTROL");
  });

  it("downgrades a cooldown/anti-snipe window built from immutable, self-expiring constants", async () => {
    // Real-world shape (PonsLauncherToken): a launch-window restriction gated by immutable
    // block numbers is fixed forever at deployment and expires on its own — fundamentally
    // different from a mutable cooldown a privileged role can extend or re-enable.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "LaunchWindow.sol",
            sourceCode: `
              contract LaunchWindow {
                uint256 public immutable launchBlock;
                uint256 public immutable restrictionEndBlock;
                constructor(uint256 restrictionBlocks) {
                  launchBlock = block.number;
                  restrictionEndBlock = block.number + restrictionBlocks;
                }
              }
            `
          }
        ]
      },
      context
    );

    const finding = result.findings.find((f) => f.code === "SOURCE_TRADING_COOLDOWN_CONTROL");
    expect(finding).toMatchObject({ severity: "INFO" });
    expect(finding?.technicalExplanation).toContain("Verified benign");
    expect(finding?.technicalExplanation).toContain("immutable");
  });

  it("does not downgrade a cooldown built from a plain mutable variable", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "MutableCooldown.sol",
            sourceCode: `
              contract MutableCooldown {
                uint256 public launchBlock;
                function setLaunchBlock(uint256 value) external onlyOwner { launchBlock = value; }
              }
            `
          }
        ]
      },
      context
    );

    expect(
      result.findings.find((f) => f.code === "SOURCE_TRADING_COOLDOWN_CONTROL")
    ).toMatchObject({ severity: "MEDIUM" });
  });

  it("downgrades a router setter guarded to only ever fire once", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "OneTimeRouter.sol",
            sourceCode: `
              contract OneTimeRouter {
                address public router;
                function setRouter(address newRouter) external onlyOwner {
                  require(router == address(0), "already set");
                  router = newRouter;
                }
              }
            `
          }
        ]
      },
      context
    );

    const finding = result.findings.find((f) => f.code === "SOURCE_ROUTER_OR_PAIR_REPLACEMENT");
    expect(finding).toMatchObject({ severity: "INFO" });
    expect(finding?.technicalExplanation).toContain("Verified benign");
  });

  it("does not downgrade a router setter callable at any time", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "MutableRouter.sol",
            sourceCode: `
              contract MutableRouter {
                address public router;
                function setRouter(address newRouter) external onlyOwner {
                  router = newRouter;
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(
      result.findings.find((f) => f.code === "SOURCE_ROUTER_OR_PAIR_REPLACEMENT")
    ).toMatchObject({ severity: "HIGH" });
  });

  it("detects router/pair replacement and arbitrary low-level external calls", async () => {
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [
          {
            filename: "Sketchy.sol",
            sourceCode: `
              contract Sketchy {
                function setRouter(address newRouter) external onlyOwner { router = newRouter; }
                function sweep(address target, bytes calldata data) external onlyOwner {
                  (bool ok, ) = target.call(data);
                  require(ok);
                }
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["SOURCE_ROUTER_OR_PAIR_REPLACEMENT", "SOURCE_ARBITRARY_EXTERNAL_CALL"])
    );
  });

  it("does not flag risky patterns found only in unrelated sibling files from the same verified submission", async () => {
    // Regression test: explorers return every file from a contract's compilation project as
    // "verified source," including sibling contracts and third-party interfaces that never run
    // as part of the deployed address's bytecode. A clean token bundled alongside an unrelated
    // interface exposing `setOwner` (e.g. Uniswap's IUniswapV3Factory) must not be flagged for
    // ownership-recovery risk it doesn't actually have.
    const result = await sourceCodeRiskDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        contractName: "CleanToken",
        sourceFiles: [
          {
            filename: "src/CleanToken.sol",
            sourceCode: `
              import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
              contract CleanToken is ERC20 {
                constructor() ERC20("Clean", "CLEAN") { _mint(msg.sender, 1_000_000e18); }
              }
            `
          },
          {
            filename: "@openzeppelin/contracts/token/ERC20/ERC20.sol",
            sourceCode: `
              contract ERC20 {
                constructor(string memory name_, string memory symbol_) {}
              }
            `
          },
          {
            filename: "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol",
            sourceCode: `
              interface IUniswapV3Factory {
                function setOwner(address _owner) external;
              }
            `
          },
          {
            filename: "src/UnrelatedLegacyToken.sol",
            sourceCode: `
              contract UnrelatedLegacyToken {
                function forceTransfer(address from, address to, uint256 amount) external onlyOwner {}
              }
            `
          }
        ]
      },
      context
    );

    expect(result.findings).toEqual([]);
  });
});

describe("ownership/roles ABI detector", () => {
  it("reports data unavailable without a verified ABI", async () => {
    const result = await ownershipRolesAbiDetector.run(
      { status: "UNAVAILABLE", address: context.address, sourceFiles: [] },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "ABI_UNAVAILABLE", outcome: "DATA_UNAVAILABLE" });
  });

  it("detects two-step ownership from real ABI function names", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [
          { type: "function", name: "pendingOwner" },
          { type: "function", name: "acceptOwnership" }
        ]
      },
      context
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "TWO_STEP_OWNERSHIP_PATTERN",
      severity: "INFO"
    });
  });

  it("detects AccessControl roles from real ABI function names", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [
          { type: "function", name: "hasRole" },
          { type: "function", name: "grantRole" }
        ]
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "ACCESS_CONTROL_ROLE_SURFACE",
      severity: "MEDIUM",
      confidence: "HIGH"
    });
  });

  it("passes when neither pattern is present in the ABI", async () => {
    const result = await ownershipRolesAbiDetector.run(
      {
        status: "VERIFIED",
        address: context.address,
        sourceFiles: [],
        abi: [{ type: "function", name: "transfer" }]
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "OWNERSHIP_ROLE_ABI_ABSENT", outcome: "PASSED" });
  });
});

describe("live trading state detector", () => {
  it("reports unavailable when neither state function can be read", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(null),
        readTradingOpenState: () => Promise.resolve(null)
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "LIVE_TRADING_STATE_UNAVAILABLE",
      outcome: "DATA_UNAVAILABLE"
    });
  });

  it("flags a currently-paused contract from a live read, not just selector presence", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(true),
        readTradingOpenState: () => Promise.resolve(null)
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CURRENTLY_PAUSED", severity: "HIGH" });
  });

  it("flags trading currently disabled from a live read", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(false),
        readTradingOpenState: () => Promise.resolve(false)
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ code: "TRADING_CURRENTLY_DISABLED", severity: "HIGH" });
  });

  it("passes when both live reads succeed and show trading is open", async () => {
    const result = await liveTradingStateDetector.run(
      {
        readPausedState: () => Promise.resolve(false),
        readTradingOpenState: () => Promise.resolve(true)
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "LIVE_TRADING_STATE_OPEN", outcome: "PASSED" });
  });
});

describe("genesispad launch detector", () => {
  it("passes with no finding when the registry has no record for this token", async () => {
    const result = await genesispadLaunchDetector.run({ launch: null }, context);

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      code: "GENESISPAD_LAUNCH_NOT_FOUND",
      outcome: "PASSED"
    });
  });

  it("reports a confirmed launch with permanently locked liquidity", async () => {
    const result = await genesispadLaunchDetector.run(
      {
        launch: {
          originalCreator: "0x0000000000000000000000000000000000000002",
          pool: "0x0000000000000000000000000000000000000003",
          positionManager: "0x0000000000000000000000000000000000000004",
          locker: "0x0000000000000000000000000000000000000005",
          positionTokenId: "42",
          permanentlyLocked: true,
          verified: true,
          launchTimestamp: new Date("2026-07-15T00:00:00.000Z")
        }
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "GENESISPAD_CONFIRMED_LAUNCH",
      severity: "INFO",
      category: "REPUTATION_RISK"
    });
    expect(result.findings[0]?.recommendation).toBeUndefined();
  });

  it("reports a confirmed launch without a permanent-lock recommendation when not locked", async () => {
    const result = await genesispadLaunchDetector.run(
      {
        launch: {
          originalCreator: "0x0000000000000000000000000000000000000002",
          pool: "0x0000000000000000000000000000000000000003",
          positionManager: "0x0000000000000000000000000000000000000004",
          locker: "0x0000000000000000000000000000000000000005",
          positionTokenId: "42",
          permanentlyLocked: false,
          verified: false,
          launchTimestamp: new Date("2026-07-15T00:00:00.000Z")
        }
      },
      context
    );

    expect(result.findings[0]?.recommendation).toBeTruthy();
  });
});

describe("deployer history detector", () => {
  it("reports data unavailable when no deployer address is known", async () => {
    const result = await deployerHistoryDetector.run(
      { deployerHistory: null, bytecodeReuse: null, relatedWalletEdges: [] },
      context
    );

    expect(result.findings).toEqual([]);
    const deployerCheck = result.checks.find((check) => check.code === "DEPLOYER_HISTORY_UNAVAILABLE");
    expect(deployerCheck).toMatchObject({ outcome: "DATA_UNAVAILABLE" });
  });

  it("passes without a finding when the deployer has no prior tokens", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 0,
          previousHighOrCriticalCount: 0,
          entries: []
        },
        bytecodeReuse: null,
        relatedWalletEdges: []
      },
      context
    );

    expect(result.findings).toEqual([]);
    expect(result.checks[0]).toMatchObject({ code: "DEPLOYER_HISTORY_ABSENT", outcome: "PASSED" });
  });

  it("escalates severity when prior tokens had high/critical findings", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 5,
          previousHighOrCriticalCount: 3,
          entries: []
        },
        bytecodeReuse: null,
        relatedWalletEdges: []
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "DEPLOYER_PRIOR_SCAN_HISTORY",
      severity: "HIGH",
      category: "REPUTATION_RISK"
    });
    expect(result.findings[0]?.description).toContain("5 other token(s)");
    expect(result.findings[0]?.description).toContain("3 of those scans");
  });

  it("reports INFO severity when prior tokens had no high/critical findings", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: {
          deployerAddress: "0x0000000000000000000000000000000000000002",
          previousTokenCount: 2,
          previousHighOrCriticalCount: 0,
          entries: []
        },
        bytecodeReuse: null,
        relatedWalletEdges: []
      },
      context
    );

    expect(result.findings[0]).toMatchObject({ severity: "INFO" });
  });

  it("flags reused bytecode across other scanned contracts", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: null,
        bytecodeReuse: {
          bytecodeHash: "abc123",
          reusedByCount: 2,
          reusedByAddresses: [
            "0x0000000000000000000000000000000000000003",
            "0x0000000000000000000000000000000000000004"
          ]
        },
        relatedWalletEdges: []
      },
      context
    );

    expect(result.findings.some((finding) => finding.code === "BYTECODE_REUSED_ACROSS_SCANS")).toBe(
      true
    );
  });

  it("passes with no finding when no related-wallet edges were found", async () => {
    const result = await deployerHistoryDetector.run(
      { deployerHistory: null, bytecodeReuse: null, relatedWalletEdges: [] },
      context
    );

    expect(
      result.checks.some((check) => check.code === "WALLET_CLUSTERING_EDGES_ABSENT")
    ).toBe(true);
  });

  it("flags a TRANSFERRED_SUPPLY_TO edge as a distribution-risk finding", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: null,
        bytecodeReuse: null,
        relatedWalletEdges: [
          {
            type: "TRANSFERRED_SUPPLY_TO",
            address: "0x0000000000000000000000000000000000000005",
            confidence: "HIGH",
            evidence: "Deployer transferred ~12.0% of total supply to this address (block 100).",
            source: "erc20-transfer-log-scan",
            firstObservedBlock: "100"
          }
        ]
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "SUPPLY_TRANSFERRED_TO_WALLET",
      severity: "MEDIUM",
      category: "DISTRIBUTION_RISK"
    });
    expect(
      result.checks.some((check) => check.code === "WALLET_CLUSTERING_EDGES_FOUND")
    ).toBe(true);
  });

  it("aggregates multiple TRANSFERRED_SUPPLY_TO edges into one finding instead of stacking severity", async () => {
    // Reproduces a real scoring bug found on $GEN: 6 separate recipients each produced their own
    // MEDIUM SUPPLY_TRANSFERRED_TO_WALLET finding, and scoreFindings sums same-category findings
    // — 6 x MEDIUM pushed DISTRIBUTION_RISK to a capped 100 (CRITICAL), regardless of whether any
    // individual recipient was actually concerning. One finding, carrying every recipient in its
    // evidence, reports the same fact without multiplying score weight by recipient count.
    const edges: Array<{
      type: "TRANSFERRED_SUPPLY_TO";
      address: `0x${string}`;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      evidence: string;
      source: string;
    }> = Array.from({ length: 6 }, (_, i) => ({
      type: "TRANSFERRED_SUPPLY_TO",
      address: `0x000000000000000000000000000000000000${(10 + i).toString(16)}` as `0x${string}`,
      confidence: "HIGH",
      evidence: `Deployer transferred ~4.0% of total supply to this address (block ${100 + i}).`,
      source: "erc20-transfer-log-scan"
    }));

    const result = await deployerHistoryDetector.run(
      { deployerHistory: null, bytecodeReuse: null, relatedWalletEdges: edges },
      context
    );

    const supplyFindings = result.findings.filter((f) => f.code === "SUPPLY_TRANSFERRED_TO_WALLET");
    expect(supplyFindings).toHaveLength(1);
    expect(supplyFindings[0]?.severity).toBe("MEDIUM");
    expect((supplyFindings[0]?.evidence[0]?.data as { edges: unknown[] }).edges).toHaveLength(6);
  });

  it("reports a FUNDED_BY edge as informational, not a risk verdict", async () => {
    const result = await deployerHistoryDetector.run(
      {
        deployerHistory: null,
        bytecodeReuse: null,
        relatedWalletEdges: [
          {
            type: "FUNDED_BY",
            address: "0x0000000000000000000000000000000000000006",
            confidence: "MEDIUM",
            evidence: "Earliest inbound native-value transfer found within the first 5 page(s).",
            source: "blockscout-transaction-history"
          }
        ]
      },
      context
    );

    expect(result.findings[0]).toMatchObject({
      code: "DEPLOYER_FUNDED_BY_WALLET",
      severity: "INFO",
      category: "REPUTATION_RISK"
    });
  });
});

describe("risk scoring", () => {
  it("returns an explicit UNABLE_TO_ASSESS assessment when no detector findings are present", () => {
    const assessment = scoreFindings([], "0.1.0-foundation");

    expect(assessment).toMatchObject({
      score: null,
      level: "UNABLE_TO_ASSESS",
      categoryScores: [],
      findingContributions: []
    });
    expect(assessment.unableToAssessReasons.length).toBeGreaterThan(0);
  });

  it("surfaces unable-to-assess reasons from unsupported/unavailable/inconclusive/failed checks", () => {
    const detectorResults = [
      {
        detector: { id: "sim-foundation", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "SELL_SIMULATION", outcome: "UNSUPPORTED" as const, confidence: "LOW" as const, evidence: [] }
        ],
        findings: []
      }
    ];
    const assessment = scoreFindings(detectorResults, "0.1.0-foundation");

    expect(assessment.score).toBeNull();
    expect(assessment.unableToAssessReasons).toEqual(["sim-foundation/SELL_SIMULATION: UNSUPPORTED"]);
  });

  it("scores detected findings without claiming broad safety", async () => {
    const mintDetector = selectorPatternDetectors.find(
      (detector) => detector.metadata.id === "mint-selector-patterns"
    );
    const result = await mintDetector!.run({ bytecode: "0x6340c10f196000" }, context);
    const assessment = scoreFindings([result], "0.1.0-foundation");

    expect(assessment).toMatchObject({
      score: 60,
      level: "HIGH",
      confidence: "MEDIUM",
      scoringVersion: "0.2.0-category-weighted-with-gap-reasons"
    });
    expect(assessment.categoryScores[0]).toMatchObject({
      category: "CONTRACT_CONTROL",
      score: 60
    });
    expect(assessment.findingContributions).toHaveLength(1);
    expect(assessment.findingContributions[0]).toMatchObject({
      category: "CONTRACT_CONTROL",
      severity: "HIGH"
    });
    expect(assessment.unableToAssessReasons).toEqual([]);
    expect(assessment.explanation.toLowerCase()).not.toContain("safe");
  });

  it("does not let a renounced-ownership pass erase a separate proxy-admin finding (golden profile)", () => {
    const detectorResults = [
      {
        detector: { id: "ownership-status", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "OWNERSHIP_RENOUNCED", outcome: "PASSED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: []
      },
      {
        detector: { id: "eip1967-proxy-storage", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "PROXY_ADMIN_SLOT_SET", outcome: "DETECTED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: [
          {
            code: "PROXY_ADMIN_CONTROLLED",
            detectorId: "eip1967-proxy-storage",
            detectorVersion: "0.1.0",
            title: "Proxy admin slot is set",
            severity: "HIGH" as const,
            category: "CONTRACT_CONTROL" as const,
            confidence: "HIGH" as const,
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      }
    ];

    const assessment = scoreFindings(detectorResults, "0.1.0-foundation");

    expect(assessment.level).toBe("HIGH");
    expect(assessment.score).toBeGreaterThanOrEqual(60);
  });

  it("does not let locked liquidity erase a separate trading-safety (tax) finding (golden profile)", () => {
    const detectorResults = [
      {
        detector: { id: "liquidity-lock", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "LIQUIDITY_LOCKED", outcome: "PASSED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: []
      },
      {
        detector: { id: "live-trading-state", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "SELL_TAX_MEASURED", outcome: "DETECTED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: [
          {
            code: "HIGH_SELL_TAX",
            detectorId: "live-trading-state",
            detectorVersion: "0.1.0",
            title: "High sell tax observed",
            severity: "HIGH" as const,
            category: "TRADING_SAFETY" as const,
            confidence: "HIGH" as const,
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      }
    ];

    const assessment = scoreFindings(detectorResults, "0.1.0-foundation");

    expect(assessment.categoryScores.some((c) => c.category === "LIQUIDITY_SAFETY")).toBe(false);
    expect(assessment.categoryScores.find((c) => c.category === "TRADING_SAFETY")?.score).toBeGreaterThan(0);
    expect(assessment.level).toBe("HIGH");
  });

  it("does not let a passed sell simulation erase a separate blacklist finding (golden profile)", () => {
    const detectorResults = [
      {
        detector: { id: "trade-simulation", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "SELL_SIMULATION", outcome: "PASSED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: []
      },
      {
        detector: { id: "blacklist-selector-patterns", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "BLACKLIST_SELECTOR_FOUND", outcome: "DETECTED" as const, confidence: "MEDIUM" as const, evidence: [] }
        ],
        findings: [
          {
            code: "BLACKLIST_FUNCTION_PRESENT",
            detectorId: "blacklist-selector-patterns",
            detectorVersion: "0.1.0",
            title: "Blacklist-style function present",
            severity: "HIGH" as const,
            category: "TRADING_SAFETY" as const,
            confidence: "MEDIUM" as const,
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      }
    ];

    const assessment = scoreFindings(detectorResults, "0.1.0-foundation");

    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.unableToAssessReasons).toEqual([]);
  });

  it("does not treat a missing simulation as safety when other real findings exist (golden profile)", () => {
    const detectorResults = [
      {
        detector: { id: "trade-simulation", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "SELL_SIMULATION", outcome: "UNSUPPORTED" as const, confidence: "LOW" as const, evidence: [] }
        ],
        findings: []
      },
      {
        detector: { id: "ownership-status", version: "0.1.0", name: "n", description: "d" },
        checks: [
          { code: "OWNERSHIP_ACTIVE", outcome: "DETECTED" as const, confidence: "HIGH" as const, evidence: [] }
        ],
        findings: [
          {
            code: "OWNERSHIP_NOT_RENOUNCED",
            detectorId: "ownership-status",
            detectorVersion: "0.1.0",
            title: "Contract ownership is not renounced",
            severity: "MEDIUM" as const,
            category: "CONTRACT_CONTROL" as const,
            confidence: "HIGH" as const,
            description: "d",
            technicalExplanation: "t",
            evidence: []
          }
        ]
      }
    ];

    const assessment = scoreFindings(detectorResults, "0.1.0-foundation");

    expect(assessment.score).not.toBeNull();
    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.unableToAssessReasons).toEqual(["trade-simulation/SELL_SIMULATION: UNSUPPORTED"]);
  });
});

describe("simulation foundation", () => {
  it("creates explicit unsupported trade simulation results", () => {
    const simulations = createUnsupportedTradeSimulations({
      chainId: 4663,
      tokenAddress: context.address,
      blockNumber: 123n
    });

    expect(simulations.map((simulation) => simulation.kind)).toEqual(["BUY", "SELL", "TRANSFER"]);
    expect(simulations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "BUY",
          outcome: "UNSUPPORTED",
          blockNumber: 123n,
          simulationTool: "0.1.0-unsupported"
        })
      ])
    );
    expect(
      simulations
        .map((simulation) => simulation.result?.reason)
        .join(" ")
        .toLowerCase()
    ).not.toContain("safe");
  });
});

describe("liquidity discovery foundation", () => {
  it("creates an explicit unsupported liquidity discovery result", () => {
    const discovery = createUnsupportedLiquidityDiscovery();

    expect(discovery).toMatchObject({
      status: "UNSUPPORTED",
      discoveryTool: "0.1.0-unsupported",
      checkedDexes: [],
      pools: []
    });
    expect(discovery.reason.toLowerCase()).not.toContain("safe");
  });
});

describe("holder analysis foundation", () => {
  it("creates an explicit unsupported holder analysis result", () => {
    const analysis = createUnsupportedHolderAnalysis();

    expect(analysis).toMatchObject({
      status: "UNSUPPORTED",
      analysisTool: "0.1.0-unsupported",
      dataSources: [],
      snapshots: []
    });
    expect(analysis.reason.toLowerCase()).not.toContain("safe");
  });
});

describe("ledger integrity detector", () => {
  // Real numbers from the uhood rug on Robinhood Chain: the victim bought 96,167.004477578
  // tokens (raw, 9 decimals) at block 6178793 and the operator deleted the balance at block
  // 6178854 without emitting any Transfer event, while totalSupply stayed pinned at 1e18.
  const uhoodVictim = {
    address: "0x8cfa84924011b19765136baea669ac81fe8bb561" as const,
    balanceBefore: "96167004477578",
    balanceAfter: "0",
    transferredIn: "0",
    transferredOut: "0"
  };

  it("flags balances deleted without a Transfer event as critical", async () => {
    const result = await ledgerIntegrityDetector.run(
      {
        readReconciliation: () => Promise.resolve({
          fromBlock: "6178793",
          toBlock: "6178860",
          accounts: [uhoodVictim],
          totalSupplyBefore: "1000000000000000000",
          totalSupplyAfter: "1000000000000000000"
        })
      },
      context
    );

    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("LEDGER_BALANCE_DELETED");
    // Balances vanished while supply never moved, so the token's books do not balance.
    expect(codes).toContain("LEDGER_SUPPLY_MISMATCH");
    expect(result.findings[0]?.severity).toBe("CRITICAL");
    expect(result.checks[0]?.outcome).toBe("DETECTED");
    expect(result.checks[0]?.code).toBe("LEDGER_INTEGRITY_VIOLATED");
  });

  it("passes a token whose balance changes are fully explained by Transfer events", async () => {
    const result = await ledgerIntegrityDetector.run(
      {
        readReconciliation: () => Promise.resolve({
          fromBlock: "100",
          toBlock: "200",
          accounts: [
            {
              address: "0x0000000000000000000000000000000000000011" as const,
              balanceBefore: "1000",
              transferredIn: "500",
              transferredOut: "200",
              balanceAfter: "1300"
            }
          ],
          totalSupplyBefore: "5000",
          totalSupplyAfter: "5000"
        })
      },
      context
    );

    expect(result.findings).toHaveLength(0);
    expect(result.checks[0]?.outcome).toBe("PASSED");
  });

  it("flags silent balance inflation as a hidden mint", async () => {
    const result = await ledgerIntegrityDetector.run(
      {
        readReconciliation: () => Promise.resolve({
          fromBlock: "100",
          toBlock: "200",
          accounts: [
            {
              address: "0x0000000000000000000000000000000000000012" as const,
              balanceBefore: "1000",
              transferredIn: "0",
              transferredOut: "0",
              balanceAfter: "9999"
            }
          ],
          totalSupplyBefore: "5000",
          totalSupplyAfter: "5000"
        })
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toContain("LEDGER_BALANCE_INFLATED");
  });

  it("reports unavailable rather than passing when no reconciliation data exists", async () => {
    const result = await ledgerIntegrityDetector.run(
      { readReconciliation: () => Promise.resolve(null) },
      context
    );

    expect(result.findings).toHaveLength(0);
    expect(result.checks[0]?.outcome).toBe("DATA_UNAVAILABLE");
    expect(result.checks[0]?.code).toBe("LEDGER_INTEGRITY_UNAVAILABLE");
  });
});

describe("pool reserve integrity detector", () => {
  it("flags an order-of-magnitude reserve overstatement as critical", async () => {
    // uhood: the pair reported 79,237,908.95 tokens of reserve while really holding 79.24.
    const result = await poolReserveIntegrityDetector.run(
      {
        readPoolReserves: () => Promise.resolve([
          {
            poolAddress: "0x3fa1d64f8c239b83a200723eedcd3e1e01b0251b" as const,
            protocol: "UNISWAP_V2",
            reportedTokenReserveRaw: "79237908958709370",
            actualTokenBalanceRaw: "79237908958"
          }
        ])
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toContain("POOL_RESERVE_DESYNC_CRITICAL");
    expect(result.findings[0]?.severity).toBe("CRITICAL");
  });

  it("does not flag a healthy pool whose reserves match its balance", async () => {
    const result = await poolReserveIntegrityDetector.run(
      {
        readPoolReserves: () => Promise.resolve([
          {
            poolAddress: "0x00000000000000000000000000000000000000aa" as const,
            reportedTokenReserveRaw: "65688000000000000",
            actualTokenBalanceRaw: "65688000000000000"
          }
        ])
      },
      context
    );

    expect(result.findings).toHaveLength(0);
    expect(result.checks[0]?.outcome).toBe("PASSED");
  });

  it("tolerates small pending-sync drift without a critical finding", async () => {
    // A V2 pair's reserves legitimately lag a direct transfer until sync().
    const result = await poolReserveIntegrityDetector.run(
      {
        readPoolReserves: () => Promise.resolve([
          {
            poolAddress: "0x00000000000000000000000000000000000000bb" as const,
            reportedTokenReserveRaw: "1010",
            actualTokenBalanceRaw: "1000"
          }
        ])
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "POOL_RESERVE_DESYNC_CRITICAL"
    );
  });
});

describe("dex interaction surface detector", () => {
  it("flags a token whose bytecode can create or modify its own pool", async () => {
    const result = await dexInteractionSurfaceDetector.run(
      { bytecode: "0x60806040c9c65396f305d719791ac947" },
      context
    );

    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("TOKEN_POOL_CONTROL_SURFACE");
    expect(codes).toContain("TOKEN_ROUTER_SWAP_SURFACE");
  });

  it("does not flag a plain ERC-20 bytecode", async () => {
    const result = await dexInteractionSurfaceDetector.run(
      { bytecode: "0x6080604052348015600f57600080fd5b50" },
      context
    );

    expect(result.findings).toHaveLength(0);
    expect(result.checks[0]?.outcome).toBe("PASSED");
  });
});

describe("transfer gate detector", () => {
  const gate = "0xaeeddc8ec2bbb7772f00fa4c735d1a7063f11e5f" as const;
  const delegate = "0x37a593d139ece78064032c19c943ff4f794dd2ba" as const;
  // Address constants live in the data section as 20 bytes left-padded into a 32-byte word.
  const paddedConstant = (address: string) => `${"0".repeat(24)}${address.slice(2)}`;
  const bytecodeWith = (address: string) => `0x6080604052${paddedConstant(address)}` as const;

  it("flags an EIP-7702 gate that rejects every unaffiliated wallet", async () => {
    const result = await transferGateDetector.run(
      {
        bytecode: bytecodeWith(gate),
        resolveCode: () => Promise.resolve(`0xef0100${delegate.slice(2)}` as `0x${string}`),
        probeCall: () => Promise.resolve(false), // gate reverts for every synthetic origin
        probeOrigins: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222"
        ]
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toContain("TRANSFER_GATE_ALLOWLIST");
    expect(result.findings[0]?.severity).toBe("CRITICAL");
    expect(result.checks[0]?.code).toBe("TRANSFER_GATE_DETECTED");
    const data = result.checks[0]?.evidence[0]?.data as { gates: { delegatedTo: string }[] };
    expect(data.gates[0]?.delegatedTo).toBe(delegate);
  });

  it("reports a hardcoded 7702 account that does not block as a lesser finding", async () => {
    const result = await transferGateDetector.run(
      {
        bytecode: bytecodeWith(gate),
        resolveCode: () => Promise.resolve(`0xef0100${delegate.slice(2)}` as `0x${string}`),
        probeCall: () => Promise.resolve(true), // accepts anyone
        probeOrigins: ["0x1111111111111111111111111111111111111111"]
      },
      context
    );

    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("TRANSFER_GATE_DELEGATED_ACCOUNT");
    expect(codes).not.toContain("TRANSFER_GATE_ALLOWLIST");
  });

  it("calls out a renounced token that still defers to a hardcoded gate", async () => {
    const result = await transferGateDetector.run(
      {
        bytecode: bytecodeWith(gate),
        resolveCode: () => Promise.resolve(`0xef0100${delegate.slice(2)}` as `0x${string}`),
        probeCall: () => Promise.resolve(false),
        probeOrigins: ["0x1111111111111111111111111111111111111111"],
        ownershipRenounced: true
      },
      context
    );

    expect(result.findings.map((finding) => finding.code)).toContain(
      "RENOUNCED_BUT_EXTERNALLY_GATED"
    );
  });

  it("does not flag ordinary contract constants such as a router", async () => {
    const router = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba";
    const result = await transferGateDetector.run(
      {
        bytecode: bytecodeWith(router),
        // An ordinary contract, not a 7702-delegated EOA.
        resolveCode: () => Promise.resolve("0x6080604052348015600f57600080fd5b50" as `0x${string}`),
        probeCall: () => Promise.resolve(false),
        probeOrigins: ["0x1111111111111111111111111111111111111111"]
      },
      context
    );

    expect(result.findings).toHaveLength(0);
    expect(result.checks[0]?.code).toBe("TRANSFER_GATE_ABSENT");
  });

  it("skips addresses the caller marked as expected constants", async () => {
    const result = await transferGateDetector.run(
      {
        bytecode: bytecodeWith(gate),
        resolveCode: () => Promise.resolve(`0xef0100${delegate.slice(2)}` as `0x${string}`),
        probeCall: () => Promise.resolve(false),
        probeOrigins: ["0x1111111111111111111111111111111111111111"],
        ignoredAddresses: [gate]
      },
      context
    );

    expect(result.findings).toHaveLength(0);
  });
});
