import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../lib/api';
import { prepareEditorAnalysisSource } from '../../../lib/editorAnalysisSource';
import { analyzeClipForFinder, clipFinderAnalysisAvailable, type ClipFinderProgress, type ClipFinderRow } from '../../../lib/editorClipAnalysis';
import { EDITOR_CLIPS_ENABLED } from '../../../lib/editorFlag';
import type { EditorMediaErrorCode } from '../../../lib/editorMedia/protocol';
import { inspectSceneAnalysisSource } from '../../../lib/editorSceneAnalysis';
import type { Clip, Media, Timeline } from '../../../lib/nativeEditorModel';

export type ClipFinderStatus = 'idle' | 'preparing' | 'reading-picture' | 'reading-sound' | 'ranking' | 'done' | 'error';
export type ClipFinderAvailability = 'checking' | 'available' | 'unsupported';
export type ClipFinderError = EditorMediaErrorCode | 'source' | 'stale' | 'resolution';

type State = {
    status: ClipFinderStatus;
    progress: number;
    rows: ClipFinderRow[];
    error?: ClipFinderError;
    resultKey?: string;
    hadAudio?: boolean;
};

type Options = {
    api: Pick<ApiClient, 'request'>;
    projectId: string;
    timeline: Timeline;
    media?: Media;
    clip?: Clip;
    localUri?: string;
    runKey: string;
};

const empty = (): State => ({ status: 'idle', progress: 0, rows: [] });
const stageOrder: Record<ClipFinderStatus, number> = {
    idle: 0, preparing: 1, 'reading-picture': 2, 'reading-sound': 3, ranking: 4, done: 5, error: 5,
};
const exceeds720p = (width: number, height: number) => Math.max(width, height) > 1280 || Math.min(width, height) > 720;

/** Clip Finder reads the selected source only. A locked source track therefore does not block analysis. */
export function clipFinderBlocker(media: Media | undefined, clip: Clip | undefined): 'select' | 'transform' | 'short' | 'long' | 'resolution' | null {
    if (!media || media.kind !== 'video' || !clip) return 'select';
    if (media.width && media.height && exceeds720p(media.width, media.height)) return 'resolution';
    if (clip.reverse || clip.speedCurve || clip.freezeFrame !== undefined || (clip.rate ?? 1) !== 1) return 'transform';
    if (!Number.isSafeInteger(clip.len) || clip.len < 3) return 'short';
    if (clip.len > 900) return 'long';
    return null;
}

function progressState(current: State, update: ClipFinderProgress, hasAudio: boolean): State {
    if (!['reading-picture', 'reading-sound', 'ranking'].includes(current.status)) return current;
    const value = Math.max(0, Math.min(1, update.value));
    const status: ClipFinderStatus = update.phase === 'audio'
        ? value >= 1 ? 'ranking' : 'reading-sound'
        : value >= 1 && !hasAudio ? 'ranking' : 'reading-picture';
    if (stageOrder[status] < stageOrder[current.status]) return current;
    const mapped = update.phase === 'audio' ? 0.5 + value * 0.45 : 0.05 + value * 0.45;
    return { ...current, status, progress: Math.max(current.progress, status === 'ranking' ? 0.95 : mapped) };
}

export function useEditorClipFinder({ api, projectId, timeline, media, clip, localUri, runKey }: Options) {
    const [availability, setAvailability] = useState<ClipFinderAvailability>(EDITOR_CLIPS_ENABLED ? 'checking' : 'unsupported');
    const [state, setState] = useState<State>(empty);
    const controller = useRef<AbortController | null>(null), keyRef = useRef(runKey);
    keyRef.current = runKey;

    const cancel = useCallback(() => {
        controller.current?.abort(); controller.current = null;
        setState(current => current.status === 'idle' ? current : empty());
    }, []);
    const clear = useCallback(() => {
        controller.current?.abort(); controller.current = null; setState(empty());
    }, []);

    useEffect(() => {
        let live = true;
        if (!EDITOR_CLIPS_ENABLED) { setAvailability('unsupported'); return () => { live = false; }; }
        void clipFinderAnalysisAvailable().then(value => { if (live) setAvailability(value ? 'available' : 'unsupported'); }, () => {
            if (live) setAvailability('unsupported');
        });
        return () => { live = false; };
    }, []);
    useEffect(() => { controller.current?.abort(); controller.current = null; setState(empty()); }, [runKey]);
    useEffect(() => () => { controller.current?.abort(); }, []);

    const find = useCallback(async () => {
        if (availability !== 'available' || !media || !clip || clipFinderBlocker(media, clip)) return;
        controller.current?.abort();
        const active = new AbortController(), expectedKey = runKey; controller.current = active;
        const current = () => !active.signal.aborted && keyRef.current === expectedKey;
        setState({ status: 'preparing', progress: 0, rows: [] });
        try {
            const source = await prepareEditorAnalysisSource(api, projectId, media, localUri, active.signal);
            if (!current()) return;
            if (!source.ok) {
                setState(source.code === 'cancelled' ? empty() : { status: 'error', progress: 0, rows: [], error: 'source' });
                return;
            }
            const inspected = await inspectSceneAnalysisSource(projectId, source.uri, active.signal);
            if (!current()) return;
            if (!inspected.ok) {
                setState(inspected.code === 'cancelled' ? empty() : { status: 'error', progress: 0, rows: [], error: inspected.code });
                return;
            }
            if (inspected.value.width && inspected.value.height && exceeds720p(inspected.value.width, inspected.value.height)) {
                setState({ status: 'error', progress: 0, rows: [], error: 'resolution' }); return;
            }
            if (!inspected.value.hasVideo || !inspected.value.width || !inspected.value.height) {
                setState({ status: 'error', progress: 0, rows: [], error: 'invalid-input' }); return;
            }
            const hasAudio = inspected.value.hasAudio;
            setState({ status: 'reading-picture', progress: 0.05, rows: [], hadAudio: hasAudio });
            const result = await analyzeClipForFinder({ project: projectId, uri: source.uri, timeline,
                clip: { start: clip.start, in: clip.in ?? 0, len: clip.len }, hasAudio, signal: active.signal,
                onProgress: progress => { if (current()) setState(value => progressState(value, progress, hasAudio)); } });
            if (!current()) return;
            if (!result.ok) {
                setState(result.code === 'cancelled' ? empty() : { status: 'error', progress: 0, rows: [], error: result.code, hadAudio: hasAudio });
                return;
            }
            setState({ status: 'done', progress: 1, rows: result.value.rows, resultKey: expectedKey, hadAudio: result.value.hadAudio });
        } catch {
            if (current()) setState({ status: 'error', progress: 0, rows: [], error: 'write-failed' });
        } finally { if (controller.current === active) controller.current = null; }
    }, [api, availability, clip, localUri, media, projectId, runKey, timeline]);

    const toggle = useCallback((id: string) => setState(current => current.status !== 'done' ? current
        : { ...current, rows: current.rows.map(row => row.id === id ? { ...row, ticked: !row.ticked } : row) }), []);

    return { availability, ...state, find, cancel, toggle, clear };
}
