import { MarketingNav } from '../../../_components/NavBar';
import { Player } from './Player';

export const metadata = {
  title: 'Now playing',
  description: 'Watch a Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params }) {
  const { id } = await params;
  return <><MarketingNav /><Player id={String(id || '').toLowerCase()} /></>;
}
