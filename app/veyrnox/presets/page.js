import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';
import { AudioTemplateGallery } from '../_components/AudioTemplateGallery';
import { getT } from '../../../lib/i18n/server';
import { templateCards, templateCategories } from '../../../lib/clientTemplates.js';

// Public preset gallery. No card, no cost until you generate.
export default async function Gallery({ searchParams }) {
  const { locale, t } = await getT();
  const { kind, category } = await searchParams;
  // ?kind=audio lists the audio templates; everything else is the video gallery.
  if (kind === 'audio') {
    return (
      <div className="min-h-dvh">
        <MarketingNav />
        <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
          <AudioTemplateGallery t={t} locale={locale} category={category} />
        </Main>
      </div>
    );
  }
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
        <Link href="/presets?kind=audio" className="mb-8 inline-flex text-[14px] font-semibold text-vx-accent underline-offset-4 hover:underline">{t('audioTemplates.title')}</Link>
        <PresetGallery initial={{ templates: templateCards(), categories: templateCategories() }} />
      </Main>
    </div>
  );
}
