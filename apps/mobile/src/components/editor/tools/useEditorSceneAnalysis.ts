import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../lib/api';
import { prepareEditorAnalysisSource } from '../../../lib/editorAnalysisSource';
import { EDITOR_SCENES_ENABLED } from '../../../lib/editorFlag';
import type { EditorMediaErrorCode } from '../../../lib/editorMedia/protocol';
import { analyzeClipScenes, inspectSceneAnalysisSource, sceneAnalysisAvailable, type SceneRow } from '../../../lib/editorSceneAnalysis';
import type { Clip, Media } from '../../../lib/nativeEditorModel';

export type ScenePanelStatus = 'idle' | 'preparing' | 'analyzing' | 'done' | 'error';
export type SceneAvailability = 'checking' | 'available' | 'unsupported';

export function sceneAnalysisBlocker(media: Media | undefined, clip: Clip | undefined, locked: boolean): 'select' | 'transform' | 'short' | 'long' | 'locked' | null {
    if (!media || media.kind !== 'video' || !clip) return 'select';
    if (locked) return 'locked';
    if (clip.reverse || clip.speedCurve || clip.freezeFrame !== undefined || (clip.rate ?? 1) !== 1) return 'transform';
    if (!Number.isSafeInteger(clip.len) || clip.len < 3) return 'short';
    if (clip.len > 900) return 'long';
    return null;
}

type Options = {
    api: Pick<ApiClient, 'request'>;
    projectId: string;
    media?: Media;
    clip?: Clip;
    localUri?: string;
    runKey: string;
};

export function useEditorSceneAnalysis({ api, projectId, media, clip, localUri, runKey }: Options) {
    const [availability, setAvailability] = useState<SceneAvailability>(EDITOR_SCENES_ENABLED ? 'checking' : 'unsupported');
    const [state, setState] = useState<{ status: ScenePanelStatus; progress: number; rows: SceneRow[]; error?: EditorMediaErrorCode | 'source' | 'stale'; resultKey?: string }>(
        { status: 'idle', progress: 0, rows: [] });
    const controller = useRef<AbortController | null>(null), keyRef = useRef(runKey); keyRef.current = runKey;

    const cancel = useCallback(() => {
        controller.current?.abort(); controller.current = null;
        setState(current => current.status === 'idle' ? current : { status: 'idle', progress: 0, rows: [] });
    }, []);

    useEffect(() => {
        let live = true;
        if (!EDITOR_SCENES_ENABLED) { setAvailability('unsupported'); return () => { live = false; }; }
        void sceneAnalysisAvailable().then(value => { if (live) setAvailability(value ? 'available' : 'unsupported'); });
        return () => { live = false; };
    }, []);
    useEffect(() => { controller.current?.abort(); controller.current = null; setState({ status: 'idle', progress: 0, rows: [] }); }, [runKey]);
    useEffect(() => () => { controller.current?.abort(); }, []);

    const detect = useCallback(async () => {
        if (availability !== 'available' || !media || !clip) return;
        controller.current?.abort();
        const active = new AbortController(), expectedKey = runKey; controller.current = active;
        const current = () => !active.signal.aborted && keyRef.current === expectedKey;
        setState({ status: 'preparing', progress: 0, rows: [] });
        try {
            const source = await prepareEditorAnalysisSource(api, projectId, media, localUri, active.signal);
            if (!current()) return;
            if (!source.ok) { setState({ status: source.code === 'cancelled' ? 'idle' : 'error', progress: 0, rows: [], error: 'source' }); return; }
            const inspected = await inspectSceneAnalysisSource(projectId, source.uri, active.signal);
            if (!current()) return;
            if (!inspected.ok) { setState({ status: inspected.code === 'cancelled' ? 'idle' : 'error', progress: 0, rows: [], error: inspected.code }); return; }
            if (!inspected.value.hasVideo || !inspected.value.width || !inspected.value.height || inspected.value.width * inspected.value.height > 1280 * 720) {
                setState({ status: 'error', progress: 0, rows: [], error: 'invalid-input' }); return;
            }
            setState({ status: 'analyzing', progress: 0, rows: [] });
            const result = await analyzeClipScenes({ project: projectId, uri: source.uri, clip: { start: clip.start, in: clip.in ?? 0, len: clip.len }, signal: active.signal,
                onProgress: progress => { if (current()) setState(value => value.status === 'analyzing' ? { ...value, progress: progress.value } : value); } });
            if (!current()) return;
            if (!result.ok) { setState({ status: result.code === 'cancelled' ? 'idle' : 'error', progress: 0, rows: [], error: result.code }); return; }
            setState({ status: 'done', progress: 1, rows: result.value.rows, resultKey: expectedKey });
        } catch {
            if (current()) setState({ status: 'error', progress: 0, rows: [], error: 'write-failed' });
        } finally { if (controller.current === active) controller.current = null; }
    }, [api, availability, clip, localUri, media, projectId, runKey]);

    const toggle = useCallback((frame: number) => setState(current => current.status !== 'done' ? current
        : { ...current, rows: current.rows.map(row => row.frame === frame ? { ...row, ticked: !row.ticked } : row) }), []);
    const clear = useCallback(() => setState({ status: 'idle', progress: 0, rows: [] }), []);
    return { availability, ...state, detect, cancel, toggle, clear };
}
