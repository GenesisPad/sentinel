import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTokenReport } from "@/lib/api";
import { isSupportedChain, CHAINS } from "@/lib/chains";
import { normalizeAddress } from "@/lib/validate";
import { riskFromScore } from "@/lib/risk";
import { TokenReportView } from "@/components/token-report-view";
import { SiteFooter } from "@/components/site-footer";
import type { ScanReport } from "@/lib/types";
import { shortAddress } from "@/lib/utils";

interface Params {
  params: Promise<{ chainId: string; address: string }>;
}

async function load(chainId: string, address: string): Promise<ScanReport | null> {
  if (!isSupportedChain(chainId)) return null;
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  try {
    return await getTokenReport(chainId, normalized);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chainId, address } = await params;
  const report = await load(chainId, address);
  if (!report) return { title: "Token not found" };
  const risk = riskFromScore(report.riskScore);
  const chain = CHAINS[report.token.chainId];
  const displayName = report.token.name ?? shortAddress(report.token.address);
  const symbolSuffix = report.token.symbol ? ` ($${report.token.symbol})` : "";
  const scoreText =
    report.riskScore != null ? `Risk Score: ${report.riskScore}/100` : "Risk Score unavailable";
  const title = `${displayName}${symbolSuffix} - ${risk.label}`;
  const description = `${displayName} on ${chain.label}: ${scoreText} (${risk.label}). ${report.scoreExplanation}`;
  const canonical = `/token/${report.token.chainId}/${report.token.address}`;
  const image = "/brand/social-preview.png";

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: "Genesis Sentinel token scanner" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function TokenPage({ params }: Params) {
  const { chainId, address } = await params;
  const report = await load(chainId, address);
  if (!report) notFound();
  return (
    <>
      <TokenReportView chainId={report.token.chainId} address={report.token.address} initialData={report} />
      <SiteFooter />
    </>
  );
}
