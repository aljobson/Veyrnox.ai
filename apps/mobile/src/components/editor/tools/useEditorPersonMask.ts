import { useEffect, useRef, useState } from 'react';
import { captureAndApplyEditorSemanticMask, removeEditorSemanticMask } from '../../../lib/editorNativeMediaActions';
import { EDITOR_PERSON_MASK_CATEGORIES, type EditorPersonMaskCategory } from '../../../lib/editorPersonMask';
import { clipAt, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import { editorSemanticMaskIdentity } from '../../../lib/editorSemanticMaskIdentity';

type Options = { account: string; projectId: string; sourceUri?: string; sourceKey: string; selection: Selection | null; timeline: Timeline;
    commit(timeline: Timeline): boolean; addLocalUri(mediaId: string, uri: string): void };
export type EditorPersonMaskError = 'source' | 'cancelled' | 'stale' | 'unsupported-source' | 'capture-failed' | 'inference-failed' | 'copy-failed' | 'commit-refused' | 'invalid-output';

export function editorPersonMaskSourceSupported(timeline: Timeline, selection: Selection | null, sourceUri?: string) {
    const selected = clipAt(timeline, selection);
    if (selection?.track !== 'video' || !selected || !('mediaId' in selected) || !selected.mediaId || !sourceUri?.startsWith('file:')) return false;
    const media = timeline.media[selected.mediaId];
    return !!media && ['image', 'graphic', 'video'].includes(String(media.kind));
}
export const editorPersonMaskNeedsRegeneration = (previousId: string | undefined, currentId: string | undefined,
    previouslyApplied: boolean, applied: boolean, sourceChanged: boolean, intentionalRemoval: boolean) =>
    !!currentId && previousId === currentId && previouslyApplied && !applied && sourceChanged && !intentionalRemoval;

export function useEditorPersonMask(options: Options) {
    const latest = useRef(options); latest.current = options;
    const selected = clipAt(options.timeline, options.selection), applied = selected && 'semanticMask' in selected ? selected.semanticMask : undefined;
    const sourceIdentity = selected && 'mediaId' in selected ? editorSemanticMaskIdentity(selected) : undefined;
    const [category, setCategory] = useState<EditorPersonMaskCategory>('person'), [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
    const [error, setError] = useState<EditorPersonMaskError | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
    const [completedMaskMediaId, setCompletedMaskMediaId] = useState<string | null>(null);
    const previousApplied = useRef({ id: selected?.id, applied: !!applied, sourceIdentity }), intentionalRemoval = useRef(false);
    useEffect(() => { generation.current++; controller.current?.abort(); controller.current = null;
        const regenerate = editorPersonMaskNeedsRegeneration(previousApplied.current.id, selected?.id, previousApplied.current.applied, !!applied,
            previousApplied.current.sourceIdentity !== sourceIdentity, intentionalRemoval.current);
        previousApplied.current = { id: selected?.id, applied: !!applied, sourceIdentity }; intentionalRemoval.current = false;
        setStatus(regenerate ? 'error' : 'idle'); setError(regenerate ? 'stale' : null);
        return () => { generation.current++; controller.current?.abort(); controller.current = null; }; }, [options.sourceKey]);
    const supported = editorPersonMaskSourceSupported(options.timeline, options.selection, options.sourceUri);
    const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; setStatus('idle'); setError(null); };
    const apply = async () => {
        if (controller.current) return; const start = latest.current;
        if (!start.selection || !start.sourceUri?.startsWith('file:')) { setError('source'); setStatus('error'); return; }
        const token = ++generation.current, abort = new AbortController(); controller.current = abort; setError(null); setStatus('processing');
        try {
            const result = await captureAndApplyEditorSemanticMask({ account: start.account, project: start.projectId, timeline: start.timeline, selection: start.selection,
                sourceUri: start.sourceUri, category, signal: abort.signal, live: () => token === generation.current && latest.current.sourceKey === start.sourceKey, commit: start.commit });
            if (!result.ok) { if (token === generation.current) { setError(result.code); setStatus(result.code === 'cancelled' ? 'idle' : 'error'); } return; }
            if (latest.current.account === start.account && latest.current.projectId === start.projectId) {
                start.addLocalUri(result.mediaId, result.uri); setCompletedMaskMediaId(result.mediaId);
            }
            if (token === generation.current) setStatus('done');
        } catch { if (token === generation.current && !abort.signal.aborted) { setError('inference-failed'); setStatus('error'); } }
        finally { if (controller.current === abort) controller.current = null; }
    };
    const remove = async () => { const start = latest.current; if (!start.selection) return; intentionalRemoval.current = true;
        const result = await removeEditorSemanticMask({ project: start.projectId, timeline: start.timeline, selection: start.selection, commit: start.commit });
        if (!result.ok) { intentionalRemoval.current = false; setError(result.code); setStatus('error'); }
        else { setCompletedMaskMediaId(null); setError(null); setStatus('idle'); } };
    return { categories: EDITOR_PERSON_MASK_CATEGORIES, category, setCategory, status, error, supported, applied,
        done: !!applied && applied.mediaId === completedMaskMediaId, apply: () => void apply(), remove: () => void remove(), cancel };
}
export type EditorPersonMaskActions = ReturnType<typeof useEditorPersonMask>;
