import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.facelessReel.title', 'Faceless Reel');
  const description = tOr(t, 'app.meta.facelessReel.description', 'Plan an original presenter-free short and optionally continue a five-second result into generated sound.');
  return {
    title,
    description,
    alternates: { canonical: '/app/faceless-reel' },
    robots: { index: false, follow: false },
  };
}

export default function FacelessReelLayout({ children }) {
  return children;
}
