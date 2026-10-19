import { getT } from '../../../../lib/i18n/server';
import { editorFeatureEnabled } from '../../../../lib/editorRuntimeFlags.mjs';
import { SharedToolsFlagProvider } from '../../_components/editor/SharedToolsFlag';
import { MultitrackFlagProvider } from '../../_components/editor/MultitrackFlag';
import { CompletionFlagsProvider } from '../../_components/editor/CompletionFlags';
import { notFound } from 'next/navigation';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('label.Video editor'), description: t('app.editor.meta.description'), robots: { index: false, follow: false } };
}
export const dynamic = 'force-dynamic';

// ADR-0080: the editor has no server API, so the route itself is what the flag closes. Read per request.
export default function Layout({ children }) {
    if (process.env.EDITOR_TIMELINE_ENABLED !== 'true') notFound();
    return <MultitrackFlagProvider enabled={process.env.EDITOR_MULTITRACK_ENABLED === 'true'}><SharedToolsFlagProvider enabled={process.env.EDITOR_SHARED_TOOLS_ENABLED==='true'}><CompletionFlagsProvider localInference={editorFeatureEnabled('EDITOR_LOCAL_INFERENCE_ENABLED')} organization={editorFeatureEnabled('EDITOR_ORGANIZATION_ENABLED')} scenes={editorFeatureEnabled('EDITOR_SCENES_ENABLED')} clipper={editorFeatureEnabled('EDITOR_CLIPPER_ENABLED')} agent={editorFeatureEnabled('EDITOR_AGENT_ENABLED')}>{children}</CompletionFlagsProvider></SharedToolsFlagProvider></MultitrackFlagProvider>;
}
