import { MediaTile } from './MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { templateHref, presetCredits, presetTitle } from '../_lib/tokens.js';

// Preset card: credited viral preview, monochrome chrome around it.
//
// Renders a Link, not a button. It used to be a <button onClick> and every
// caller omitted onClick, so every card in the public gallery and the studio
// Explore tab was focusable, cursor-pointer, hover-scaling — and completely
// inert, while the landing page sent people here with "Browse presets free".
// An onClick is still honoured for callers that want to intercept.
export function PresetCard({ preset, size = 'md', onClick, catalog }) {
  const sizes = {
    sm: { h: 'lg:h-40', title: 'text-sm', tag: 'text-[10px]' },
    md: { h: 'lg:h-52', title: 'text-base', tag: 'text-[10px]' },
    lg: { h: 'lg:h-72', title: 'text-lg', tag: 'text-[10px]' },
  };
  const s = sizes[size];
  // The template's own page shows its prompt and inputs before anyone is
  // sent to the studio with them.
  const href = templateHref(preset);
  return (
    <MediaTile
      href={href}
      clip={SHOWCASE_CLIPS[preset.clipKey]}
      uncroppedOnMobile
      onClick={onClick}
      ariaLabel={`Open the ${presetTitle(preset.name)} template`}
      className="block text-left w-full"
      mediaClassName={`aspect-[4/5] lg:aspect-auto ${s.h} rounded-2xl`}
      mediaStyle={{ background: preset.bg }}
      footer={
        <div className="pt-3 flex items-baseline gap-2">
          <div className="min-w-0">
            <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{presetTitle(preset.name)}</div>
            <div className="mt-0.5 text-vx-fg-muted text-xs truncate">{preset.model}{preset.durationSeconds ? ` · ${preset.durationSeconds}s` : ''}</div>
          </div>
          <span aria-hidden className="vx-leader flex-1 self-start mt-3 text-vx-fg-muted" />
          <div className="shrink-0 self-start font-vx-mono text-[14px] font-bold text-vx-money vx-num pt-0.5">{presetCredits(preset, catalog)} cr</div>
        </div>
      }
    >
      {preset.isNew && <span className="absolute right-3 top-3 rounded-full bg-vx-base/80 px-2 py-0.5 font-vx-mono text-[10px] font-bold tracking-[0.12em]">NEW</span>}
    </MediaTile>
  );
}

