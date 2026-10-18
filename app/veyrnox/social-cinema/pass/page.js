import { OPEN_GRAPH_BASE } from '../../../seo';
import { pageAlternates, openGraphLocale } from '../../../../lib/i18n/metadata.mjs';
import { getT } from '../../../../lib/i18n/server';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { PassPanel } from './PassPanel';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/social-cinema/pass');
  const title = t('label.Cinema Pass');
  const description = t("cinema.page.watchEveryPublishedSocialCinemaStory");
  return { title, description, alternates, robots: { index: false }, openGraph: { ...OPEN_GRAPH_BASE, title, description, url: alternates.canonical, ...openGraphLocale(locale) } };
}

export default function Page() {
  return <><MarketingNav /><Main><PassPanel /></Main></>;
}
