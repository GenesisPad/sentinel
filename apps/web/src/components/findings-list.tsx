"use client";
import type { Finding } from "@/lib/types";
import { sortFindings } from "@/lib/risk";
import { FindingCard } from "@/components/finding-card";
import { useUiStore } from "@/store/ui-store";
import { EmptyState } from "@/components/empty-state";

/** Findings are always ordered most-serious-first (before charts / secondary info). */
export function FindingsList({ findings }: { findings: Finding[] }) {
  const view = useUiStore((s) => s.reportView);
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No critical findings detected"
        body="This does not guarantee that the token is safe."
      />
    );
  }
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2.5">
      {sortFindings(findings).map((f) => (
        <FindingCard key={f.id} finding={f} showEvidence={view === "technical"} />
      ))}
    </div>
  );
}
