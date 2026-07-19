import type { ScanProgress, ScanResultView } from "@genesis-sentinel/shared";
import { mapProgressToJob, mapResultToReport } from "./adapt";
import { CHAINS, type ChainId } from "./chains";
import type { RecentScan, ScanJob, ScanReport } from "./types";
import { FIXTURE_RECENT, buildFixtureJob, buildFixtureReport } from "./fixtures";

// Relative by default: the production Nginx config proxies /v1/* to the API on the same
// origin, so no build-time env value has to be baked into the client bundle to get this
// right (see the "stale localhost:4000" bug this replaced). Override for local dev only.
function apiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return withV1Prefix(process.env.NEXT_PUBLIC_API_BASE_URL);
  }

  if (typeof window === "undefined") {
    return withV1Prefix(process.env.WEB_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4301");
  }

  return "/v1";
}

function withV1Prefix(value: string): string {
  const trimmed = value.replace(/\/+$/u, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "true";

if (USE_FIXTURES && process.env.NODE_ENV === "production") {
  throw new Error("Fixture scan mode is disabled in production.");
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("The network request failed. Check your connection.", "network_error");
  }
  if (res.status === 404) {
    throw new ApiError("Contract not found.", "not_found", 404);
  }
  if (res.status === 503) {
    throw new ApiError("RPC provider temporarily unavailable.", "rpc_unavailable", 503);
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status}).`, "request_failed", res.status);
  }
  return (await res.json()) as unknown;
}

export interface CreateScanArgs {
  address: string;
  chainId?: ChainId;
  fresh?: boolean;
}

function numericChainId(chainId?: ChainId): number {
  return CHAINS[chainId ?? "robinhood"].chainId;
}

/** Deterministic idempotency key so repeat visits to the same token resolve the same scan. */
function idempotencyKeyFor(numericChainId: number, address: string, fresh?: boolean): string {
  const base = `web:${numericChainId}:${address.toLowerCase()}`;
  return fresh ? `${base}:${Date.now()}` : base;
}

/** POST /v1/scans — create (or resolve a cached) scan job. */
export async function createScan(args: CreateScanArgs): Promise<ScanJob> {
  if (USE_FIXTURES) return buildFixtureJob(args.address, args.chainId);
  const chainId = numericChainId(args.chainId);
  const json = await request("/scans", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKeyFor(chainId, args.address, args.fresh) },
    body: JSON.stringify({ chainId, address: args.address }),
  });
  return mapProgressToJob(json as ScanProgress);
}

/** GET /v1/scans/:scanId — poll a scan job's stages/status. */
export async function getScan(scanId: string, pollTick = 0): Promise<ScanJob> {
  if (USE_FIXTURES) return buildFixtureJob(scanId, undefined, pollTick);
  const json = await request(`/scans/${scanId}`);
  return mapProgressToJob(json as ScanProgress);
}

/** GET the persisted result for a scan job (available at any stage, richer once terminal). */
export async function getScanReport(scanId: string): Promise<ScanReport> {
  if (USE_FIXTURES) return buildFixtureReport("robinhood", scanId);
  const json = await request(`/scans/${scanId}/result`);
  return mapResultToReport(json as ScanResultView);
}

/**
 * GET /v1/tokens/:chainId/:address — the token's latest scan result, or null when no scan has
 * ever run for it (404). Never creates a scan itself; callers decide what "no scan yet" means
 * for their flow.
 */
export async function getExistingTokenReport(chainId: ChainId, address: string): Promise<ScanReport | null> {
  if (USE_FIXTURES) return null;
  const numeric = numericChainId(chainId);
  try {
    const json = await request(`/tokens/${numeric}/${address}`);
    return mapResultToReport(json as ScanResultView);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") {
      return null;
    }
    throw error;
  }
}

/**
 * Canonical report for the public /token/:chainId/:address page. Reads the token's latest scan
 * result directly so the page reflects current state instead of being pinned forever to
 * whichever scan the deterministic (non-fresh) idempotency key first resolved to. Only creates a
 * new scan when no scan has ever run for this token.
 */
export async function getTokenReport(chainId: ChainId, address: string): Promise<ScanReport> {
  if (USE_FIXTURES) return buildFixtureReport(chainId, address);
  const existing = await getExistingTokenReport(chainId, address);
  if (existing) return existing;
  const job = await createScan({ address, chainId });
  return getScanReport(job.scanId);
}

/** GET /v1/scans/recent — public "recent detections" feed. */
export async function getRecentScans(): Promise<RecentScan[]> {
  if (USE_FIXTURES) return FIXTURE_RECENT;
  const json = (await request("/scans/recent")) as { scans: RecentScanApiRow[] };
  return json.scans.map((row) => ({
    chainId: (Object.keys(CHAINS) as ChainId[]).find((key) => CHAINS[key].chainId === row.chainId) ?? "robinhood",
    address: row.address,
    name: row.name ?? row.symbol ?? "Unknown token",
    symbol: row.symbol ?? "",
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    scannedAt: row.scannedAt,
  }));
}

interface RecentScanApiRow {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  riskScore: number;
  riskLevel: string;
  scannedAt: string;
}

/** No SSE endpoint on the backend yet — useScan always falls back to polling. */
export function scanEventsUrl(): string | null {
  return null;
}
