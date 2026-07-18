export function SiteFooter() {
  return (
    <footer className="mx-auto mt-10 flex max-w-[1360px] flex-wrap items-center justify-center gap-x-7 gap-y-2 px-5 py-6 text-center text-sm text-muted">
      <span className="inline-flex items-center gap-2">
        <svg width="16" height="18" viewBox="0 0 34 40" fill="none" aria-hidden>
          <path d="M17 2 L31 8 V20 C31 30 25 36 17 38 C9 36 3 30 3 20 V8 Z" fill="#0e1a06" stroke="#b4f11f" strokeWidth="2" />
        </svg>
        Built for the Robinhood Ecosystem
      </span>
      <span>Evidence-based analysis</span>
      <span>No hype. Just the truth.</span>
      <span className="text-primary">Evidence first, no guarantees.</span>
    </footer>
  );
}
