import { Chip } from './Chip';

// Preset card: thumbnail carries color, monochrome chrome around it.
export function PresetCard({ preset, size = 'md', onClick }) {
  const sizes = {
    sm: { h: 'h-40', title: 'text-sm', tag: 'text-[10px]' },
    md: { h: 'h-52', title: 'text-base', tag: 'text-[10px]' },
    lg: { h: 'h-72', title: 'text-lg', tag: 'text-[10px]' },
  };
  const s = sizes[size];
  return (
    <button
      onClick={onClick}
      className="group text-left w-full rounded-2xl border border-muon-border bg-muon-panel overflow-hidden transition-transform duration-200 ease-out hover:scale-[1.015]"
    >
      <div
        className={`${s.h} relative`}
        style={{ background: preset.bg }}
      >
        {preset.badge && (
          <span className="absolute top-3 left-3">
            <Chip tone="neutral" className="bg-black/45 backdrop-blur">{preset.badge}</Chip>
          </span>
        )}
        {preset.views && (
          <span className="absolute top-3 right-3 font-muon-mono text-[11px] font-bold text-white/85 bg-black/45 backdrop-blur rounded-full px-2.5 py-1 muon-num">
            ▶ {preset.views}
          </span>
        )}
      </div>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{preset.name}</div>
          <div className="mt-0.5 text-muon-fg-muted text-xs truncate">{preset.model}</div>
        </div>
        <div className="shrink-0 font-muon-mono text-[13px] font-bold text-muon-money muon-num pt-1">{preset.credits} cr</div>
      </div>
    </button>
  );
}
