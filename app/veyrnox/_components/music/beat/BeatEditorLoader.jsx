'use client';
import dynamic from 'next/dynamic';
const BeatEditor = dynamic(() => import('./BeatEditor'), { ssr: false, loading: () => <p aria-busy="true">Loading beat…</p> });
export function BeatEditorLoader({ id }) { return <BeatEditor key={id} id={id} />; }
