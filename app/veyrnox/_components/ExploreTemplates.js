'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { PresetGallery } from './PresetGallery';
import { LICENSED_MUSIC_BASE, LICENSED_MUSIC_TRACKS } from '../../../lib/licensedMusicCatalog.js';
import { licensedTemplateHref } from '../../../lib/licensedTrackTemplates.js';

// Explore's template area, the same type filter the mobile Explore tab has: All, Image, Video, Audio.
// Audio lists the licensed Music templates and links to Music Discover and Instruments.
const AUDIO_BATCH = 24;
const ALL_AUDIO = 'all';
const categoryKey = (category) => `musicDiscover.cat.${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const AUDIO_CATEGORIES = [...new Set(LICENSED_MUSIC_TRACKS.map((track) => track.category))];
const TYPES = ['all', 'image', 'video', 'audio'];
const AUDIO_LINKS = [
  { href: '/app/music/discover', name: 'Discover' },
  { href: '/app/music/instruments', name: 'Instruments' },
  { href: '/app/music/sounds', name: 'Sounds' },
];

export function ExploreTemplates({ taste }) {
  const { t } = useI18n();
  const [type, setType] = useState('all');
  const [category, setCategory] = useState(ALL_AUDIO);
  const [shown, setShown] = useState(AUDIO_BATCH);
  const matching = category === ALL_AUDIO ? LICENSED_MUSIC_TRACKS : LICENSED_MUSIC_TRACKS.filter((track) => track.category === category);
  const audio = matching.slice(0, shown);
  return (
    <>
      <div role="tablist" aria-label={t('templates.kind.label')} className="mb-6 inline-flex flex-wrap rounded-full border border-vx-border p-1">
        {TYPES.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === type} onClick={() => setType(k)}
            className="vx-press inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-bold text-vx-fg-body hover:text-vx-fg aria-selected:bg-vx-accent aria-selected:text-vx-accent-ink">
            {k === 'all' ? t('presets.cat.ALL') : t(`templates.kind.${k}`)}
          </button>
        ))}
      </div>
      {type === 'audio' ? (
        <div data-testid="explore-audio-templates">
          <nav className="mb-6 flex flex-wrap gap-2">
            {AUDIO_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg">{t.label(l.name)}</Link>
            ))}
          </nav>
          <div role="group" aria-label={t('musicDiscover.lic.filter')} className="mb-6 flex flex-wrap gap-2">
            {[ALL_AUDIO, ...AUDIO_CATEGORIES].map((c) => (
              <button key={c} type="button" aria-pressed={c === category} onClick={() => { setCategory(c); setShown(AUDIO_BATCH); }}
                className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-body hover:text-vx-fg aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink">
                {c === ALL_AUDIO ? t('musicDiscover.cat.All') : t(categoryKey(c))}
              </button>
            ))}
          </div>
          <p className="mb-4 text-sm text-vx-fg-muted">{t('musicDiscover.lic.count', { shown: audio.length, matching: matching.length, total: LICENSED_MUSIC_TRACKS.length })}</p>
          <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {audio.map((track) => (
              <li key={track.id} className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
                <div className="aspect-[4/3] bg-vx-base">
                  <img src={`${LICENSED_MUSIC_BASE}${track.artwork}`} alt={track.title} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-black">{track.title}</h3>
                  <p className="text-[11px] text-vx-fg-muted">{t(categoryKey(track.category))}</p>
                  <audio controls preload="none" src={`${LICENSED_MUSIC_BASE}${track.file}`} aria-label={track.title} className="mt-2 h-10 w-full" />
                  <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">{t('musicDiscover.lic.template.note')}</p>
                  <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted"><strong>{t('musicDiscover.lic.credit')}</strong> {track.attribution}{' · '}
                    <a href={track.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t('musicDiscover.lic.source')}</a>{' · '}
                    <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t('musicDiscover.lic.licence')}</a>
                  </p>
                  <Link href={licensedTemplateHref(track.id) || '/app/music/create'} className="vx-press mt-3 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">{t('musicDiscover.lic.useTemplate')}</Link>
                </div>
              </li>
            ))}
          </ul>
          {matching.length > audio.length && (
            <button type="button" onClick={() => setShown((n) => n + AUDIO_BATCH)} className="vx-press mt-6 inline-flex min-h-11 items-center rounded-full border border-vx-border px-6 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg">
              {t('musicDiscover.lic.more', { count: Math.min(AUDIO_BATCH, matching.length - audio.length) })}
            </button>
          )}
        </div>
      ) : (
        <PresetGallery key={type} size="md" columns="lg:columns-4" taste={taste} kind={type === 'all' ? null : type} />
      )}
    </>
  );
}
