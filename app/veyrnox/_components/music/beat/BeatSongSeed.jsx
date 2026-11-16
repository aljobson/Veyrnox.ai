'use client';
import Link from 'next/link';
import { useBeatSongSeed } from './useBeatSongSeed';
import { action, button } from './beatStyles';
export default function BeatSongSeed({ songId, cloud }) {
  const { error, retry } = useBeatSongSeed(songId, cloud);
  return <section className="mx-auto max-w-xl space-y-4 px-4 py-8">
    <h1 className="text-2xl font-bold">Open song in Beats</h1>
    <p role="status">{error || 'Loading your song and preparing a beat…'}</p>
    {!error && <progress aria-label="Loading song" value={0} max={100} className="w-full accent-vx-accent" />}
    {error && <div className="flex flex-wrap gap-3"><button className={action} onClick={retry}>Retry</button><Link className={`${button} inline-flex items-center`} href="/app/music/library">Back to Music</Link></div>}
  </section>;
}
