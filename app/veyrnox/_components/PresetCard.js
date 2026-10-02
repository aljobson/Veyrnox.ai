import Link from 'next/link';
import { presetHref, presetCredits, presetTitle } from '../_lib/tokens.js';

// Preset card: thumbnail carries color, monochrome chrome around it.
//
// Renders a Link, not a button. It used to be a <button onClick> and every
// caller omitted onClick, so every card in the public gallery and the studio
// Explore tab was focusable, cursor-pointer, hover-scaling — and completely
// inert, while the landing page sent people here with "Browse presets free".
// An onClick is still honoured for callers that want to intercept.
export function PresetCard({ preset, size = 'md', onClick, catalog }) {
  const sizes = {
    sm: { h: 'h-40', title: 'text-sm', tag: 'text-[10px]' },
    md: { h: 'h-52', title: 'text-base', tag: 'text-[10px]' },
    lg: { h: 'h-72', title: 'text-lg', tag: 'text-[10px]' },
  };
  const s = sizes[size];
  // Carry both: Create reads ?model= on mount, and ?preset= records which
  // card sent the user. If the preset's model name has drifted out of the
  // catalog, link without one rather than preselecting something wrong.
  const href = presetHref(preset);
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={`Open the ${preset.name} preset in the studio`}
      className="vx-tile group block text-left w-full"
    >
      <div className={`${s.h} rounded-2xl`} style={{ background: preset.bg }} />
      <div className="pt-3 flex items-baseline gap-2">
        <div className="min-w-0">
          <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{presetTitle(preset.name)}</div>
          <div className="mt-0.5 text-vx-fg-muted text-xs truncate">{preset.model}</div>
        </div>
        <span aria-hidden className="vx-leader flex-1 self-start mt-3 text-vx-fg-muted" />
        <div className="shrink-0 self-start font-vx-mono text-[14px] font-bold text-vx-money vx-num pt-0.5">{presetCredits(preset, catalog)} cr</div>
      </div>
    </Link>
  );
}

