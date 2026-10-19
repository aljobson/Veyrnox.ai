'use client';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';


import { useState } from 'react';
import { OddlingGalleryPreview, useGalleryMotionAllowed } from './OddlingGalleryPreview';
import { OddlingExploreFilters } from './OddlingExploreFilters';
import { CharacterPortrait } from './OddlingPortrait';
import { chip } from './oddlingStyles';
import {
  ODDLING_EXPLORE_DEFAULT_SOURCE,
  exploreCharacters,
  heroCharacters,
  reconcileKindFilter,
  toggleKindFilter,
} from '../_lib/oddlingExplore';

/** Explore's own state, kept by the studio so it survives a trip to History. */
export function useOddlingExplore() {
  const [source, setSource] = useState(ODDLING_EXPLORE_DEFAULT_SOURCE);
  const [kind, setKind] = useState('');
  const [previewsPlaying, setPreviewsPlaying] = useState(true);
  return {
    source,
    kind,
    previewsPlaying,
    selectSource(id) { setSource(id); setKind((current) => reconcileKindFilter(id, current)); },
    selectKind(id) { setKind((current) => toggleKindFilter(current, id)); },
    togglePreviews() { setPreviewsPlaying((current) => !current); },
  };
}

// Still first-party portraits: nothing here moves on its own, so there is
// nothing for reduced-motion to switch off beyond the hover lift, which is motion-safe.
function OddlingHeroStrip({ onSheet }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("app.oddlings.explore.featured")} className="mt-8">
      <p className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-fg-faint">{t("app.oddlings.explore.cast")}</p>
      <ul className="mt-3 grid max-w-3xl grid-cols-3 gap-2 sm:grid-cols-5">
        {heroCharacters().map((oddling, index) => (
          <li key={oddling.id} className={index > 2 ? 'hidden sm:block' : undefined}>
            <button type="button" onClick={() => onSheet(oddling)} aria-label={t('app.oddlings.explore.hero', { name: oddling.name })} className="group block w-full overflow-hidden rounded-xl border border-vx-border bg-vx-panel text-start motion-safe:transition-[border-color,translate] motion-safe:duration-200 hover:border-vx-accent motion-safe:hover:-translate-y-0.5 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
              <span className="block aspect-[2/3] bg-vx-base"><CharacterPortrait oddling={oddling} sizes="(max-width: 640px) 30vw, 140px" /></span>
              <span className="block truncate px-2 py-1.5 font-vx-mono text-[9px] font-bold text-vx-fg-muted group-hover:text-vx-fg">{oddling.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The card holds other buttons, so it cannot itself be one. A button stretched
// over the whole card opens the sheet; Recreate and Animate sit above it.
// The card clips its preview (overflow-hidden), and an outline drawn outside the
// button's box would be clipped with it, so the focus ring is drawn inside.
function GalleryCard({ oddling, onSheet, onRecreate, onAnimate, previewsPlaying }) {
  const { t } = useI18n();
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-vx-border bg-vx-panel transition-colors hover:border-vx-accent/50">
      <OddlingGalleryPreview id={oddling.id} playing={previewsPlaying}>
        <CharacterPortrait oddling={oddling} />
      </OddlingGalleryPreview>
      <div className="p-4">
        <span className="font-vx-mono text-[8px] font-bold tracking-[0.14em] text-vx-accent">{oddling.accent}</span>
        <h3 className="mt-1 text-lg font-extrabold">{oddling.name}</h3>
        <p className="mt-1 min-h-10 text-xs leading-relaxed text-vx-fg-muted">{oddling.hook}</p>
        <button type="button" onClick={() => onSheet(oddling)} aria-label={t('app.oddlings.explore.card', { name: oddling.name })} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-solid focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-vx-accent" />
        <div className="relative z-20 mt-4">
          <button type="button" onClick={() => onRecreate(oddling)} className={`${chip(true)} w-full`}>{t("oddlings.recreate")}</button>
          <button type="button" onClick={() => onAnimate(oddling)} className={`${chip(true)} mt-2 w-full`}>{t("oddlings.detail.animateThis")}</button>
        </div>
      </div>
    </article>
  );
}

export function OddlingExplore({ explore, onSheet, onRecreate, onAnimate }) {
  const { t, locale } = useI18n();
  const motionAllowed = useGalleryMotionAllowed();
  const gallery = exploreCharacters(explore.source, explore.kind);
  const { previewsPlaying } = explore;
  return (
    <>
      <OddlingHeroStrip onSheet={onSheet} />
      <OddlingExploreFilters source={explore.source} kind={explore.kind} onSource={explore.selectSource} onKind={explore.selectKind} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">{t(pluralKey(t, locale, 'app.oddlings.explore.count', gallery.length), { count: locale === 'en' ? gallery.length : gallery.length.toLocaleString(localeTag(locale)) })}</p>
        <button type="button" aria-pressed={previewsPlaying} onClick={explore.togglePreviews} className={chip(previewsPlaying)}>{previewsPlaying ? t("app.oddlings.explore.pause") : t("app.oddlings.explore.play")}</button>
      </div>
      <p className="mt-2 text-xs text-vx-fg-muted">{t("app.oddlings.explore.help")}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {gallery.map((oddling) => <GalleryCard key={oddling.id} oddling={oddling} onSheet={onSheet} onRecreate={onRecreate} onAnimate={onAnimate} previewsPlaying={previewsPlaying && motionAllowed} />)}
      </div>
    </>
  );
}
