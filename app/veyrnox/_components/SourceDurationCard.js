import { sourceDurationLimit } from '../_lib/modelPricing';

export function SourceDurationCard({ model }) {
  const maxSeconds = sourceDurationLimit(model);
  if (!maxSeconds) return null;
  return (
    <div data-assistant-target="create.duration" className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">SOURCE DURATION</div>
      <div className="mt-3 text-sm font-bold text-vx-fg">Follows your uploaded source</div>
      <p className="mt-1 text-xs text-vx-fg-muted">Up to {maxSeconds} seconds at the displayed price.</p>
      {model?.id === 'latentsync' && <p className="mt-2 text-xs text-vx-fg-muted">Speech must not be longer than the video. We verify its visual duration before charging; use shorter speech or a longer video if needed.</p>}
    </div>
  );
}
