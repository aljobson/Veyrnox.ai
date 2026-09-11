// Micro-label chip: JetBrains Mono, uppercase, tracking, 10-11px.
export function Chip({ tone = 'neutral', children, className = '' }) {
  const tones = {
    neutral: 'border-vx-border text-vx-fg-muted',
    accent:  'border-vx-accent/40 text-vx-accent bg-vx-accent/[0.07]',
    money:   'border-vx-money/40 text-vx-money bg-vx-money/[0.07]',
    danger:  'border-vx-danger/40 text-vx-danger bg-vx-danger/[0.07]',
    solid:   'border-transparent bg-vx-money text-vx-money-ink',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
