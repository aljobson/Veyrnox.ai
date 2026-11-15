'use client';
import dynamic from 'next/dynamic';
const BeatsHome = dynamic(() => import('./BeatsHome'), { ssr: false, loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" /> });
export function BeatsHomeLoader() { return <BeatsHome />; }
