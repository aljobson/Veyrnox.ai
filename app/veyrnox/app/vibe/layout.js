import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
export async function generateMetadata() {
  const { t } = await getT();
  return { title: tOr(t, 'app.vibe.page.title', 'Vibe check'), robots: { index: false, follow: false } };
}
export default function Layout({ children }) { return children; }
