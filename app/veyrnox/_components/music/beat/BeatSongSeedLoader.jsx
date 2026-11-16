'use client';
import dynamic from 'next/dynamic';
const BeatSongSeed = dynamic(() => import('./BeatSongSeed'), { ssr: false, loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" /> });
export function BeatSongSeedLoader({ songId, cloud = false }) { return <BeatSongSeed key={songId} songId={songId} cloud={cloud} />; }
