import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.account.title', 'Account & security');
  return {
    title,
    robots: { index: false, follow: false },
  };
}
export default function Layout({ children }) { return children; }
