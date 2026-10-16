'use client';
import Link from 'next/link';
import Image from 'next/image';
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
        <Link href="/app/oddlings" className="group mb-4 grid overflow-hidden rounded-2xl border border-vx-border bg-vx-panel transition-colors hover:border-vx-accent lg:grid-cols-[1.15fr_.85fr]">
          <div className="relative min-h-56 overflow-hidden bg-vx-base">
            <Image
              src="/oddlings/oddling-body-chaos.webp"
              width={1600}
              height={800}
              alt="Four fictional human Oddling creators with distinctive silhouettes and costumes"
              loading="eager"
              sizes="(max-width: 1023px) 100vw, 55vw"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/65 via-transparent to-transparent" />
            <span className="absolute bottom-4 left-4 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 font-vx-mono text-[9px] font-bold tracking-[0.14em] text-white backdrop-blur-sm">ORIGINAL FICTIONAL CAST</span>
          </div>
          <span className="flex flex-col justify-center p-6 sm:p-8">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">NEW · ODDLINGS</span>
            <span className="vx-display mt-3 text-[34px] sm:text-[42px]">Make the silhouette impossible to ignore.</span>
            <span className="mt-4 max-w-[38ch] leading-relaxed text-vx-fg-body">Explore expressive silhouettes, sculptural hair and imaginative costumes. Give your fictional creator a distinctive personality, visual style and recurring show.</span>
            <span className="mt-5 font-bold text-vx-accent">Open the full Oddling Studio →</span>
          </span>
        </Link>
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
