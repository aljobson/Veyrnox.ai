import { framesIn, type Timeline } from './nativeEditorModel';
import { editorPreviewPlan, type EditorPreviewCapability, type EditorPreviewPlan } from './editorPreviewPlan';
import {
    EDITOR_MEDIA_LIMITS, frameTimestampUs, type EncodeSession, type FrameDescriptor, type Mp4Artifact,
} from './editorMedia/protocol';

/**
 * The capability surface shared by continuous preview and local export. A renderer must implement
 * every item here before it can advertise itself as the canonical compositor. Keeping this list in
 * the export contract prevents a preview-only approximation from silently reaching the S9 writer.
 */
export const CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES = Object.freeze([
    'timeline-background', 'image-source', 'graphic-source', 'video-source', 'fit', 'crop', 'transform',
    'visual-layering', 'blend', 'mask', 'transition', 'clip-animation', 'animation-reveal',
    'clip-background-solid', 'clip-background-blur', 'clip-background-image', 'basic-filter', 'smart-picture',
    'advanced-colour', 'effect', 'text-layer', 'caption-words', 'custom-font',
    'semantic-mask', 'semantic-mask-dynamic', 'audio-mix',
] as const satisfies readonly EditorPreviewCapability[]);

export const EDITOR_LOCAL_EXPORT_LIMITS = Object.freeze({
    maximumFrames: EDITOR_MEDIA_LIMITS.durationSeconds * 60,
    maximumBatchFrames: EDITOR_MEDIA_LIMITS.batchFrames,
    maximumDurationSeconds: EDITOR_MEDIA_LIMITS.durationSeconds,
});

export type EditorCompositorFrame = {
    readonly plan: EditorPreviewPlan;
    readonly index: number;
    readonly timestampUs: number;
    readonly width: number;
    readonly height: number;
};

export type EditorLocalExportProgress = {
    readonly stage: 'preparing' | 'compositing' | 'encoding' | 'finishing';
    readonly value: number;
    readonly frame: number;
    readonly frames: number;
};

export type EditorLocalExportFailure =
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-timeline' | 'unsupported-frame' | 'write-failed'; readonly frame?: number; readonly capabilities?: readonly EditorPreviewCapability[] }
    | { readonly ok: false; readonly code: 'native-media'; readonly nativeCode: string };

export type EditorLocalExportResult = { readonly ok: true; readonly artifact: Mp4Artifact } | EditorLocalExportFailure;

type NativeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export type EditorLocalExportDependencies = {
    /** Render exactly this canonical plan and persist one tightly-packed RGBA8 frame in the S9 cache root. */
    renderFrame(frame: EditorCompositorFrame, signal: AbortSignal): Promise<FrameDescriptor>;
    /** Delete frames which were rendered but never accepted by the S9 writer. */
    discardFrames(frames: readonly FrameDescriptor[]): void;
    /** Build the canonical 48 kHz stereo mix. Ownership transfers to the exporter until release. */
    prepareAudio(timeline: Timeline, signal: AbortSignal, progress: (value: number) => void): Promise<NativeResult<{ artifactId: string }>>;
    begin(request: { width: number; height: number; fps: number; videoBitRate: number; audioBitRate: number; audioArtifactId: string; alpha?: boolean }): Promise<NativeResult<EncodeSession>>;
    append(session: EncodeSession, frames: readonly FrameDescriptor[]): Promise<NativeResult<EncodeSession>>;
    finish(session: EncodeSession, audioArtifactId: string): Promise<NativeResult<Mp4Artifact>>;
    cancel(session: EncodeSession): void;
    release(artifactId: string): Promise<void>;
};

export type EditorLocalExportRequest = {
    readonly timeline: Timeline;
    readonly width: number;
    readonly height: number;
    readonly videoBitRate: number;
    readonly audioBitRate?: number;
    readonly preserveAlpha?: boolean;
    readonly transparentBackground?: boolean;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: EditorLocalExportProgress) => void;
};

const validOutput = (request: EditorLocalExportRequest, frames: number) => Number.isSafeInteger(request.width) && request.width > 0
    && request.width <= 1280 && Number.isSafeInteger(request.height) && request.height > 0 && request.height <= 1280
    && request.width * request.height <= 1280 * 720 && Number.isSafeInteger(request.timeline.fps) && request.timeline.fps > 0
    && request.timeline.fps <= 60 && frames > 0 && frames <= EDITOR_LOCAL_EXPORT_LIMITS.maximumFrames
    && frames <= request.timeline.fps * EDITOR_LOCAL_EXPORT_LIMITS.maximumDurationSeconds;

