'use client';

import dynamic from 'next/dynamic';

// The instruments surface only runs in the browser (Web Audio, IndexedDB), so keep it out of the
// server render and the Worker bundle, which has a hard size budget (scripts/check-worker-size.mjs).
const MusicInstruments = dynamic(() => import('./MusicInstruments').then((module) => module.MusicInstruments), {
  ssr: false,
  loading: () => <div className="vx-shimmer m-6 h-96 rounded-2xl bg-vx-panel" aria-busy="true" />,
});

export function MusicInstrumentsLoader() {
  return <MusicInstruments />;
}
