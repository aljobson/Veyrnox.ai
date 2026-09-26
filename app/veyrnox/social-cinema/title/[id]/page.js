import { MarketingNav } from '../../../_components/NavBar';
import { TitlePage } from './TitlePage';

export const metadata = {
  title: 'Social Cinema title',
  description: 'Watch a published Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params }) {
  const { id } = await params;
  return <><MarketingNav /><TitlePage id={String(id || '').toLowerCase()} /></>;
}
