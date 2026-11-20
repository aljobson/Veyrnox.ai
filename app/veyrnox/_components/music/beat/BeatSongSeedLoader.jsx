'use client';
import { useLayoutEffect } from 'react';
import { configureBeatWrites } from '../../../_lib/music/beat/beatWriteVersion.mjs';
import dynamic from 'next/dynamic';
const BeatSongSeed = dynamic(() => import('./BeatSongSeed'), { ssr: false, loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" /> });
export function BeatSongSeedLoader({ songId, v5Writes = false, cloud = false }) { useLayoutEffect(() => { configureBeatWrites(v5Writes); }, [v5Writes]); return <BeatSongSeed key={songId} songId={songId} cloud={cloud} />; }
