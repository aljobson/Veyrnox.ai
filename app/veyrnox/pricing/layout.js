// Metadata for the Pricing route — the page itself is a client component,
// so it cannot export it. Language comes from the request (ADR-0107).
import { OG_IMAGE, OPEN_GRAPH_BASE } from '../../seo';
import { getT } from '../../../lib/i18n/server';
import { LOCALES, languageAlternates, localeInfo, localesEnabled } from '../../../lib/i18n/locales.mjs';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const path = locale === 'en' ? '/pricing' : `/${locale}/pricing`;
  const description = t('pricing.meta.description');
  return {
    title: t('pricing.meta.title'),
    description,
    alternates: {
      canonical: path,
      ...(localesEnabled() ? { languages: languageAlternates('/pricing') } : {}),
    },
    openGraph: { ...OPEN_GRAPH_BASE, title: t('pricing.meta.ogTitle'), description, url: path,
      ...(localesEnabled() ? { locale: localeInfo(locale).og, alternateLocale: LOCALES.filter((l) => l.code !== locale).map((l) => l.og) } : {}) },
    twitter: { card: 'summary_large_image', title: t('pricing.meta.ogTitle'), description, images: [OG_IMAGE.url] },
  };
}

export default function Layout({ children }) {
  return children;
}
