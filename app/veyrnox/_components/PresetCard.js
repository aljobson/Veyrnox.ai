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
export function PresetCard({ preset, size = 'md', onClick, catalog }) {
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
  return (
    <MediaTile
      href={href}
      clip={clip && { ...clip, objectFit: 'contain' }}
      onClick={onClick}
      ariaLabel={t('mobile.templateOpen', { name: presetTitle(preset.name) })}
      className="block text-start w-full"
      mediaClassName="rounded-2xl"
      mediaStyle={{ background: preset.bg, aspectRatio: clip?.aspectRatio || preset.previewAspect || '4 / 5' }}
      footer={
        <div className="pt-3 flex items-baseline gap-2">
          <div className="min-w-0">
            <div className={`font-extrabold tracking-tight truncate ${s.title}`}>{presetTitle(preset.name)}</div>
            <div className="mt-0.5 text-vx-fg-muted text-xs truncate">{preset.model}{preset.durationSeconds ? t('mobile.templateDuration', { n: preset.durationSeconds }) : ''}</div>
            <div className="mt-1 line-clamp-1 text-[11px] text-vx-fg-muted">{preset.prompt}</div>
          </div>
          <span aria-hidden className="vx-leader flex-1 self-start mt-3 text-vx-fg-muted" />
          <div className="shrink-0 self-start font-vx-mono text-[14px] font-bold text-vx-money vx-num pt-0.5">{presetCredits(preset, catalog)} cr</div>
        </div>
      }
    >
      {preset.original && !clip && (
        <div className="absolute inset-0 flex flex-col justify-between p-5 text-white">
          <span className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-white/75">{t('presets.original')}</span>
          <span className="max-w-[12ch] text-[24px] font-extrabold leading-[0.95] tracking-tight sm:text-[28px]">{presetTitle(preset.name)}</span>
        </div>
      )}
      {preset.isNew && <span className="absolute end-3 top-3 rounded-full bg-vx-base/80 px-2 py-0.5 font-vx-mono text-[10px] font-bold tracking-[0.12em]">{t('mobile.new')}</span>}
    </MediaTile>
  );
}

