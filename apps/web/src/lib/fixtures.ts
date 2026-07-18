import type { ChainId } from "./chains";
import type { RecentScan, ScanJob, ScanReport, ScanStage } from "./types";

const STAGE_DEFS: Array<{ key: ScanStage["key"]; label: string }> = [
  { key: "resolving_chain", label: "Resolving chain" },
  { key: "fetching_contract", label: "Fetching contract" },
  { key: "analyzing_contract", label: "Analyzing contract" },
  { key: "discovering_markets", label: "Discovering markets" },
  { key: "analyzing_holders", label: "Analyzing holders" },
  { key: "simulating_trades", label: "Simulating trades" },
  { key: "scoring", label: "Scoring" }
];

const DEMO_ADDRESS = "0x83ab1c92E6F4E6b1A7C4D5f6083Ab45ef1A2b3C4";

/**
 * Fixture scan job. `tick` advances stages so polling in dev shows real progress
 * without inventing a random percentage — each tick resolves one more stage.
 */
export function buildFixtureJob(idOrAddress: string, chainId?: ChainId, tick = 0): ScanJob {
  const resolved = Math.min(tick, STAGE_DEFS.length);
  const finalStatus: Record<number, ScanStage["status"]> = {
    0: "passed",
    1: "passed",
    2: "warning",
    3: "warning",
    4: "warning",
    5: "warning",
    6: "passed"
  };
  const stages: ScanStage[] = STAGE_DEFS.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: i < resolved ? finalStatus[i] : i === resolved ? "running" : "pending"
  }));
  const done = resolved >= STAGE_DEFS.length;
  return {
    scanId: idOrAddress.startsWith("scan_") ? idOrAddress : `scan_${DEMO_ADDRESS.slice(2, 8)}`,
    status: done ? "completed" : resolved === 0 ? "queued" : "running",
    stages,
    token: {
      chainId: chainId ?? "robinhood",
      address: DEMO_ADDRESS,
      name: "Test Token",
      symbol: "TOKEN"
    }
  };
}

