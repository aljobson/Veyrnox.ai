import { useEffect, useRef, useState } from 'react';
import { adoptEditorMotionOutput } from '../../../lib/editorNativeMediaActions';
import { createNativeEditorMotionProcessor, runEditorMotionProcessing, type EditorMotionOptions, type EditorMotionProgress, type EditorMotionTool } from '../../../lib/editorMotionProcessingNative';
import { canvasAspectRatio, clipAt, type Clip, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import { sourceRange } from '../../../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { prepareCanonicalMotionInput } from '../../../lib/editorMotionPreRender';
import { editorMediaArtifacts } from '../../../lib/editorMedia/artifacts';

export function editorMotionSelectedRange(value: Pick<Clip, 'in' | 'len' | 'rate' | 'reverse' | 'speedCurve' | 'freezeFrame'>, fps: number) {
    const bounds = sourceRange(value);
    return { fromSeconds: bounds.from / fps, durationSeconds: (bounds.to - bounds.from + 1) / fps };
}
type Options = { account: string; projectId: string; sourceUri?: string; sourceKind?: string; sourceMediaId?: string; sourceKey: string; range?: { fromSeconds: number; durationSeconds: number };
    sources: Readonly<Record<string, string>>;
    selection: Selection | null; timeline: Timeline;
    commit(timeline: Timeline): boolean; addLocalUri(mediaId: string, uri: string): void };
export type EditorMotionProcessingError = 'source' | 'stale' | 'copy-failed' | 'commit-refused' | 'invalid-output'
    | 'invalid-input' | 'unsupported-platform' | 'unsupported-codec' | 'corrupt-media' | 'busy' | 'disk-full' | 'write-failed';

export function useEditorMotionProcessing(options: Options) {
    const latest = useRef(options); latest.current = options;
    const [tools, setTools] = useState<readonly EditorMotionTool[]>([]), [checking, setChecking] = useState(true);
    const [progress, setProgress] = useState<EditorMotionProgress | null>(null), [error, setError] = useState<EditorMotionProcessingError | null>(null);
    const [completedMediaId, setCompletedMediaId] = useState<string | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
    useEffect(() => {
        const token = ++generation.current; controller.current?.abort(); controller.current = null; setChecking(true); setError(null); setProgress(null);
        const processor = createNativeEditorMotionProcessor(options.account, options.projectId);
        void processor.capabilities().then(value => { if (token === generation.current) { setTools(value.platform === 'ios' ? value.tools : []); setChecking(false); } });
        return () => { generation.current++; controller.current?.abort(); controller.current = null; };
    }, [options.account, options.projectId, options.sourceKey]);
    const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; setProgress(null); setError(null); };
    const run = async (tool: EditorMotionTool) => {
        if (controller.current) return;
        const start = latest.current;
        if (start.sourceKind !== 'video' || !start.sourceUri?.startsWith('file:') || start.selection?.track !== 'video') { setError('source'); return; }
        const selected = clipAt(start.timeline, start.selection);
        if (!selected || !('mediaId' in selected)) { setError('invalid-input'); return; }
        const token = ++generation.current, abort = new AbortController(); controller.current = abort; setError(null); setCompletedMediaId(null);
        let preRenderedArtifactId: string | null = null;
        try {
            const height = tool === 'optical-flow' ? 480 as const : 720 as const;
            const preRendered = await prepareCanonicalMotionInput({ account: start.account, project: start.projectId, timeline: start.timeline,
                selection: start.selection, sources: start.sources, height, signal: abort.signal });
            if (!preRendered.ok) { if (preRendered.code !== 'cancelled') setError(preRendered.code === 'invalid-input' ? 'invalid-input' : 'write-failed'); return; }
            preRenderedArtifactId = preRendered.value.artifact.artifactId;
            const options: EditorMotionOptions = { tool, frameRate: [24, 25, 30, 50, 60].includes(start.timeline.fps) ? start.timeline.fps as 24 | 25 | 30 | 50 | 60 : 30,
                height, smoothing: 10, strength: 1,
                ...(tool === 'track-reframe' ? { aspect: canvasAspectRatio(start.timeline.aspect) ?? 16 / 9,
                    region: { x: .25, y: .25, width: .5, height: .5 } } : {}),
                ...(tool === 'camera-movement' ? { from: { x: .42, y: .5, zoom: 1.08 }, to: { x: .58, y: .5, zoom: 1.08 } } : {}) };
            const result = await runEditorMotionProcessing(preRendered.value.artifact.uri, options,
                createNativeEditorMotionProcessor(start.account, start.projectId), abort.signal,
                value => { if (token === generation.current) setProgress(value); }, undefined, true);
            if (token !== generation.current || abort.signal.aborted) return;
            if (!result.ok) { if (result.code !== 'cancelled') setError(result.code); return; }
            const adopted = await adoptEditorMotionOutput({ account: start.account, project: start.projectId, timeline: start.timeline, selection: start.selection,
                output: result.value, live: () => token === generation.current && latest.current.sourceKey === start.sourceKey, commit: start.commit });
            if (!adopted.ok) { if (token === generation.current) setError(adopted.code); return; }
            if (latest.current.account === start.account && latest.current.projectId === start.projectId) {
                start.addLocalUri(adopted.mediaId, adopted.uri); setCompletedMediaId(adopted.mediaId);
            }
            if (token !== generation.current) return;
            setProgress(null);
        } catch { if (token === generation.current && !abort.signal.aborted) setError('write-failed'); }
        finally { if (preRenderedArtifactId) await editorMediaArtifacts.release(start.projectId, preRenderedArtifactId).catch(() => undefined);
            if (controller.current === abort) controller.current = null; }
    };
    return { tools, checking, progress, error, done: completedMediaId !== null && completedMediaId === options.sourceMediaId,
        sourceAvailable: options.sourceKind === 'video' && !!options.sourceUri?.startsWith('file:'),
        run: (tool: EditorMotionTool) => void run(tool), cancel };
}
export type EditorMotionProcessingActions = ReturnType<typeof useEditorMotionProcessing>;
