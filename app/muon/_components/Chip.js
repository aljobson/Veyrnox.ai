// Micro-label chip: JetBrains Mono, uppercase, tracking, 10-11px.
export function Chip({ tone = 'neutral', children, className = '' }) {
  const tones = {
    neutral: 'border-muon-border text-muon-fg-muted',
    accent:  'border-muon-accent/40 text-muon-accent bg-muon-accent/[0.07]',
    money:   'border-muon-money/40 text-muon-money bg-muon-money/[0.07]',
    danger:  'border-muon-danger/40 text-muon-danger bg-muon-danger/[0.07]',
    solid:   'border-transparent bg-muon-money text-muon-money-ink',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
