import type { Severity } from "./types";

/**
 * Risk Score model for Genesis Sentinel.
 * IMPORTANT: higher = greater detected risk. 0 is minimal detected risk, 100 is maximum detected risk.
 */
export type RiskLevel = "low" | "moderate" | "elevated" | "high" | "critical" | "unknown";

export interface RiskDescriptor {
  level: RiskLevel;
  /** Explicit human label; never render a bare "High Risk" column header without this. */
  label: string;
  /** Tailwind text/border/bg tokens (see globals.css). */
  colorVar: string;
  hex: string;
}

export const RISK_DESCRIPTORS: Record<RiskLevel, RiskDescriptor> = {
  low: { level: "low", label: "Low Risk", colorVar: "--pass", hex: "#37d67a" },
  moderate: { level: "moderate", label: "Moderate Risk", colorVar: "--warn", hex: "#f5a623" },
  elevated: { level: "elevated", label: "Elevated Risk", colorVar: "--orange", hex: "#ff8a3d" },
  high: { level: "high", label: "High Risk", colorVar: "--orange", hex: "#ff8a3d" },
  critical: { level: "critical", label: "Critical Risk", colorVar: "--danger", hex: "#f0483e" },
  unknown: { level: "unknown", label: "Unable to Assess", colorVar: "--muted", hex: "#8b938a" }
};

/**
 * Map a canonical Risk Score to a risk level.
 *    0-19   Low Risk
 *   20-39   Moderate Risk
 *   40-59   Elevated Risk
 *   60-79   High Risk
 *   80-100  Critical Risk
 */
export function riskFromScore(score: number | null | undefined): RiskDescriptor {
  if (score == null || Number.isNaN(score)) return RISK_DESCRIPTORS.unknown;
  if (score >= 80) return RISK_DESCRIPTORS.critical;
  if (score >= 60) return RISK_DESCRIPTORS.high;
  if (score >= 40) return RISK_DESCRIPTORS.elevated;
  if (score >= 20) return RISK_DESCRIPTORS.moderate;
  return RISK_DESCRIPTORS.low;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

export interface SeverityStyle {
  label: string;
  hex: string;
  bg: string;
  border: string;
}

export const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  critical: {
    label: "CRITICAL",
    hex: "#f0483e",
    bg: "rgba(240,72,62,0.14)",
    border: "rgba(240,72,62,0.35)"
  },
  high: {
    label: "HIGH",
    hex: "#ff8a3d",
    bg: "rgba(255,138,61,0.14)",
    border: "rgba(255,138,61,0.32)"
  },
  medium: {
    label: "MEDIUM",
    hex: "#f5a623",
    bg: "rgba(245,166,35,0.12)",
    border: "rgba(245,166,35,0.3)"
  },
  low: {
    label: "LOW",
    hex: "#8b938a",
    bg: "rgba(139,147,138,0.12)",
    border: "rgba(139,147,138,0.28)"
  },
  info: {
    label: "INFO",
    hex: "#6ea8ff",
    bg: "rgba(110,168,255,0.12)",
    border: "rgba(110,168,255,0.28)"
  }
};

export function sortFindings<T extends { severity: Severity }>(findings: T[]): T[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
