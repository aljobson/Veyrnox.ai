import { OUTPUT_FILE_FACTS, outputFileSummary } from '../_lib/outputFileDisclosure';

export function OutputFileDisclosure({ className = '' }) {
  return (
    <details className={`group rounded-xl border border-vx-border bg-vx-base/35 ${className}`.trim()}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
        <span>
          <span className="block text-xs font-extrabold text-vx-fg">Export facts</span>
          <span className="mt-0.5 block text-[10px] leading-4 text-vx-fg-muted">{outputFileSummary()}</span>
        </span>
        <span aria-hidden="true" className="text-vx-accent transition-transform group-open:rotate-45">＋</span>
      </summary>
      <dl className="grid gap-3 border-t border-vx-border px-3 py-3 sm:grid-cols-2">
        {OUTPUT_FILE_FACTS.map((fact) => (
          <div key={fact.label}>
            <dt className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-fg-muted">{fact.label}</dt>
            <dd className="mt-1 text-xs font-extrabold text-vx-fg">{fact.value}</dd>
            <dd className="mt-0.5 text-[10px] leading-4 text-vx-fg-muted">{fact.detail}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
