import { MOTION_TOOLS, MOTION_VIDEO_LIMITS, validateMotionOptions } from '../../../../app/veyrnox/_lib/editorMotionProcessing.mjs';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { editorMedia } from './editorMedia';

export type EditorMotionTool = (typeof MOTION_TOOLS)[number];
export type EditorMotionOptions = {
    readonly tool: EditorMotionTool; readonly frameRate: 24 | 25 | 30 | 50 | 60; readonly height: 360 | 480 | 720;
    readonly smoothing?: number; readonly strength?: number; readonly aspect?: number;
    readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly from?: { readonly x: number; readonly y: number; readonly zoom: number };
    readonly to?: { readonly x: number; readonly y: number; readonly zoom: number };
};
export type EditorMotionProgress = { readonly stage: 'inspecting' | 'analysing' | 'processing' | 'encoding' | 'recovering'; readonly value: number };
export type EditorMotionRange = { readonly fromSeconds: number; readonly durationSeconds: number };
export type EditorMotionOutput = { readonly artifactId: string; readonly uri: string; readonly bytes: number; readonly durationSeconds: number;
    readonly width: number; readonly height: number; readonly frameRate: number; readonly videoCodec: 'avc1' | 'hvc1-alpha'; readonly audioCodec?: 'mp4a';
    readonly sourceBaseFrame?: number };
export type EditorMotionResult = { readonly ok: true; readonly value: EditorMotionOutput }
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-input' | 'unsupported-platform' | 'unsupported-codec' | 'corrupt-media' | 'busy' | 'disk-full' | 'write-failed' };

export const EDITOR_MOTION_PLATFORM_GATES = Object.freeze({
    ios: { minimumVersion: '16.4', tools: ['stabilize', 'flicker', 'optical-flow', 'track-reframe', 'camera-movement'] as const },
    android: { tools: [], reason: 'android-editor-motion-processing-not-qualified' },
} as const);

export type EditorMotionProcessor = {
    capabilities(): Promise<{ readonly platform: 'ios' | 'android'; readonly tools: readonly EditorMotionTool[] }>;
    inspect(uri: string, signal: AbortSignal): Promise<{ readonly durationSeconds: number; readonly bytes: number; readonly hasAudio: boolean }>;
    process(request: { readonly sourceUri: string; readonly options: EditorMotionOptions; readonly range?: EditorMotionRange; readonly alpha?: boolean }, signal: AbortSignal,
        progress: (event: EditorMotionProgress) => void): Promise<EditorMotionResult>;
    release?(output: EditorMotionOutput): Promise<void>;
    recover(): Promise<void>;
};

