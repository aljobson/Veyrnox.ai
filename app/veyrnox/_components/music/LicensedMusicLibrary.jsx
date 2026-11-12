'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { LICENSED_MUSIC_CATEGORIES, LICENSED_MUSIC_TRACKS, licensedArtworkUrl, licensedMusicUrl } from '../../../../lib/licensedMusicCatalog.js';

const duration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const PAGE_SIZE = 12;
const categoryKey = (category) => `musicDiscover.cat.${category === 'All' ? 'All' : category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

function LicensedTrackCard({ track }) {
  const { t } = useI18n();
  const audioUrl = licensedMusicUrl(track);
  return (
    <article className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-xl">
      <div className="relative aspect-square overflow-hidden bg-vx-panel-raised">
        <Image src={licensedArtworkUrl(track)} alt={t('musicDiscover.lic.artwork', { title: track.title })} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" className="object-cover" />
        <span className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1 font-vx-mono text-[10px] font-bold uppercase tracking-wide text-white">{tOr(t, categoryKey(track.category), track.category)}</span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><h3 className="font-vx text-xl font-black">{track.title}</h3><p className="mt-1 text-sm text-vx-fg-muted">{track.creator}</p></div>
          <span className="shrink-0 rounded-full border border-vx-accent/40 px-2.5 py-1 text-xs font-bold text-vx-accent">{track.license}</span>
        </div>
        <p className="mt-3 text-xs text-vx-fg-muted">{t('musicDiscover.lic.meta', { duration: duration(track.durationSec) })}</p>
        <audio controls preload="none" src={audioUrl} aria-label={t('musicDiscover.lic.play', { title: track.title, creator: track.creator })} className="mt-4 h-10 w-full" />
        <p className="mt-4 rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5 text-vx-fg-body"><strong>{t('musicDiscover.lic.credit')}</strong> {track.attribution}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
          <a href={audioUrl} download className="inline-flex min-h-11 items-center text-vx-accent underline underline-offset-2">{t('musicDiscover.lic.download')}</a>
          <a href={track.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-vx-fg-muted underline underline-offset-2">{t('musicDiscover.lic.source')}</a>
          <a href={track.downloadSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-vx-fg-muted underline underline-offset-2">{t('musicDiscover.lic.creatorDownload')}</a>
          <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-vx-fg-muted underline underline-offset-2">{t('musicDiscover.lic.licence')}</a>
        </div>
      </div>
    </article>
  );
}

export function LicensedMusicLibrary() {
  const { t } = useI18n();
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return LICENSED_MUSIC_TRACKS.filter((track) => (category === 'All' || track.category === category)
      && (!query || [track.title, track.creator, track.category].some((value) => value.toLowerCase().includes(query))));
  }, [category, search]);
  const displayed = visible.slice(0, visibleLimit);
  const updateCategory = (nextCategory) => {
    setCategory(nextCategory);
    setVisibleLimit(PAGE_SIZE);
  };
  const updateSearch = (event) => {
    setSearch(event.target.value);
    setVisibleLimit(PAGE_SIZE);
  };
  const resetFilters = () => {
    setCategory('All');
    setSearch('');
    setVisibleLimit(PAGE_SIZE);
  };

  return (
    <section aria-labelledby="licensed-music-title" className="mt-16 border-t border-vx-border pt-12">
      <div className="max-w-3xl">
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('musicDiscover.lic.eyebrow')}</p>
        <h2 id="licensed-music-title" className="mt-2 font-vx text-3xl font-black sm:text-4xl">{t('musicDiscover.lic.title', { count: LICENSED_MUSIC_TRACKS.length })}</h2>
        <p className="mt-3 leading-7 text-vx-fg-body">{t('musicDiscover.lic.lead')}</p>
      </div>
      <div className="mt-6 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label={t('musicDiscover.lic.filter')}>
            {LICENSED_MUSIC_CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => updateCategory(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${category === item ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body hover:border-vx-border-boost'}`}>{tOr(t, categoryKey(item), item)}</button>)}
          </div>
          <label className="relative block lg:w-72"><span className="sr-only">{t('musicDiscover.lic.searchLabel')}</span><input type="search" value={search} onChange={updateSearch} placeholder={t('musicDiscover.lic.searchPlaceholder')} className="min-h-11 w-full rounded-full border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" /></label>
        </div>
      </div>
      <p className="mt-5 text-sm text-vx-fg-muted">{t('musicDiscover.lic.count', { shown: displayed.length, matching: visible.length, total: LICENSED_MUSIC_TRACKS.length })}</p>
      {visible.length ? <>
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{displayed.map((track) => <LicensedTrackCard key={track.id} track={track} />)}</div>
        {displayed.length < visible.length ? <div className="mt-8 text-center"><button type="button" onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)} className="min-h-11 rounded-full border border-vx-border-boost px-5 text-sm font-bold hover:border-vx-accent">{t('musicDiscover.lic.more', { count: Math.min(PAGE_SIZE, visible.length - displayed.length) })}</button></div> : null}
      </>
        : <div className="mt-4 rounded-2xl border border-dashed border-vx-border p-8 text-center"><p className="font-bold">{t('musicDiscover.lic.empty')}</p><button type="button" onClick={resetFilters} className="mt-4 min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">{t('musicDiscover.lic.showAll')}</button></div>}
      <p className="mt-6 text-xs leading-5 text-vx-fg-faint">{t('musicDiscover.lic.note')}</p>
    </section>
  );
}
