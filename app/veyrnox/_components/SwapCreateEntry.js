'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useResolvedSwap, TemplateSwapBoundary, TemplateSwapSummary } from './TemplateSwapBoundary.js';
import { SwapComposer } from './SwapComposer.js';
import { SwapTemplatePreview } from './SwapTemplatePreview.js';
import { SwapAttemptStatus } from './SwapAttemptStatus.js';
function Placeholder() { return <div aria-busy="true" className="min-h-96" />; }
function Entry({ id, children }) {
  const resolved = useResolvedSwap();
  return <><SwapAttemptStatus templateId={id} />{resolved?.offer ? <section className="mx-auto max-w-3xl px-4 py-8"><TemplateSwapSummary /><div className="mt-4"><SwapTemplatePreview id={id} /></div><SwapComposer offer={resolved.offer} /></section> : resolved?.loading ? <Placeholder /> : children}</>;
}
function QueryEntry({ children }) {
  const query = useSearchParams();
  const id = query.get('preset') || query.get('template') || query.get('template_id');
  return id ? <TemplateSwapBoundary key={id} id={id}><Entry id={id}>{children}</Entry></TemplateSwapBoundary> : children;
}
export function SwapCreateEntry({ children }) {
  return <Suspense fallback={<Placeholder />}><QueryEntry>{children}</QueryEntry></Suspense>;
}
