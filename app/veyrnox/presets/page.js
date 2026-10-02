import { MarketingNav } from '../_components/NavBar';
import { PresetGallery } from '../_components/PresetGallery';

// Public preset gallery. No card, no cost until you generate.
export default function Gallery() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display text-[52px] sm:text-[80px] lg:text-[104px] max-w-[12ch]">
          One-tap looks. Exact prices.
        </h1>
        <p className="mt-6 mb-10 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Each preset is pinned to the model it suits and shows its credit cost. Nothing is charged until you generate.
        </p>
        <PresetGallery />
      </section>
    </div>
  );
}
