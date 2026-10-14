import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';

// Public preset gallery. No card, no cost until you generate.
export default function Gallery() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">
          One-tap looks. Exact prices.
        </h1>
        <p className="mt-6 mb-10 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Ready-made looks with editable prompts, high-quality previews and exact prices. Generate a 5s or 10s shot directly, or carry any template into Film Studio for a 30–120s multi-shot film. Nothing is charged until you generate.
        </p>
        <PresetGallery />
      </Main>
    </div>
  );
}
