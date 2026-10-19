import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
// Metadata for the Library route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../../seo';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.library.title', 'Library');
  const description = tOr(t, 'app.meta.library.description', 'Every generation you have run — successes, failures and the refunds that followed.');
  return {
    title,
    description,
    alternates: { canonical: '/app/library' },
    openGraph: { ...OPEN_GRAPH_BASE, title: `${title} — Veyrnox.ai`, description, url: '/app/library' },
  };
}

export default function Layout({ children }) {
  return children;
}
