import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Player } from './Player';
import { CinemaComments } from '../../CinemaComments';
import { CinemaVoting } from '../../CinemaVoting';

export const metadata = {
  title: 'Now playing',
  description: 'Watch a Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params }) {
  const { id } = await params;
  return <><MarketingNav /><Main><Player id={String(id || '').toLowerCase()} /><div className="mx-auto max-w-4xl px-4 pb-12"><CinemaVoting contentId={String(id || '').toLowerCase()} /><CinemaComments contentId={String(id || '').toLowerCase()} /></div></Main></>;
}
