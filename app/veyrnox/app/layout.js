import { tOr } from '../../../lib/i18n/translate.mjs';
import { getT } from '../../../lib/i18n/server';
// ADR-0060: framework scripts must use this request's nonce, never cached HTML.
export const dynamic = 'force-dynamic';

// Metadata for /app (Explore). Child routes — create, library, credits,
// admin — override the title from their own layouts.
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.explore.title', 'Explore');
  const description = tOr(t, 'app.meta.explore.description', 'Browse curated presets pinned to their best-fit model, each priced up front. Open one to generate on your credit balance.');
  return {
    // The default uses the root template; descendants inherit this same suffix.
    title: { default: title, template: '%s — Veyrnox.ai' },
    description,
    alternates: { canonical: '/app' },
  };
}

export default function Layout({ children }) {
  return children;
}
