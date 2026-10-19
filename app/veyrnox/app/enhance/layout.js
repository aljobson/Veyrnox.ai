import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.enhance.title', 'Video Enhance preview');
  return {
    title,
    robots: { index: false, follow: false },
  };
}
export default function Layout({ children }) { return children; }
