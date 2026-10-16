// Metadata for the Create route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../../seo';

export const metadata = {
  title: 'Create',
  description:
    'Pick a model, see the exact credit cost on the button, and generate. Failed jobs refund automatically.',
  alternates: { canonical: '/app/create' },
  openGraph: { ...OPEN_GRAPH_BASE, title: 'Create — Veyrnox.ai', description: 'Pick a model, see the exact credit cost on the button, and generate. Failed jobs refund automatically.', url: '/app/create' },
};

export default function Layout({ children }) {
  return children;
}
