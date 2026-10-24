'use client';
import { useI18n } from '../../../components/I18nProvider';
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
export function PresetCard({ preset, size = 'md', onClick, catalog, variant = 'standard', className = '' }) {
  const { t } = useI18n();
  const sizes = {
    sm: { title: 'text-sm' },
    md: { title: 'text-base' },
    lg: { title: 'text-lg' },
  };
  const s = sizes[size];
  // The template's own page shows its prompt and inputs before anyone is
  // sent to the studio with them.
  const href = templateHref(preset);
  const clip = preset.clipKey ? SHOWCASE_CLIPS[preset.clipKey] : null;
  const roller = variant === 'roller';
  const title = presetTitle(preset.name);
  return (
    <MediaTile
      href={href}
      clip={clip && { ...clip, objectFit: 'contain' }}
      onClick={onClick}
      ariaLabel={t('mobile.templateOpen', { name: title })}
      className={`${roller ? 'h-full min-h-0' : 'block w-full'} text-start ${className}`}
      mediaClassName={`${roller ? 'h-full' : ''} rounded-2xl`}
      mediaStyle={{ background: preset.bg, ...(roller ? {} : { aspectRatio: clip?.aspectRatio || preset.previewAspect || '4 / 5' }) }}
      imageSizes={roller ? '(max-width: 639px) 45vw, 220px' : undefined}
      footer={!roller &&
        <div className="pt-3 flex items-baseline gap-2">
          <div className="min-w-0">
            <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{title}</div>
            <div className="mt-0.5 text-vx-fg-muted text-xs truncate">{preset.model}{preset.durationSeconds ? t('mobile.templateDuration', { n: preset.durationSeconds }) : ''}</div>
            <div className="mt-1 line-clamp-1 text-[11px] text-vx-fg-muted">{preset.prompt}</div>
          </div>
          <span aria-hidden className="vx-leader flex-1 self-start mt-3 text-vx-fg-muted" />
          <div className="shrink-0 self-start font-vx-mono text-[14px] font-bold text-vx-money vx-num pt-0.5">{presetCredits(preset, catalog)} cr</div>
        </div>
      }
    >
      {preset.isNew && <span className="absolute end-3 top-3 rounded-full bg-vx-base/80 px-2 py-0.5 font-vx-mono text-[10px] font-bold tracking-[0.12em]">{t('mobile.new')}</span>}
      {roller && (
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-black/75 p-2.5 text-white backdrop-blur-sm">
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-extrabold tracking-tight">{title}</span>
            <span className="mt-0.5 block truncate font-vx-mono text-[9px] text-white/70">{preset.durationSeconds ? t('mobile.templateDuration', { n: preset.durationSeconds }) : preset.model}</span>
          </span>
          <span className="shrink-0 font-vx-mono text-[11px] font-bold text-vx-money">{presetCredits(preset, catalog)} cr</span>
        </span>
      )}
    </MediaTile>
  );
}

