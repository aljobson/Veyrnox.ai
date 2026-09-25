import Link from '../../../components/NavigationLink';
import { Chip } from './Chip';
import { modelIdForName } from '../_lib/tokens.js';

// Preset card: thumbnail carries color, monochrome chrome around it.
//
// Renders a Link, not a button. It used to be a <button onClick> and every
// caller omitted onClick, so every card in the public gallery and the studio
// Explore tab was focusable, cursor-pointer, hover-scaling — and completely
// inert, while the landing page sent people here with "Browse presets free".
// An onClick is still honoured for callers that want to intercept.
export function PresetCard({ preset, size = 'md', onClick }) {
  const sizes = {
    sm: { h: 'h-40', title: 'text-sm', tag: 'text-[10px]' },
    md: { h: 'h-52', title: 'text-base', tag: 'text-[10px]' },
    lg: { h: 'h-72', title: 'text-lg', tag: 'text-[10px]' },
  };
  const s = sizes[size];
  // Carry both: Create reads ?model= on mount, and ?preset= records which
  // card sent the user. If the preset's model name has drifted out of the
  // catalog, link without one rather than preselecting something wrong.
  const modelId = modelIdForName(preset.model);
  const href = modelId
    ? `/app/create?model=${encodeURIComponent(modelId)}&preset=${encodeURIComponent(preset.id)}`
    : `/app/create?preset=${encodeURIComponent(preset.id)}`;
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={`Open the ${preset.name} preset in the studio`}
      className="group block text-left w-full rounded-2xl border border-vx-border bg-vx-panel overflow-hidden transition-transform duration-200 ease-out hover:scale-[1.015]"
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
      </div>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{preset.name}</div>
          <div className="mt-0.5 text-vx-fg-muted text-xs truncate">{preset.model}</div>
        </div>
        <div className="shrink-0 font-vx-mono text-[13px] font-bold text-vx-money vx-num pt-1">{preset.credits} cr</div>
      </div>
    </Link>
  );
}
