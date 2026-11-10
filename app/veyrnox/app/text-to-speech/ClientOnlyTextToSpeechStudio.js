'use client';

import dynamic from 'next/dynamic';

const TextToSpeechStudio = dynamic(() => import('./TextToSpeechStudioClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-vx-bg" aria-busy="true" />,
});

export function ClientOnlyTextToSpeechStudio() {
  return <TextToSpeechStudio />;
}
