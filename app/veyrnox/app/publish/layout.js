import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { notFound } from 'next/navigation';
import { publishShellAvailable } from '../../../../lib/social/publishFeature.js';

// While Publish is off the page 404s, so it must not name itself in the title.
export async function generateMetadata() {
  if (!publishShellAvailable()) return { robots: { index: false, follow: false } };
  const { t } = await getT();
  const title = tOr(t, 'app.meta.publish.title', 'Veyrnox.ai Publish');
  return {
    title,
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }) {
    if (!publishShellAvailable()) notFound();
    return children;
}
