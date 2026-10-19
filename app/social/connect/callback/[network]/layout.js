import { getLocale, getSitePath } from '../../../../../lib/i18n/server';
import { pageAlternates } from '../../../../../lib/i18n/metadata.mjs';
import { notFound } from 'next/navigation';
import { publishShellAvailable } from '../../../../../lib/social/publishFeature.js';

export default function Layout({ children }) {
    if (!publishShellAvailable()) notFound();
    return children;
}

export async function generateMetadata() {
    return { alternates: pageAlternates(await getLocale(), await getSitePath()), robots: { index: false, follow: false } };
}
