import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
// Metadata for the Create route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../../seo';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.create.title', 'Create');
  const description = tOr(t, 'app.meta.create.description', 'Pick a model, see the exact credit cost on the button, and generate. Failed jobs refund automatically.');
  return {
    title,
    description,
    alternates: { canonical: '/app/create' },
    openGraph: { ...OPEN_GRAPH_BASE, title: `${title} — Veyrnox.ai`, description, url: '/app/create' },
  };
}

export default function Layout({ children }) {
  return children;
}
