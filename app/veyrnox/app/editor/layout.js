import { SharedToolsFlagProvider } from '../../_components/editor/SharedToolsFlag';
import { MultitrackFlagProvider } from '../../_components/editor/MultitrackFlag';
import { CompletionFlagsProvider } from '../../_components/editor/CompletionFlags';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Video editor', description: 'Cut, arrange and export a video in your browser.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// ADR-0080: the editor has no server API, so the route itself is what the flag closes. Read per request.
export default function Layout({ children }) {
    if (process.env.EDITOR_TIMELINE_ENABLED !== 'true') notFound();
    return <MultitrackFlagProvider enabled={process.env.EDITOR_MULTITRACK_ENABLED === 'true'}><SharedToolsFlagProvider enabled={process.env.EDITOR_SHARED_TOOLS_ENABLED==='true'}><CompletionFlagsProvider localInference={process.env.EDITOR_LOCAL_INFERENCE_ENABLED==='true'} organization={process.env.EDITOR_ORGANIZATION_ENABLED==='true'}>{children}</CompletionFlagsProvider></SharedToolsFlagProvider></MultitrackFlagProvider>;
}
