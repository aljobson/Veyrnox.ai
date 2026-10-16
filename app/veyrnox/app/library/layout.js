// Metadata for the Library route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../../seo';

export const metadata = {
  title: 'Library',
  description:
    'Every generation you have run — successes, failures and the refunds that followed.',
  alternates: { canonical: '/app/library' },
  openGraph: { ...OPEN_GRAPH_BASE, title: 'Library — Veyrnox.ai', description: 'Every generation you have run — successes, failures and the refunds that followed.', url: '/app/library' },
};

export default function Layout({ children }) {
  return children;
}
