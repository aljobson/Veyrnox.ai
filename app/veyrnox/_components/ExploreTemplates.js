'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { PresetGallery } from './PresetGallery';
import { createTemplatesFor } from '../_lib/createTemplates.js';
import { useCatalog } from '../_lib/useCatalog';
import { presetCredits } from '../_lib/tokens.js';
import { pluralKey } from '../../../lib/i18n/translate.mjs';

// Explore's template area, the same type filter the mobile Explore tab has: All, Image, Video, Audio.
// Audio lists the licensed Music templates and links to Music Discover and Instruments.
const TYPES = ['all', 'image', 'video', 'audio'];
const AUDIO_LINKS = [
  { href: '/app/music/discover', name: 'Discover' },
  { href: '/app/music/instruments', name: 'Instruments' },
  { href: '/app/music/sounds', name: 'Sounds' },
];

export function ExploreTemplates({ taste }) {
  const { t, locale } = useI18n();
  const { models } = useCatalog();
  const [type, setType] = useState('all');
  const audio = createTemplatesFor('audio');
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
          <ul className="grid gap-4 sm:grid-cols-3">
            {audio.map((tpl) => {
              const credits = presetCredits(tpl, models);
              return (
              <li key={tpl.id} className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
                <div className="aspect-[4/3]" style={{ background: tpl.bg }}>
                  <img src={tpl.previewImage} alt={tpl.name} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-black">{tpl.name}</h3>
                  <audio controls preload="none" src={tpl.previewAudio} aria-label={tpl.previewTitle} className="mt-2 h-10 w-full" />
                  <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">{t('musicDiscover.lic.template.note')}</p>
                  <Link href="/app/music/create" className="vx-press mt-3 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">{Number.isFinite(credits) ? t(pluralKey(t, locale, 'model.credits', credits), { n: credits }) : t('app.create.templates.title')}</Link>
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <PresetGallery key={type} size="md" columns="lg:columns-4" taste={taste} kind={type === 'all' ? null : type} />
      )}
    </>
  );
}
