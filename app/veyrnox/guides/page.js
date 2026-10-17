import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { GUIDES } from '../_lib/guides';
import { OPEN_GRAPH_BASE } from '../../seo';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/guides');
  const description = t('guides.meta.description');
  return {
    title: t('guides.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('guides.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default async function Guides() {
  const { locale, t } = await getT();
  // A guide added without a translation keeps its English words.
  const say = (key, fallback) => t.messages[key] ?? fallback;
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <div className="max-w-[852px]">
        <h1 className="vx-display vx-title-index">{t('guides.title')}</h1>
        <p className="mt-6 mb-10 text-lg text-vx-fg-body max-w-[46ch] leading-[1.5]">{t('guides.lead')}</p>
        <ul className="border-t border-vx-border">
          {GUIDES.map((g) => (
            <li key={g.id} className="border-b border-vx-border">
              <Link href={localizedHref(locale, `/guides/${g.id}`)} className="group block py-5">
                <span className="block text-xl font-black group-hover:underline underline-offset-4">{say(`guide.${g.id}.title`, g.title)}</span>
                <span className="mt-1 block text-[15px] text-vx-fg-muted">{say(`guide.${g.id}.summary`, g.summary)} {t('guides.steps', { n: g.steps.length })}</span>
              </Link>
            </li>
          ))}
        </ul>
        </div>
      </Main>
    </div>
  );
}
