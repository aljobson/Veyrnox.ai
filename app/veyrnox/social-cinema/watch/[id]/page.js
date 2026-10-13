import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Player } from './Player';
import { CinemaComments } from '../../CinemaComments';
import { CinemaVoting } from '../../CinemaVoting';
import { CinemaStoryPolls } from '../../CinemaStoryPolls';
import { editorialEpisodeContext } from '../../editorialSeries';

export const metadata = {
  title: 'Now playing',
  description: 'Watch a Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const titleId = typeof query?.title_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.title_id) ? query.title_id.toLowerCase() : null;
  const seriesSlug = typeof query?.series === 'string' && /^[a-z0-9-]{1,80}$/.test(query.series) ? query.series : null;
  const contentId = String(id || '').toLowerCase();
  const external = editorialEpisodeContext(seriesSlug, contentId)?.episode?.playback?.provider;
  return <><MarketingNav /><Main><Player id={contentId} titleId={titleId} seriesSlug={seriesSlug} />{!external && <div className="mx-auto max-w-4xl px-4 pb-12"><CinemaVoting contentId={contentId} /><CinemaStoryPolls contentId={contentId} /><CinemaComments contentId={contentId} /></div>}</Main></>;
}
