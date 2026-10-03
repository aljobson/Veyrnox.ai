import { notFound } from 'next/navigation';
import { publishEnabled } from '../../../../lib/social/publishFeature.js';

// While Publish is off the page 404s, so it must not name itself in the title.
export function generateMetadata() {
    return publishEnabled()
        ? { title: 'Veyrnox Publish', robots: { index: false, follow: false } }
        : { robots: { index: false, follow: false } };
}

export default function Layout({ children }) {
    if (!publishEnabled()) notFound();
    return children;
}