type NativeMotion = {
    capabilities(): Promise<Record<string, unknown>>;
    inspect(account: string, project: string, owner: string, token: string, uri: string): Promise<Record<string, unknown>>;
    process(account: string, project: string, owner: string, token: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    cancel(account: string, project: string, owner: string, token: string): void;
    addListener(event: 'progress', listener: (event: Record<string, unknown>) => void): { remove(): void };
};

const runId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function loadNativeMotion(): NativeMotion | null { try { return requireOptionalNativeModule<NativeMotion>('VeyrnoxEditorMotion'); } catch { return null; } }

/** Concrete current-iOS adapter. Native work owns decoding, analysis, S9 encode, audio preservation and partial cleanup. */
export function createNativeEditorMotionProcessor(account: string, project: string, native: NativeMotion | null = loadNativeMotion()): EditorMotionProcessor {
    const owner = runId('motion-owner');
    return {
        async capabilities() {
            if (!native) return { platform: 'android', tools: [] };
            try { const raw = await native.capabilities(), tools = Array.isArray(raw.tools)
                ? raw.tools.filter((tool): tool is EditorMotionTool => MOTION_TOOLS.includes(tool as EditorMotionTool)) : [];
                return { platform: raw.ok === true && raw.platform === 'ios' ? 'ios' : 'android', tools }; }
            catch { return { platform: 'android', tools: [] }; }
        },
        async inspect(uri, signal) {
            if (!native || signal.aborted) throw Error('cancelled');
            await editorMedia.setOwner(account); if (signal.aborted) throw Error('cancelled');
            const token = runId('inspect'), raw = await native.inspect(account, project, owner, token, uri);
            if (raw.ok !== true || typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration <= 0
                || typeof raw.fileSize !== 'number' || !Number.isSafeInteger(raw.fileSize) || raw.fileSize < 1) throw Error('corrupt-media');
            return { durationSeconds: raw.duration, bytes: raw.fileSize, hasAudio: raw.hasAudio === true };
        },
        async process({ sourceUri, options, range, alpha }, signal, progress) {
            if (!native) return { ok: false, code: 'unsupported-platform' };
            await editorMedia.setOwner(account); if (signal.aborted) return { ok: false, code: 'cancelled' };
            const token = runId('motion'), subscription = native.addListener('progress', event => {
                if (event.owner === owner && event.token === token && typeof event.value === 'number' && typeof event.stage === 'string') {
                    const stage = event.stage === 'analysing' ? 'analysing' : event.stage === 'finishing' ? 'encoding' : event.stage === 'preparing' ? 'analysing' : 'processing';
                    progress({ stage, value: event.value });
                }
            });
            const abort = () => native.cancel(account, project, owner, token); signal.addEventListener('abort', abort, { once: true });
            try {
                const request: Record<string, unknown> = { uri: sourceUri, tool: options.tool, frameRate: options.frameRate, height: options.height,
                    smoothing: options.smoothing ?? 10, strength: options.strength ?? 1 };
                if (range) Object.assign(request, { fromSeconds: range.fromSeconds, durationSeconds: range.durationSeconds });
                if (alpha) request.alpha = true;
                if (options.aspect !== undefined) request.aspect = options.aspect;
                if (options.region) Object.assign(request, { regionX: options.region.x, regionY: options.region.y, regionWidth: options.region.width, regionHeight: options.region.height });
                if (options.from) Object.assign(request, { fromX: options.from.x, fromY: options.from.y, fromZoom: options.from.zoom });
                if (options.to) Object.assign(request, { toX: options.to.x, toY: options.to.y, toZoom: options.to.zoom });
                const raw = await native.process(account, project, owner, token, request);
                if (signal.aborted || raw.code === 'cancelled') return { ok: false, code: 'cancelled' };
                if (raw.ok !== true) return { ok: false, code: codes.has(raw.code as never) ? raw.code as Extract<EditorMotionResult, { ok: false }>['code'] : 'write-failed' };
                if (typeof raw.artifactId !== 'string' || !/^vx-mp4-[a-z0-9-]+$/.test(raw.artifactId)
                    || typeof raw.uri !== 'string' || typeof raw.size !== 'number' || typeof raw.durationUs !== 'number' || typeof raw.width !== 'number'
                    || typeof raw.height !== 'number' || typeof raw.fps !== 'number' || raw.videoCodec !== (alpha ? 'hvc1-alpha' : 'avc1')) return { ok: false, code: 'write-failed' };
                return { ok: true, value: { artifactId: raw.artifactId, uri: raw.uri, bytes: raw.size, durationSeconds: raw.durationUs / 1_000_000,
                    width: raw.width, height: raw.height, frameRate: raw.fps, videoCodec: raw.videoCodec as 'avc1' | 'hvc1-alpha',
                    ...(raw.audioCodec === 'mp4a' ? { audioCodec: 'mp4a' as const } : {}) } };
            } catch { return signal.aborted ? { ok: false, code: 'cancelled' } : { ok: false, code: 'write-failed' }; }
            finally { signal.removeEventListener('abort', abort); subscription.remove(); }
        },
        async release(output) { await editorMedia.setOwner(account); await editorMedia.release(project, output.artifactId); },
        async recover() { /* Native worker deletes partials before resolving and S9 sweeps abandoned cache artifacts. */ },
    };
}

const codes = new Set<Extract<EditorMotionResult, { ok: false }>['code']>([
    'cancelled', 'invalid-input', 'unsupported-platform', 'unsupported-codec', 'corrupt-media', 'busy', 'disk-full', 'write-failed',
]);

/** Bounded, monotonic and retryable lifecycle shared by every native motion tool. */
export async function runEditorMotionProcessing(sourceUri: string, options: EditorMotionOptions, processor: EditorMotionProcessor,
    signal?: AbortSignal, onProgress?: (event: EditorMotionProgress) => void, range?: EditorMotionRange, preserveAlpha = false): Promise<EditorMotionResult> {
    if (!sourceUri.startsWith('file:') || validateMotionOptions(options)) return { ok: false, code: 'invalid-input' };
    if (range && (!Number.isFinite(range.fromSeconds) || range.fromSeconds < 0 || !Number.isFinite(range.durationSeconds) || range.durationSeconds <= 0))
        return { ok: false, code: 'invalid-input' };
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    let last = 0;
    const emit = (event: EditorMotionProgress) => {
        const value = Math.max(last, Math.min(1, event.value)); last = value; onProgress?.({ ...event, value });
    };
    try {
        if (signal?.aborted) return { ok: false, code: 'cancelled' };
        const capability = await processor.capabilities();
        if (capability.platform !== 'ios' || !capability.tools.includes(options.tool)) return { ok: false, code: 'unsupported-platform' };
        emit({ stage: 'inspecting', value: 0 });
        const info = await processor.inspect(sourceUri, controller.signal);
        if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
        const secondsLimit = options.tool === 'optical-flow' ? MOTION_VIDEO_LIMITS.opticalSeconds : MOTION_VIDEO_LIMITS.sourceSeconds;
        const outputDuration = range?.durationSeconds ?? info.durationSeconds;
        if (!Number.isFinite(info.durationSeconds) || info.durationSeconds <= 0 || outputDuration > secondsLimit
            || (range && range.fromSeconds + range.durationSeconds > info.durationSeconds + 1 / options.frameRate)
            || !Number.isSafeInteger(info.bytes) || info.bytes < 1 || info.bytes > MOTION_VIDEO_LIMITS.sourceBytes) return { ok: false, code: 'invalid-input' };
        emit({ stage: 'analysing', value: .05 });
        const result = await processor.process({ sourceUri, options, ...(range ? { range } : {}), ...(preserveAlpha ? { alpha: true } : {}) }, controller.signal, emit);
        if (controller.signal.aborted) { if (result.ok && processor.release) await processor.release(result.value).catch(() => undefined); return { ok: false, code: 'cancelled' }; }
        if (!result.ok) return codes.has(result.code) ? result : { ok: false, code: 'write-failed' };
        const output = result.value;
        if (!output.uri.startsWith('file:') || !Number.isSafeInteger(output.bytes) || output.bytes < 1 || output.bytes > MOTION_VIDEO_LIMITS.outputBytes
            || !Number.isFinite(output.durationSeconds) || Math.abs(output.durationSeconds - outputDuration) > 1 / options.frameRate
            || output.height !== options.height || output.frameRate !== options.frameRate || output.videoCodec !== (preserveAlpha ? 'hvc1-alpha' : 'avc1')
            || info.hasAudio && output.audioCodec !== 'mp4a') {
            if (processor.release) await processor.release(output).catch(() => undefined); return { ok: false, code: 'write-failed' };
        }
        emit({ stage: 'encoding', value: 1 });
        return { ok: true, value: { ...output, sourceBaseFrame: (range?.fromSeconds ?? 0) * options.frameRate } };
    } catch {
        if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
        emit({ stage: 'recovering', value: last });
        await processor.recover().catch(() => undefined);
        return { ok: false, code: 'write-failed' };
    } finally { signal?.removeEventListener('abort', abort); }
}
