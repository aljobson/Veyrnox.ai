// Metadata for the Presets route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../seo';

export const metadata = {
  title: 'Templates',
  description:
    'Curated one-tap looks pinned to their best-fit model, each showing its credit cost before you generate. Browse free, no card.',
  alternates: { canonical: '/presets' },
  openGraph: { ...OPEN_GRAPH_BASE, title: 'Presets — Veyrnox.ai', description: 'Curated one-tap looks pinned to their best-fit model, each showing its credit cost before you generate. Browse free, no card.', url: '/presets' },
};

export default function Layout({ children }) {
  return children;
}
