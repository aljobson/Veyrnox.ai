'use client';

import { useRef } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { PresetCard } from './PresetCard';
import styles from './TemplateRoller.module.css';

// A compact two-row collage for scanning real previews quickly. The full card
// layout remains immediately below it; this is an additional browsing path.
export function TemplateRoller({ presets, catalog, className = '' }) {
  const { t } = useI18n();
  const trackRef = useRef(null);
  if (!presets?.length) return null;

  const move = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(280, track.clientWidth * 0.78) });
  };

  return (
    <section className={className} aria-labelledby="template-roller-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="template-roller-title" className="text-[15px] font-bold tracking-tight">{t('presets.quick.title')}</h2>
          <p className="mt-1 text-sm text-vx-fg-muted">{t('presets.quick.hint')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => move(-1)} aria-label={t('presets.quick.previous')} className="vx-press inline-flex h-11 w-11 items-center justify-center rounded-full border border-vx-border text-lg text-vx-fg-body hover:border-vx-accent hover:text-vx-fg">←</button>
          <button type="button" onClick={() => move(1)} aria-label={t('presets.quick.next')} className="vx-press inline-flex h-11 w-11 items-center justify-center rounded-full border border-vx-border text-lg text-vx-fg-body hover:border-vx-accent hover:text-vx-fg">→</button>
        </div>
      </div>
      <div
        ref={trackRef}
        data-testid="template-roller"
        role="region"
        aria-label={t('presets.quick.title')}
        className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      >
        <div className="grid h-[220px] w-max auto-cols-[8rem] grid-flow-col-dense grid-rows-2 gap-2 sm:h-[252px] sm:auto-cols-[9rem]">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              catalog={catalog}
              size="sm"
              variant="roller"
              className={styles.card}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
