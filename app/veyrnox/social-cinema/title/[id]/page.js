import { OPEN_GRAPH_BASE } from '../../../../seo';
import { pageAlternates, openGraphLocale } from '../../../../../lib/i18n/metadata.mjs';
import { getT } from '../../../../../lib/i18n/server';
import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { TitlePage } from './TitlePage';

export async function generateMetadata({ params }) {
  const { locale, t } = await getT();
  const { id } = await params;
  const alternates = pageAlternates(locale, `/social-cinema/title/${encodeURIComponent(id)}`);
  const title = t("cinema.page.socialCinemaTitle");
  const description = t("cinema.page.watchAPublishedSocialCinemaStory");
  return { title, description, alternates, robots: { index: false }, openGraph: { ...OPEN_GRAPH_BASE, title, description, url: alternates.canonical, ...openGraphLocale(locale) } };
}

export default async function Page({ params }) {
  const { id } = await params;
  return <><MarketingNav /><Main><TitlePage id={String(id || '').toLowerCase()} /></Main></>;
}