export function buildFixtureReport(chainId: ChainId, address: string): ScanReport {
  const addr = address.startsWith("0x") ? address : DEMO_ADDRESS;
  return {
    scanId: "scan_83ab1c",
    status: "completed",
    token: {
      chainId,
      address: addr,
      name: "Test Token",
      symbol: "TOKEN",
      decimals: 18,
      verified: true,
      totalSupply: "1000000000",
      holders: 2341,
      createdAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
      deployer: DEMO_ADDRESS
    },
    // Higher score means greater risk. This demo token is dangerous, so its Risk Score is high.
    riskScore: 88,
    scoreExplanation:
      "This token can currently be bought and sold, but the owner can blacklist wallets and raise the sell tax to 100%. Liquidity is not locked and 58% of non-pool supply sits in related wallets.",
    checks: { critical: 2, high: 2, medium: 1, passed: 12 },
    stages: buildFixtureJob(addr, chainId, STAGE_DEFS.length).stages,
    findings: [
      {
        id: "blacklist",
        severity: "critical",
        title: "Owner can blacklist wallets",
        summary: "The contract contains an active blacklist function controlled by the owner.",
        detail:
          "A blacklisted wallet can be blocked from transferring or selling entirely, letting the owner trap specific holders while others trade freely.",
        technical:
          "The _blacklist mapping is checked inside _transfer; the owner can set arbitrary addresses via setBlacklist(address,bool).",
        affectedFunction: "setBlacklist(address,bool)",
        controller: DEMO_ADDRESS,
        block: 18428904,
        confidence: "high",
        recommendation:
          "Do not hold long-term. The owner can freeze your ability to sell at any time.",
        detectorId: "OWNER_BLACKLIST",
        detectorVersion: "1.4",
        evidence:
          "function setBlacklist(address a, bool v) external onlyOwner {\n    _blacklist[a] = v; // slot 0x0b\n    emit Blacklist(a, v);\n}"
      },
      {
        id: "selltax",
        severity: "critical",
        title: "Sell tax can be increased to 100%",
        summary: "The owner can update the sell tax to a maximum of 100% at any time.",
        detail:
          "A 100% sell tax means every token you sell is taken as fee — a honeypot the owner can trigger on demand.",
        technical:
          "setFees(uint256 buy, uint256 sell) has no upper-bound check; sell is applied directly in _transfer.",
        affectedFunction: "setFees(uint256,uint256)",
        controller: DEMO_ADDRESS,
        block: 18428904,
        confidence: "high",
        recommendation: "Treat current low taxes as temporary; assume the sell tax can reach 100%.",
        detectorId: "MUTABLE_FEE",
        detectorVersion: "1.4",
        evidence:
          "function setFees(uint256 b, uint256 sTax) external onlyOwner {\n    buyFee = b;\n    sellFee = sTax; // no cap\n}"
      },
      {
        id: "liq",
        severity: "high",
        title: "Liquidity is not locked",
        summary: "The primary LP is unlocked and 72% is controlled by the deployer.",
        detail:
          "Unlocked, deployer-controlled liquidity can be pulled at any time, leaving holders unable to sell.",
        technical:
          "LP tokens for the pair are held by the deployer EOA, not a timelock or burn address.",
        affectedFunction: "removeLiquidity()",
        controller: DEMO_ADDRESS,
        block: 18429102,
        confidence: "high",
        recommendation: "Verify liquidity is locked before committing capital.",
        detectorId: "LP_UNLOCKED",
        detectorVersion: "1.4",
        evidence: "LP holder: " + DEMO_ADDRESS + " (EOA)\nlockContract: none\nburned: 18%"
      },
      {
        id: "conc",
        severity: "medium",
        title: "Top 10 wallets hold 63% of supply",
        summary: "Holder concentration is elevated across related wallets.",
        detail:
          "A few holders can crash the price by selling, and clustered wallets may be linked to the deployer.",
        technical: "3 of the top 10 wallets were funded from the deployer address.",
        confidence: "medium",
        recommendation: "Factor in that a small number of wallets can move the market.",
        detectorId: "HOLDER_CONC",
        detectorVersion: "1.4",
        evidence: "top1: 18.4%\ntop5: 41.7%\ntop10: 63.2%\nclustered-with-deployer: 3"
      }
    ],
    controls: {
      ownershipRenounced: false,
      canMint: false,
      canBlacklist: true,
      canPause: true,
      canChangeTaxes: true,
      isProxy: false,
      upgradeable: false,
      canLimitTransactions: true,
      canDisableTrading: false,
      hasFeeWhitelist: true
    },
    simulation: {
      buyTaxBps: 480,
      sellTaxBps: 2730,
      transferTaxBps: 0,
      maxSellTaxBps: 10000,
      maxWalletBps: 200,
      isHoneypot: false,
      canBuy: true,
      canSell: true,
      results: [
        { label: "Buy test (0.1 native)", status: "passed" },
        { label: "Sell test (20%)", status: "passed", detail: "Tax 27.3%" },
        { label: "Sell test (50%)", status: "passed", detail: "Tax 27.6%" },
        { label: "Sell test (100%)", status: "failed", detail: "Reverted — would lose 100%" },
        { label: "Transfer test", status: "passed" }
      ]
    },
    liquidity: {
      totalUsd: 182400,
      locked: false,
      deployerControlledPct: 72,
      burnedPct: 18,
      lockedPct: 10,
      lpOwner: DEMO_ADDRESS
    },
    holders: {
      top1Pct: 18.4,
      top5Pct: 41.7,
      top10Pct: 63.2,
      holderCount: 2341,
      clusteredWithDeployer: 3
    },
    scannerVersion: "v1.4.0",
    block: 18429311,
    dataSource: "Robinhood RPC",
    scannedAt: new Date(Date.now() - 12_000).toISOString(),
    detectorChecks: []
  };
}

export const FIXTURE_RECENT: RecentScan[] = [
  {
    chainId: "robinhood",
    address: "0x91abaa0000000000000000000000000000003c6d",
    name: "Rug Inc",
    symbol: "RUG",
    riskScore: 92,
    scannedAt: new Date(Date.now() - 2 * 60_000).toISOString()
  },
  {
    chainId: "ethereum",
    address: "0x7f3e000000000000000000000000000000009a1b",
    name: "Taxable",
    symbol: "TAX",
    riskScore: 69,
    scannedAt: new Date(Date.now() - 7 * 60_000).toISOString()
  },
  {
    chainId: "bnb",
    address: "0x6d2a0000000000000000000000000000008f7e1d",
    name: "BlockList",
    symbol: "BLK",
    riskScore: 66,
    scannedAt: new Date(Date.now() - 11 * 60_000).toISOString()
  },
  {
    chainId: "base",
    address: "0xab120000000000000000000000000000004ef567",
    name: "Whale Token",
    symbol: "WHL",
    riskScore: 48,
    scannedAt: new Date(Date.now() - 18 * 60_000).toISOString()
  },
  {
    chainId: "ethereum",
    address: "0xcd450000000000000000000000000000007ab890",
    name: "Unlocked",
    symbol: "ULK",
    riskScore: 43,
    scannedAt: new Date(Date.now() - 24 * 60_000).toISOString()
  }
];
