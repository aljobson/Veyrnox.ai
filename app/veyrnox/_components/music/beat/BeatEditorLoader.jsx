'use client';
import dynamic from 'next/dynamic';
const BeatEditor = dynamic(() => import('./BeatEditor'), { ssr: false, loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" /> });
export function BeatEditorLoader({ ai, id, magicBar = false, studioChat = false, v5Writes = false, cloud = false, librarySave = false }) { return <BeatEditor v5Writes={v5Writes} ai={ai} key={id} id={id} magicBar={magicBar} studioChat={studioChat} cloud={cloud} librarySave={librarySave} />; }
