import { getLocale, getSitePath } from '../../../../../lib/i18n/server';
import { pageAlternates } from '../../../../../lib/i18n/metadata.mjs';

export async function generateMetadata() {
  return {
    alternates: pageAlternates(await getLocale(), await getSitePath()),
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }) { return children; }
