'use client';

import dynamic from 'next/dynamic';

// The instruments surface only runs in the browser (Web Audio, IndexedDB), so keep it out of the
// server render and the Worker bundle, which has a hard size budget (scripts/check-worker-size.mjs).
const MusicInstruments = dynamic(() => import('./MusicInstruments').then((module) => module.MusicInstruments), {
  ssr: false,
  loading: () => <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-busy="true"><div className="vx-shimmer h-[28rem] rounded-2xl bg-vx-panel" /></div>,
});

export function MusicInstrumentsLoader() {
  return <MusicInstruments />;
}
