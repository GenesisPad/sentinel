import type { DetectorCheckSummary } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";

const OUTCOME_STYLE: Record<DetectorCheckSummary["outcome"], { label: string; hex: string }> = {
  detected: { label: "Detected", hex: "#f0483e" },
  passed: { label: "Passed", hex: "#37d67a" },
  unsupported: { label: "Unsupported", hex: "#8b938a" },
  failed: { label: "Failed", hex: "#f0483e" },
  inconclusive: { label: "Inconclusive", hex: "#f5a623" },
  unavailable: { label: "Data unavailable", hex: "#8b938a" },
};

const DETECTOR_LABELS: Record<string, string> = {
  "blacklist-selector-patterns": "Wallet blocking check",
  "mint-selector-patterns": "Token creation check",
  "pause-selector-patterns": "Transfer pause check",
  "tax-selector-patterns": "Tax and fee check",
  "proxy-selector-patterns": "Proxy contract check",
  "max-transaction-selector-patterns": "Trade and wallet limit check",
  "cooldown-selector-patterns": "Cooldown and anti-bot check",
  "trading-control-selector-patterns": "Trading stop check",
  "fee-exclusion-selector-patterns": "Whitelist or exemption check",
  "ownership-status": "Ownership check",
  "source-control-patterns": "Source-code control check",
  "dangerous-opcode-detector": "Suspicious function check",
  "eip1967-proxy-detector": "Upgradeable proxy check",
};

const CHECK_LABELS: Record<string, string> = {
  BLACKLIST_SELECTORS_PRESENT: "Can block wallets",
  PROXY_SELECTORS_PRESENT: "Proxy or upgrade controls",
  MINT_SELECTORS_PRESENT: "Can create more tokens",
  PAUSE_SELECTORS_PRESENT: "Can pause transfers",
  MAX_TRANSACTION_SELECTORS_PRESENT: "Can limit trade or wallet size",
  COOLDOWN_SELECTORS_PRESENT: "Trading cooldown or anti-bot controls",
  TRADING_CONTROL_SELECTORS_PRESENT: "Can stop trading",
  FEE_EXCLUSION_SELECTORS_PRESENT: "Has whitelist or exempt wallets",
  OWNERSHIP_RENOUNCED: "Ownership renounced",
  OWNERSHIP_ACTIVE: "Owner still active",
  EIP1967_PROXY_DETECTED: "Upgradeable proxy detected",
  EIP1967_BEACON_PROXY_DETECTED: "Beacon proxy detected",
  EIP1967_PROXY_ABSENT: "No EIP-1967 proxy detected",
  DELEGATECALL_OPCODE_PRESENT: "Suspicious delegatecall function",
  DELEGATECALL_OPCODE_ABSENT: "No delegatecall function detected",
  SELFDESTRUCT_OPCODE_PRESENT: "Self-destruct function detected",
  SELFDESTRUCT_OPCODE_ABSENT: "No self-destruct function detected",
  SOURCE_BLACKLIST_CONTROL: "Can block or restrict wallets",
  SOURCE_BLACKLIST_CONTROL_ABSENT: "No blocklist controls found in source",
  SOURCE_TRADING_COOLDOWN_CONTROL: "Trading cooldown or anti-bot controls",
  SOURCE_TRADING_COOLDOWN_CONTROL_ABSENT: "No cooldown controls found in source",
  SOURCE_OBFUSCATED_ADDRESS: "Hidden or obfuscated addresses",
  SOURCE_OBFUSCATED_ADDRESS_DETECTED: "Hidden or obfuscated addresses",
  SOURCE_OBFUSCATED_ADDRESS_ABSENT: "No obfuscated addresses found in source",
  SOURCE_TRADING_TOGGLE: "Can turn trading on or off",
  SOURCE_TRADING_TOGGLE_ABSENT: "No trading toggle found in source",
  SOURCE_OWNERSHIP_RECOVERY_SURFACE: "Hidden owner recovery controls",
  SOURCE_OWNERSHIP_RECOVERY_SURFACE_ABSENT: "No owner recovery controls found",
  SOURCE_PRIVILEGED_ROLE_CONTROL: "Special admin roles detected",
  SOURCE_PRIVILEGED_ROLE_CONTROL_ABSENT: "No special admin roles found",
  SOURCE_ADMIN_TRANSFER_SURFACE: "Admin transfer controls",
  SOURCE_ADMIN_TRANSFER_SURFACE_ABSENT: "No admin transfer controls found",
  SOURCE_MINT_OR_SUPPLY_CONTROL: "Can change token supply",
  SOURCE_MINT_OR_SUPPLY_CONTROL_ABSENT: "No supply controls found",
  SOURCE_TAX_OR_LIMIT_CONTROL: "Can change taxes or limits",
  SOURCE_TAX_OR_LIMIT_CONTROL_ABSENT: "No tax or limit controls found",
  SOURCE_ROUTER_OR_PAIR_REPLACEMENT: "Can replace router or pair",
  SOURCE_ROUTER_OR_PAIR_REPLACEMENT_ABSENT: "No router or pair replacement found",
  SOURCE_ARBITRARY_EXTERNAL_CALL: "Can make arbitrary external calls",
  SOURCE_ARBITRARY_EXTERNAL_CALL_ABSENT: "No arbitrary external calls found",
};

/** Per-detector outcomes: the evidence trail behind the summarized findings and controls. */
export function DetectorChecksTable({ checks }: { checks: DetectorCheckSummary[] }) {
  if (checks.length === 0) {
    return (
      <EmptyState
        title="No detector checks recorded yet"
        body="Check outcomes appear here once the backend exposes them for this scan."
      />
    );
  }

  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-4 font-semibold">Detector</th>
            <th className="py-2 pr-4 font-semibold">Check</th>
            <th className="py-2 pr-4 font-semibold">Outcome</th>
            <th className="py-2 font-semibold">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check, index) => {
            const style = OUTCOME_STYLE[check.outcome];
            const detectorLabel = DETECTOR_LABELS[check.detectorId] ?? humanizeCode(check.detectorId);
            const checkLabel = CHECK_LABELS[check.code] ?? humanizeCode(check.code);
            return (
              <tr key={`${check.detectorId}-${check.code}-${index}`} className="border-b border-border/60">
                <td className="py-2 pr-4 text-secondary">
                  <div className="font-semibold">{detectorLabel}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint">{check.detectorId}</div>
                </td>
                <td className="py-2 pr-4 text-secondary">
                  <div className="font-semibold">{checkLabel}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint">{check.code}</div>
                </td>
                <td className="py-2 pr-4 font-bold" style={{ color: style.hex }}>
                  {style.label}
                </td>
                <td className="py-2 text-muted">{check.confidence ?? "Unknown"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function humanizeCode(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
