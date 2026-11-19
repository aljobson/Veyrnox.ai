import { notFound } from 'next/navigation';
import { musicBeatV5WritesEnabled, musicBeatCloudEnabled, musicBeatEditorEnabled } from '../../../../../../lib/musicBackend.js';
import { BeatSongSeedLoader } from '../../../../_components/music/beat/BeatSongSeedLoader';
import { getT } from '../../../../../../lib/i18n/server';
export async function generateMetadata() { const { t } = await getT(); return { title: t('music.beats.seed.title') }; }
export default async function NewBeatPage({ searchParams }) {
  if (!musicBeatEditorEnabled()) notFound();
  const { song } = await searchParams;
  return <BeatSongSeedLoader v5Writes={musicBeatV5WritesEnabled()} songId={typeof song === 'string' ? song : ''} cloud={musicBeatCloudEnabled()} />;
}
