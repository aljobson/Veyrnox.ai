import { OPEN_GRAPH_BASE } from '../../seo';
import { pageAlternates, openGraphLocale } from '../../../lib/i18n/metadata.mjs';
import { getT } from '../../../lib/i18n/server';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { SocialCinema } from './SocialCinema';

export async function generateMetadata() {
  const { locale, t } = await getT();
  const alternates = pageAlternates(locale, '/social-cinema');
  const title = t("label.Social Cinema");
  const description = t("cinema.page.aNewHomeForEpisodicStories");
  return { title, description, alternates, openGraph: { ...OPEN_GRAPH_BASE, title, description, url: alternates.canonical, ...openGraphLocale(locale) } };
}

export default function Page() {
  return <><MarketingNav /><Main><SocialCinema /></Main></>;
}
