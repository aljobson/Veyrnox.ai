// Micro-label chip: JetBrains Mono, uppercase, tracking, 10-11px.
// Every tone carries a glyph so meaning survives color-blindness (deutan/protan/tritan)
// and monochrome print. Set `noGlyph` to opt out only when the surrounding text
// already carries an equivalent signal.
export function Chip({ tone = 'neutral', children, className = '', noGlyph = false }) {
  const tones = {
    neutral: { cls: 'border-vx-border text-vx-fg-muted',                                 glyph: null  },
    accent:  { cls: 'border-vx-accent/40 text-vx-accent bg-vx-accent/[0.07]',            glyph: '✓'  },
    money:   { cls: 'border-vx-money/40 text-vx-money bg-vx-money/[0.07]',               glyph: '◆'  },
    danger:  { cls: 'border-vx-danger/40 text-vx-danger bg-vx-danger/[0.07]',            glyph: '✕'  },
    solid:   { cls: 'border-transparent bg-vx-money text-vx-money-ink',                  glyph: '★'  },
    warn:    { cls: 'border-vx-money/40 text-vx-money bg-vx-money/[0.07]',               glyph: '△'  },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 ${t.cls} ${className}`}>
      {!noGlyph && t.glyph && (
        <span aria-hidden="true" className="text-[9px] leading-none">{t.glyph}</span>
      )}
      {children}
    </span>
  );
}
