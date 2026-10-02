'use client';
import { AppNav } from '../_components/NavBar';
import { PresetGallery } from '../_components/PresetGallery';

export default function Explore() {
  return (
    <div className="min-h-dvh">
      {/* No balance prop: AppNav reads the signed-in balance itself. This
          used to pass a hardcoded 823, so the pill showed a number that
          belonged to nobody. */}
      <AppNav active="explore" />
      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-16">
        <h1 className="vx-display text-[40px] sm:text-[56px]">Explore presets</h1>
        <p className="mt-3 mb-8 text-vx-fg-body max-w-[52ch] leading-[1.6]">
          Each one opens the studio on its model and prompt, priced before you press Generate.
        </p>
        <PresetGallery size="md" columns="lg:grid-cols-4" />
      </section>
    </div>
  );
}
