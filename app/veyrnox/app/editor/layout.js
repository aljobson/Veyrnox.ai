import { notFound } from 'next/navigation';

export const metadata = { title: 'Video editor', description: 'Cut, arrange and export a video in your browser.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// ADR-0080: the editor has no server API, so the route itself is what the flag closes. Read per request.
export default function Layout({ children }) {
    if (process.env.EDITOR_TIMELINE_ENABLED !== 'true') notFound();
    return children;
}
