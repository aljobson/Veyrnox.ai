'use client';
import Link from 'next/link';
import { useI18n } from '../../../../../components/I18nProvider';
import { useBeatSongSeed } from './useBeatSongSeed';
import { action, button } from './beatStyles';
export default function BeatSongSeed({ songId, cloud }) {
  const { t } = useI18n();
  const { error, retry } = useBeatSongSeed(songId, cloud);
  return <section className="mx-auto max-w-xl space-y-4 px-4 py-8">
    <h1 className="text-2xl font-bold">{t('app.music.beat.seed.title')}</h1>
    <p role="status">{error || t('app.music.beat.seed.preparing')}</p>
    {!error && <progress aria-label={t('app.music.beat.seed.loading')} value={0} max={100} className="w-full accent-vx-accent" />}
    {error && <div className="flex flex-wrap gap-3"><button className={action} onClick={retry}>{t('app.music.beat.seed.retry')}</button><Link className={`${button} inline-flex items-center`} href="/app/music/library">{t('app.music.beat.seed.back')}</Link></div>}
  </section>;
}
