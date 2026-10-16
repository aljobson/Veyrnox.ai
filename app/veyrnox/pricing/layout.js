// Metadata for the Pricing route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../seo';

export const metadata = {
  title: 'Pricing',
  description:
    'Every model on the Veyrnox catalog with its exact credit price. One balance, no tiers, no add-ons — and 10 free credits on sign-up.',
  alternates: { canonical: '/pricing' },
  openGraph: { ...OPEN_GRAPH_BASE, title: 'Pricing — Veyrnox.ai', description: 'Every model on the Veyrnox catalog with its exact credit price. One balance, no tiers, no add-ons — and 10 free credits on sign-up.', url: '/pricing' },
};

export default function Layout({ children }) {
  return children;
}
