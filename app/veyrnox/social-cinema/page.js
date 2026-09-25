import { MarketingNav } from '../_components/NavBar';
import { SocialCinema } from './SocialCinema';

export const metadata = {
  title: 'Social Cinema',
  description: 'A new home for episodic stories and audience participation. Explore what is coming to Veyrnox.ai Social Cinema.',
  alternates: { canonical: '/social-cinema' },
};

export default function Page() {
  return <><MarketingNav /><SocialCinema /></>;
}
