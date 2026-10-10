import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Player } from './Player';
import { CinemaComments } from '../../CinemaComments';
import { CinemaVoting } from '../../CinemaVoting';
import { CinemaStoryPolls } from '../../CinemaStoryPolls';

export const metadata = {
  title: 'Now playing',
  description: 'Watch a Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const titleId = typeof query?.title_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.title_id) ? query.title_id.toLowerCase() : null;
  return <><MarketingNav /><Main><Player id={String(id || '').toLowerCase()} titleId={titleId} /><div className="mx-auto max-w-4xl px-4 pb-12"><CinemaVoting contentId={String(id || '').toLowerCase()} /><CinemaStoryPolls contentId={String(id || '').toLowerCase()} /><CinemaComments contentId={String(id || '').toLowerCase()} /></div></Main></>;
}
