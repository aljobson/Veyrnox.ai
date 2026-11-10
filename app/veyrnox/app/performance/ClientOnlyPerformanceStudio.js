'use client';

import dynamic from 'next/dynamic';

const PerformanceStudio = dynamic(() => import('./PerformanceStudioClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-vx-bg" aria-busy="true" />,
});

export function ClientOnlyPerformanceStudio() {
  return <PerformanceStudio />;
}
