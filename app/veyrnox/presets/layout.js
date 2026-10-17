// Metadata for the Presets route — the page itself is a client component,
// so it cannot export it. Language comes from the request (ADR-0107).
import { OPEN_GRAPH_BASE } from '../../seo';
import { getT } from '../../../lib/i18n/server';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/presets');
  const description = t('presets.meta.description');
  return {
    title: t('presets.meta.title'),
    description,
    alternates,
    openGraph: { ...OPEN_GRAPH_BASE, title: t('presets.meta.ogTitle'), description, url: alternates.canonical, ...openGraphLocale(locale) },
  };
}

export default function Layout({ children }) {
  return children;
}