function cancelled(signal: AbortSignal | undefined) {
    return signal?.aborted === true;
}

/**
 * Drives the already-qualified S9 file-batched writer from the same canonical plans used by
 * preview/playback. It owns no media decoder or renderer policy: those stay in the compositor,
 * while this function owns ordering, bounded batching, cancellation and artifact lifetime.
 */
export async function exportEditorMp4(request: EditorLocalExportRequest, dependencies: EditorLocalExportDependencies): Promise<EditorLocalExportResult> {
    const frames = framesIn(request.timeline);
    if (!validOutput(request, frames)) return { ok: false, code: 'invalid-timeline' };
    if (cancelled(request.signal)) return { ok: false, code: 'cancelled' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    let session: EncodeSession | null = null, audioArtifactId: string | null = null;
    const emit = (stage: EditorLocalExportProgress['stage'], value: number, frame = 0) => request.onProgress?.({ stage, value, frame, frames });
    try {
        emit('preparing', 0);
        const audio = await dependencies.prepareAudio(request.timeline, controller.signal, value => emit('preparing', Math.max(0, Math.min(.15, value * .15))));
        if (!audio.ok) return audio.code === 'cancelled' ? { ok: false, code: 'cancelled' } : { ok: false, code: 'native-media', nativeCode: audio.code };
        audioArtifactId = audio.value.artifactId;
        if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
        const begun = await dependencies.begin({ width: request.width, height: request.height, fps: request.timeline.fps,
            videoBitRate: request.videoBitRate, audioBitRate: request.audioBitRate ?? 192_000, audioArtifactId,
            ...(request.preserveAlpha ? { alpha: true } : {}) });
        if (!begun.ok) return begun.code === 'cancelled' ? { ok: false, code: 'cancelled' } : { ok: false, code: 'native-media', nativeCode: begun.code };
        session = begun.value;
        for (let start = 0; start < frames; start += EDITOR_LOCAL_EXPORT_LIMITS.maximumBatchFrames) {
            const batch: FrameDescriptor[] = [];
            let appendedBatch = false;
            try { for (let index = start; index < Math.min(frames, start + EDITOR_LOCAL_EXPORT_LIMITS.maximumBatchFrames); index += 1) {
                if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
                const plan = editorPreviewPlan(request.timeline, index, CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES,
                    { transparentBackground: request.transparentBackground });
                if (!plan.capabilities.exact) return { ok: false, code: 'unsupported-frame', frame: index,
                    capabilities: [...new Set(plan.capabilities.unsupported.map(value => value.capability))] };
                let descriptor: FrameDescriptor;
                try { descriptor = await dependencies.renderFrame({ plan, index, timestampUs: frameTimestampUs(index, request.timeline.fps), width: request.width, height: request.height }, controller.signal); }
                catch { return controller.signal.aborted ? { ok: false, code: 'cancelled' } : { ok: false, code: 'write-failed', frame: index }; }
                batch.push(descriptor);
                emit('compositing', .15 + .65 * ((index + 1) / frames), index + 1);
            }
            const appended = await dependencies.append(session, batch);
            if (!appended.ok) return appended.code === 'cancelled' ? { ok: false, code: 'cancelled' } : { ok: false, code: 'native-media', nativeCode: appended.code };
            appendedBatch = true;
            session = appended.value;
            emit('encoding', .8 + .15 * (Math.min(frames, start + batch.length) / frames), Math.min(frames, start + batch.length));
            } finally { if (!appendedBatch && batch.length) dependencies.discardFrames(batch); }
        }
        emit('finishing', .95, frames);
        const finished = await dependencies.finish(session, audioArtifactId);
        if (!finished.ok) return finished.code === 'cancelled' ? { ok: false, code: 'cancelled' } : { ok: false, code: 'native-media', nativeCode: finished.code };
        session = null;
        emit('finishing', 1, frames);
        return { ok: true, artifact: finished.value };
    } finally {
        request.signal?.removeEventListener('abort', abort);
        if (session) dependencies.cancel(session);
        if (audioArtifactId) await dependencies.release(audioArtifactId).catch(() => undefined);
    }
}
