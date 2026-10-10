import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { TitlePage } from './TitlePage';

export const metadata = {
  title: 'Social Cinema title',
  description: 'Watch a published Social Cinema story on Veyrnox.ai.',
  robots: { index: false },
};

export default async function Page({ params }) {
  const { id } = await params;
  return <><MarketingNav /><Main><TitlePage id={String(id || '').toLowerCase()} /></Main></>;
}
