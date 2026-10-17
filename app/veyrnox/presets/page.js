import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';
import { getT } from '../../../lib/i18n/server';

// Public preset gallery. No card, no cost until you generate.
export default async function Gallery() {
  const { t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <h1 className="vx-display vx-title-index max-w-[12ch]">
          {t('presets.title')}
        </h1>
        <p className="mt-6 mb-10 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          {t('presets.lead')}
        </p>
        <PresetGallery />
      </Main>
    </div>
  );
}
