'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { VibeCheck } from '../../_components/VibeCheck';

function VibePage() {
  const retake = useSearchParams().get('retake') === '1';
  return <VibeCheck retake={retake} />;
}

export default function Vibe() {
  return <><AppNav /><Main className="mx-auto max-w-[640px] px-4 py-10 sm:px-8"><Suspense><VibePage /></Suspense></Main></>;
}
