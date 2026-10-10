'use client';
import Link from 'next/link';
import { AppNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';

export default function Explore() {
  return (
    <div className="min-h-dvh">
      {/* No balance prop: AppNav reads the signed-in balance itself. This
          used to pass a hardcoded 823, so the pill showed a number that
          belonged to nobody. */}
      <AppNav active="explore" />
      <Main className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-16">
        <h1 className="vx-display text-[40px] sm:text-[56px]">Explore presets</h1>
        <p className="mt-3 mb-8 text-vx-fg-body max-w-[52ch] leading-[1.6]">
          Each one opens the studio on its model and prompt, priced before you press Generate.
        </p>
        <Link href="/app/chat" className="mb-8 flex flex-col gap-1 rounded-2xl border border-vx-border bg-vx-panel p-5 transition-colors hover:border-vx-accent sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-lg font-semibold">LLM Chat</span>
            <span className="block text-vx-fg-body">Ask leading AI models, with Web search if you want it. Every reply shows its price in Credits before you send.</span>
          </span>
          <span aria-hidden="true" className="font-semibold text-vx-accent">Open chat →</span>
        </Link>
        <PresetGallery size="md" columns="lg:columns-4" />
      </Main>
    </div>
  );
}
