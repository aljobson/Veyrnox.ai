export function MusicDurationField({ id, ariaLabel, value, onChange, bounds, blockSeconds }) {
  const { min = 10, max = 60 } = bounds || {};
  const simple = id === 'music-duration';

  return (
    <label className={simple ? 'block rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm font-bold text-vx-fg-body' : 'block text-sm font-bold text-vx-fg-body'}>
      <span className="flex items-center justify-between gap-3"><span>Song duration</span><output htmlFor={id} className="font-vx-mono text-xs text-vx-accent">{value} seconds</output></span>
      <input id={id} aria-label={ariaLabel} type="range" min={min} max={max} step="5" value={value} onChange={onChange} className="mt-3 w-full accent-vx-accent" />
      {blockSeconds ? (
        <>
          <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">The price grows with length in {blockSeconds}-second steps. Review the quote to see the exact price before any credits move.</span>
          {value > 60 ? <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">Longer songs take longer to generate.</span> : null}
        </>
      ) : simple ? <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">The quoted candidate price covers any selected length from 10 to 60 seconds.</span> : null}
    </label>
  );
}
