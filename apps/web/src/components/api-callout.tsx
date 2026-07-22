import Link from "next/link";
import { ArrowRight, Check, Code2 } from "lucide-react";

export function ApiCallout() {
  return (
    <section className="relative min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-[linear-gradient(160deg,#0f1409,#0c0e0c)] p-5 sm:p-8">
      <div className="pointer-events-none absolute -right-8 top-5 size-44 rounded-full bg-[radial-gradient(circle,rgba(180,241,31,0.16),transparent_70%)]" aria-hidden />
      <div className="relative">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
          <Code2 className="size-6" aria-hidden />
        </div>
        <h2 className="font-display text-2xl font-semibold leading-tight">
          Build with
          <br />
          Genesis <span className="text-primary">Sentinel</span>
        </h2>
        <p className="mb-4 mt-3 text-[15px] leading-relaxed text-muted">
          Integrate real-time token risk intelligence into your dApp, wallet, bot, or trading platform.
        </p>
        <ul className="mb-5 flex flex-col gap-2 text-sm text-secondary">
          {["Powerful REST API", "Real-time security data", "Scalable and developer-friendly"].map((f) => (
            <li key={f} className="flex items-center gap-2.5">
              <Check className="size-4 text-primary" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-5 py-3 text-sm font-bold transition-colors hover:border-muted"
        >
          View Developer Docs <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
