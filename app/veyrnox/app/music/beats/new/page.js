import { notFound } from 'next/navigation';
import { musicBeatCloudEnabled, musicBeatEditorEnabled } from '../../../../../../lib/musicBackend.js';
import BeatSongSeed from '../../../../_components/music/beat/BeatSongSeed';
export function generateMetadata() { return { title: 'Open song in Beats' }; }
export default async function NewBeatPage({ searchParams }) {
  if (!musicBeatEditorEnabled()) notFound();
  const { song } = await searchParams;
  return <BeatSongSeed key={typeof song === 'string' ? song : ''} songId={typeof song === 'string' ? song : ''} cloud={musicBeatCloudEnabled()} />;
}
