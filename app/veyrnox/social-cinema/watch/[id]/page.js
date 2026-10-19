import { OPEN_GRAPH_BASE } from '../../../../seo';
import { pageAlternates, openGraphLocale } from '../../../../../lib/i18n/metadata.mjs';
import { getT } from '../../../../../lib/i18n/server';
import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Player } from './Player';
import { CinemaComments } from '../../CinemaComments';
import { CinemaVoting } from '../../CinemaVoting';
import { CinemaStoryPolls } from '../../CinemaStoryPolls';
import { editorialEpisodeContext } from '../../editorialSeries';

export async function generateMetadata({ params }) {
  const { locale, t } = await getT();
  const { id } = await params;
  const alternates = pageAlternates(locale, `/social-cinema/watch/${encodeURIComponent(id)}`);
  const title = t("cinema.player.nowPlaying");
  const description = t("cinema.page.watchASocialCinemaStoryOn");
  return { title, description, alternates, robots: { index: false }, openGraph: { ...OPEN_GRAPH_BASE, title, description, url: alternates.canonical, ...openGraphLocale(locale) } };
}

export default async function Page({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const titleId = typeof query?.title_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.title_id) ? query.title_id.toLowerCase() : null;
  const seriesSlug = typeof query?.series === 'string' && /^[a-z0-9-]{1,80}$/.test(query.series) ? query.series : null;
  const contentId = String(id || '').toLowerCase();
  const external = editorialEpisodeContext(seriesSlug, contentId)?.episode?.playback?.provider;
  return <><MarketingNav /><Main><Player id={contentId} titleId={titleId} seriesSlug={seriesSlug} />{!external && <div className="mx-auto max-w-4xl px-4 pb-12"><CinemaVoting contentId={contentId} /><CinemaStoryPolls contentId={contentId} /><CinemaComments contentId={contentId} /></div>}</Main></>;
}
