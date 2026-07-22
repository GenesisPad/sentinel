"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { TokenMeta } from "@/lib/types";
import { CHAINS } from "@/lib/chains";
import { shortAddress, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function TokenHeader({
  token,
  size = "md",
  className,
}: {
  token: TokenMeta;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const chain = CHAINS[token.chainId];
  const [copied, setCopied] = useState(false);
  const supply = formatTokenSupply(token.totalSupply, token.decimals);
  const profileFacts = [
    token.createdAt ? `Created ${timeAgo(token.createdAt)}` : null,
    token.holders ? `${token.holders.toLocaleString()} holders` : null,
    supply ? `Supply ${supply}` : null,
    token.decimals != null ? `${token.decimals} decimals` : null,
  ].filter((fact): fact is string => Boolean(fact));

  async function copy() {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  const avatar = size === "lg" ? "size-16" : size === "sm" ? "size-11" : "size-14";
  const [failedIconAddress, setFailedIconAddress] = useState<string | null>(null);
  const showIcon = !!token.iconUrl && failedIconAddress !== token.address;

  return (
    <div className={cn("flex min-w-0 max-w-full items-center gap-3 sm:gap-4", className)}>
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-[#0e1a06]",
          avatar,
        )}
        style={{ borderColor: "#b4f11f" }}
        aria-hidden
      >
        {showIcon ? (
          // Plain <img>, not next/image: token icon URLs come from arbitrary third-party
          // sources (Blockscout, DexScreener) that can't be allowlisted in next.config ahead of
          // time. Falls back to the placeholder mark on load failure.
          <img
            key={token.address}
            src={token.iconUrl}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setFailedIconAddress(token.address)}
          />
        ) : (
          <svg viewBox="0 0 34 34" className="size-1/2">
            <path d="M17 6 L26 11 L17 28 L8 11 Z" fill="#b4f11f" />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="min-w-0 break-words font-display text-xl font-bold [overflow-wrap:anywhere] sm:text-2xl">
            {token.name ?? shortAddress(token.address)}
          </h1>
          {token.symbol ? <span className="font-mono text-sm text-muted">${token.symbol}</span> : null}
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Address copied" : "Copy contract address"}
            className="text-faint transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
          >
            {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            style={{ color: chain.color, backgroundColor: "rgba(180,241,31,0.12)", border: "1px solid rgba(180,241,31,0.3)" }}
          >
            {chain.label}
          </span>
          <span className="font-mono text-xs">{shortAddress(token.address)}</span>
          {token.verified === true ? <span className="text-primary">Verified</span> : null}
          {token.verified === false ? <span className="text-warn">Unverified</span> : null}
          {token.verified != null && token.dexPaid != null ? (
            <span className="h-3 w-px bg-border-strong" aria-hidden />
          ) : null}
          {token.dexPaid === true ? <span className="text-primary">Dex · Paid</span> : null}
          {token.dexPaid === false ? <span className="text-faint">Dex · Not Paid</span> : null}
        </div>
        {profileFacts.length > 0 ? (
          <p className="mt-1 break-words text-xs text-faint [overflow-wrap:anywhere]">
            {profileFacts.join(" | ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatTokenSupply(value: string | undefined, decimals: number | null): string | null {
  if (!value) return null;
  const numeric = Number(value) / 10 ** (decimals ?? 0);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M`;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
