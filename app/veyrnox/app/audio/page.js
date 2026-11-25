'use client';

import Link from 'next/link';
import { useI18n } from '../../../../components/I18nProvider';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { useCatalog } from '../../_lib/useCatalog';

// The Audio pillar. Each card opens a studio that already exists; the hub owns no generation logic.
export const AUDIO_STUDIOS = [
  { id: 'sounds', href: '/app/music/sounds', modelIds: ['suno-sounds'] },
  { id: 'speech', href: '/app/text-to-speech', modelIds: ['qwen3-tts'] },
  { id: 'dub', href: '/app/lip-sync', modelIds: ['kling-avatar-v2', 'sync-lipsync-v3', 'latentsync', 'sync-lipsync-1.9-long'] },
];

export default function AudioHubPage() {
  const { t } = useI18n();
  const { models, loading } = useCatalog();
  const modelIds = new Set(models.map((model) => model.id));
  const studios = AUDIO_STUDIOS.filter((studio) => studio.modelIds.some((id) => modelIds.has(id)));
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="audio" />
      <Main className="mx-auto max-w-[1320px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <header className="max-w-4xl">
          <h1 className="vx-display text-[44px] leading-[0.94] sm:text-[68px]">{t('app.audio.title')}</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-vx-fg-muted">{t('app.audio.intro')}</p>
        </header>
        <ul className="mt-12 grid gap-3 sm:grid-cols-2" data-testid="audio-studios">
          {studios.map(({ id, href }) => (
            <li key={id}>
              <Link href={href} className="group flex min-h-11 h-full flex-col rounded-2xl border border-vx-border bg-vx-panel p-5 transition-colors hover:border-vx-accent">
                <h2 className="text-lg font-black group-hover:text-vx-accent">{t(`app.audio.${id}.title`)}</h2>
                <p className="mt-3 text-sm leading-6 text-vx-fg-muted">{t(`app.audio.${id}.blurb`)}</p>
              </Link>
            </li>
          ))}
        </ul>
        {loading && <p role="status" className="mt-4 text-xs text-vx-fg-muted">Checking the live audio catalog…</p>}
      </Main>
    </div>
  );
}
