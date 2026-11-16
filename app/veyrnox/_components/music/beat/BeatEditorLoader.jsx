'use client';
import dynamic from 'next/dynamic';
const BeatEditor = dynamic(() => import('./BeatEditor'), { ssr: false, loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" /> });
export function BeatEditorLoader({ id, magicBar = false, cloud = false, librarySave = false }) { return <BeatEditor key={id} id={id} magicBar={magicBar} cloud={cloud} librarySave={librarySave} />; }
