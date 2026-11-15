'use client';
import dynamic from 'next/dynamic';
const BeatsHome = dynamic(() => import('./BeatsHome'), { ssr: false, loading: () => <p aria-busy="true">Loading beats…</p> });
export function BeatsHomeLoader() { return <BeatsHome />; }
