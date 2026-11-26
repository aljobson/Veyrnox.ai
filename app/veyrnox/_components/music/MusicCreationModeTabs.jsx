import { MusicCreateIcon } from './MusicCreateIcon';

export function MusicCreationModeTabs({ mode, onChange }) {
  return (
    <div
      role="group"
      aria-label="Music creation mode"
      className="grid w-full grid-cols-2 rounded-2xl border border-vx-border bg-vx-base p-1.5 text-sm font-extrabold sm:text-base"
    >
      {[
        { value: 'simple', label: 'Describe', icon: 'describe' },
        { value: 'custom', label: 'Lyrics', icon: 'lyrics' },
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={mode === item.value}
          onClick={() => onChange(item.value)}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 transition-[background-color,color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent ${mode === item.value ? 'bg-vx-panel-raised text-vx-fg shadow-[inset_0_0_0_1px_rgb(var(--vx-border))]' : 'text-vx-fg-muted hover:bg-vx-panel hover:text-vx-fg'}`}
        >
          <MusicCreateIcon name={item.icon} className="h-4 w-4" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
