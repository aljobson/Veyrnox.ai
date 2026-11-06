'use client';

export function SmartCutEntry({ enabled, selectedCount, onEnable }) {
  return (
    <section aria-labelledby="smart-cut-entry-title" className="mx-auto max-w-[1400px] px-4 pb-2 sm:px-8">
      <div className="overflow-hidden rounded-[1.75rem] border border-vx-accent/40 bg-vx-panel-raised shadow-[0_1px_0_rgb(var(--vx-border)),0_18px_48px_rgb(0_0_0/0.12)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5 sm:p-7">
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.15em] text-vx-accent">SMART CUT · DEVICE PREVIEW</p>
            <h2 id="smart-cut-entry-title" className="vx-display mt-2 max-w-[13ch] text-[34px] sm:text-[44px]">Make a first cut in minutes.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-vx-fg-body">
              Pick up to 10 finished videos, choose the pace, and review every suggested section before Veyrnox creates the edit. Planning is local and free; the render price is shown before you confirm.
            </p>
            <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="Smart Cut steps">
              {[
                ['01', 'Pick clips', 'Choose finished videos below.'],
                ['02', 'Review the cut', 'Set the pace and swap takes.'],
                ['03', 'Create video', 'Confirm the final price first.'],
              ].map(([number, title, detail]) => (
                <li key={number} className="rounded-2xl border border-vx-border bg-vx-base p-4">
                  <span className="font-vx-mono text-[10px] font-bold text-vx-accent">{number}</span>
                  <strong className="mt-2 block text-sm text-vx-fg">{title}</strong>
                  <span className="mt-1 block text-xs leading-5 text-vx-fg-muted">{detail}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col justify-center border-t border-vx-border bg-vx-base/60 p-5 lg:border-l lg:border-t-0 sm:p-7">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.13em] text-vx-fg-muted">{enabled ? 'READY ON THIS DEVICE' : 'PREVIEW SWITCH'}</span>
            <p className="mt-2 text-sm leading-6 text-vx-fg-body">
              {enabled
                ? selectedCount > 0
                  ? `${selectedCount} video${selectedCount === 1 ? '' : 's'} selected. Use the bar at the bottom to open Smart Cut.`
                  : 'Smart Cut is ready. Select one or more videos from your Library.'
                : 'Turn on the Clip Editor preview for this browser. You can turn it off later by clearing site data.'}
            </p>
            {enabled ? (
              <button type="button" onClick={() => document.getElementById('library-assets')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="vx-press mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                {selectedCount > 0 ? 'Pick another clip' : 'Pick clips below'}
              </button>
            ) : (
              <button type="button" onClick={onEnable} className="vx-press mt-5 min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                Enable Smart Cut preview
              </button>
            )}
            <p className="mt-3 text-[11px] leading-5 text-vx-fg-muted">No clip is uploaded or changed when you enable the preview.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
