import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.oddlings.title', 'Oddling Studio');
  const description = tOr(t, 'app.meta.oddlings.description', 'Design an original fictional creator, lock their visual canon and recurring show, then continue to portrait or motion generation.');
  return {
    title,
    description,
    alternates: { canonical: '/app/oddlings' },
  };
}

export default function Layout({ children }) {
  return children;
}
