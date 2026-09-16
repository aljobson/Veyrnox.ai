// Route-level skeleton for the marketing shell. The landing page reads the
// live catalog from Postgres before it can render, so on a cold Worker this
// is what fills the gap instead of a blank document.
export default function Loading() {
  return (
    <div className="min-h-dvh vx-root font-vx bg-vx-base text-vx-fg" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading Veyrnox.ai…</span>
      <div className="h-9 bg-vx-money/60" />
      <div className="h-16 border-b border-vx-border" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-16">
        <div className="mx-auto flex max-w-[900px] flex-col items-center gap-4">
          <Bar className="h-4 w-40 rounded-full" />
          <Bar className="h-12 sm:h-16 w-full max-w-[820px] rounded-2xl" />
          <Bar className="h-12 sm:h-16 w-3/4 rounded-2xl" />
          <Bar className="mt-2 h-5 w-full max-w-[560px] rounded-full" />
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} className="aspect-[4/5] rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

// vx-shimmer is the same sweep the studio uses while a job renders, so a
// loading page and a loading generation read as the same system.
function Bar({ className = '' }) {
  return <div aria-hidden="true" className={`vx-shimmer bg-vx-panel ${className}`} />;
}
