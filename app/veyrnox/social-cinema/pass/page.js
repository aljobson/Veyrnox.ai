import { MarketingNav } from '../../_components/NavBar';
import { PassPanel } from './PassPanel';

export const metadata = {
  title: 'Cinema Pass',
  description: 'Watch every published Social Cinema story with one recurring Cinema Pass.',
  alternates: { canonical: '/social-cinema/pass' },
  robots: { index: false },
};

export default function Page() {
  return <><MarketingNav /><PassPanel /></>;
}
