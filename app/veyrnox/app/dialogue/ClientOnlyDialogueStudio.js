'use client';

import dynamic from 'next/dynamic';

const DialogueStudio = dynamic(() => import('./DialogueStudioClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-vx-bg" aria-busy="true" />,
});

export function ClientOnlyDialogueStudio() {
  return <DialogueStudio />;
}
