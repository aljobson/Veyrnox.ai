import { notFound } from 'next/navigation';
import { publishShellAvailable } from '../../../../../lib/social/publishFeature.js';

export default function Layout({ children }) {
    if (!publishShellAvailable()) notFound();
    return children;
}
