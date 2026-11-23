import { createNativeEditorLocalExportDependencies, type EditorCompositorSourceMap } from './editorCompositorNative';
import { exportEditorMp4, type EditorLocalExportProgress } from './editorLocalExport';
import { clipAt, type Clip, type Selection, type Timeline } from './nativeEditorModel';
import type { Mp4Artifact } from './editorMedia/protocol';

export const EDITOR_MOTION_BAKED_FIELDS = Object.freeze([
    'in', 'rate', 'reverse', 'speedCurve', 'freezeFrame', 'preservePitch',
    'fit', 'crop', 'transform', 'keyframes', 'animation', 'parameterKeyframes', 'filter', 'colourAdjustment',
    'mask', 'maskSettings', 'maskKeyframes', 'semanticMask', 'smartPicture', 'effect', 'background',
    'volume', 'fadeIn', 'fadeOut', 'pan', 'eq', 'audioProcessing', 'audioEffects',
] as const);

export type CanonicalMotionInput = { readonly artifact: Mp4Artifact; readonly timeline: Timeline; readonly clip: Clip };
export type CanonicalMotionInputResult = { readonly ok: true; readonly value: CanonicalMotionInput }
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-input' | 'unsupported-frame' | 'native-media' | 'write-failed' };

export function canonicalMotionTimeline(timeline: Timeline, selection: Selection): { timeline: Timeline; clip: Clip } | null {
    const selected = clipAt(timeline, selection);
    if (selection.track !== 'video' || !selected || !('mediaId' in selected) || !selected.mediaId) return null;
    const clip: Clip = { ...selected, start: 0, transition: 0, blend: 'source-over' };
    return { clip, timeline: { ...timeline, video: [clip], audio: [], text: [],
        tracks: timeline.tracks.map(track => track.id === clip.trackId ? { ...track, hidden: false, muted: false } : track) } };
}

const dimensions = (timeline: Timeline, height: 480 | 720) => {
    const aspect = timeline.aspect === '9:16' ? 9 / 16 : timeline.aspect === '1:1' ? 1 : 16 / 9;
    return { width: Math.min(1280, Math.max(8, Math.round(height * aspect / 2) * 2)), height };
};

/** Renders the selected edited clip into a bounded, generation-fenced HEVC-with-alpha artifact.
 * Timeline background, neighbor-dependent blend and transition are intentionally left live. */
export async function prepareCanonicalMotionInput(request: { readonly account: string; readonly project: string;
    readonly timeline: Timeline; readonly selection: Selection; readonly sources: EditorCompositorSourceMap; readonly signal?: AbortSignal;
    readonly height: 480 | 720;
    readonly onProgress?: (value: EditorLocalExportProgress) => void }): Promise<CanonicalMotionInputResult> {
    const canonical = canonicalMotionTimeline(request.timeline, request.selection);
    if (!canonical) return { ok: false, code: 'invalid-input' };
    const result = await exportEditorMp4({ timeline: canonical.timeline, ...dimensions(canonical.timeline, request.height), videoBitRate: 8_000_000,
        audioBitRate: 192_000, preserveAlpha: true, transparentBackground: true, signal: request.signal, onProgress: request.onProgress },
    createNativeEditorLocalExportDependencies(request.account, request.project, canonical.timeline, request.sources));
    if (!result.ok) return { ok: false, code: result.code === 'invalid-timeline' ? 'invalid-input'
        : result.code === 'native-media' ? 'native-media' : result.code };
    if (result.artifact.videoCodec !== 'hvc1-alpha') return { ok: false, code: 'write-failed' };
    return { ok: true, value: { artifact: result.artifact, timeline: canonical.timeline, clip: canonical.clip } };
}
