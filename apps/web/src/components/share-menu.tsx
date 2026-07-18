"use client";
import { Check, Link2, Send, Share2 } from "lucide-react";
import { useState } from "react";
import type { ScanReport } from "@/lib/types";
import { CHAINS } from "@/lib/chains";
import { riskFromScore } from "@/lib/risk";
import { shortAddress } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Share links always point to the canonical /token/:chainId/:address page. */
export function ShareMenu({ report }: { report: ScanReport }) {
  const [copied, setCopied] = useState(false);
  const chain = CHAINS[report.token.chainId];
  const path = `/token/${report.token.chainId}/${report.token.address}`;
  const url =
    (process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "")) + path;
  const risk = riskFromScore(report.riskScore);
  const tokenLabel = report.token.symbol ? `$${report.token.symbol}` : shortAddress(report.token.address);
  const scoreText =
    report.riskScore != null ? `Risk Score: ${report.riskScore}/100` : "Risk Score unavailable";
  const text = `${tokenLabel} on ${chain.label} — ${risk.label} (${scoreText}) via Genesis Sentinel`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Genesis Sentinel", text, url });
      } catch {
        /* dismissed */
      }
    } else {
      await copyLink();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
        {copied ? <Check className="size-4 text-primary" /> : <Link2 className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button asChild variant="secondary" size="sm">
        <a href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          <Send className="size-4" /> Telegram
        </a>
      </Button>
      <Button asChild variant="secondary" size="sm">
        <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
          <Share2 className="size-4" /> Share to X
        </a>
      </Button>
      <Button variant="secondary" size="sm" onClick={() => void nativeShare()} className="sm:hidden">
        <Share2 className="size-4" /> Share
      </Button>
    </div>
  );
}
