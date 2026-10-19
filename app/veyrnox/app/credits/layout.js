import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
// Metadata for the Credits & billing route — the page itself is a client component,
// so it cannot export it.
import { OPEN_GRAPH_BASE } from '../../../seo';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.credits.title', 'Credits & billing');
  const description = tOr(t, 'app.meta.credits.description', 'Your credit balance, free-credit expiry and the ledger rows behind it.');
  return {
    title,
    description,
    alternates: { canonical: '/app/credits' },
    openGraph: { ...OPEN_GRAPH_BASE, title: `${title} — Veyrnox.ai`, description, url: '/app/credits' },
  };
}

export default function Layout({ children }) {
  return children;
}
