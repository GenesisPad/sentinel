import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatCompactUsd } from "@genesis-sentinel/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (!address) return "";
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function bpsToPct(bps?: number | null): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

/** k/m/b-abbreviated ("$25m", "$50.5k") via the shared formatter also used by the Telegram bot,
 * so the same figure never reads two different ways across the two surfaces. */
export function formatUsd(value?: number | null): string {
  return formatCompactUsd(value) ?? "—";
}

export function formatNumber(value?: number | string | null): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("en-US").format(n);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
