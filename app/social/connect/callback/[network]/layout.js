import { notFound } from 'next/navigation';
import { publishEnabled } from '../../../../../lib/social/publishFeature.js';

export default function Layout({ children }) {
    if (!publishEnabled()) notFound();
    return children;
}
