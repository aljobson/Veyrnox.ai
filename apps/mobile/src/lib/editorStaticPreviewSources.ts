import type { SkImage } from '@shopify/react-native-skia';
import type { ApiClient } from './api';
import type { EditorPreviewPlan } from './editorPreviewPlan';
import { resolveEditorMediaSource, type EditorMediaSource } from './editorPreview';
import type { Media, Timeline } from './nativeEditorModel';

declare const require: (id: string) => unknown;

export type EditorStaticPreviewSourceUsage = 'foreground' | 'background';
export type EditorStaticPreviewSourceRequirement = {
    readonly mediaId: string;
    readonly usages: readonly EditorStaticPreviewSourceUsage[];
};
export type EditorStaticPreviewSourceIssueCode =
    | 'decode-failed'
    | 'graphic-unsupported'
    | 'missing-media'
    | 'source-budget-exceeded'
    | 'source-dimensions-unavailable'
    | 'source-encoded-too-large'
    | 'source-header-unsupported'
    | 'source-probe-failed'
    | 'source-too-large'
    | 'source-unavailable'
    | 'unsupported-media-kind';
export type EditorStaticPreviewSourceIssue = {
    readonly mediaId: string;
    readonly code: EditorStaticPreviewSourceIssueCode;
    readonly usages: readonly EditorStaticPreviewSourceUsage[];
};

export type EditorStaticPreviewSourceSet = {
    /** Caller-owned until `dispose` is called. The renderer only borrows these handles. */
    readonly images: Readonly<Record<string, SkImage>>;
    readonly key: string;
    dispose(): void;
};

export type EditorStaticPreviewSourceLoadResult =
    | { readonly status: 'ready'; readonly sources: EditorStaticPreviewSourceSet }
    | { readonly status: 'unsupported'; readonly issues: readonly EditorStaticPreviewSourceIssue[] }
    | { readonly status: 'stale' };

export type EditorStaticPreviewEncodedProbeResult =
    | { readonly ok: true; readonly encodedBytes: number; readonly width: number; readonly height: number }
    | { readonly ok: false; readonly code: 'source-encoded-too-large' | 'source-header-unsupported' | 'source-probe-failed' };

export type EditorStaticPreviewSourceDependencies = {
    resolve(api: Pick<ApiClient, 'request'>, media: Media, signal: AbortSignal): Promise<EditorMediaSource | null>;
    probe(uri: string, signal: AbortSignal): Promise<EditorStaticPreviewEncodedProbeResult>;
    decode(uri: string, signal: AbortSignal): Promise<SkImage | null>;
};

export type EditorStaticPreviewSourceRequest = {
    readonly plan: EditorPreviewPlan;
    readonly timeline: Timeline;
    readonly api: Pick<ApiClient, 'request'>;
    readonly localMediaUris: Readonly<Record<string, string>>;
};

type ProbedSource = {
    readonly requirement: EditorStaticPreviewSourceRequirement;
    readonly uri: string;
    readonly width: number;
    readonly height: number;
};
type ProbeTaskResult =
    | { readonly source: ProbedSource }
    | { readonly issue: EditorStaticPreviewSourceIssue }
    | { readonly stale: true };
type DecodeTaskResult =
    | { readonly image: { readonly mediaId: string; readonly image: SkImage } }
    | { readonly issue: EditorStaticPreviewSourceIssue }
    | { readonly stale: true };

/**
 * The default Skia decoder cannot subsample encoded input. A bounded encoded-header probe gates
 * native decode without trusting timeline metadata, and decoded dimensions are checked again
 * before a handle is exposed. Only the explicitly supported headers below are admitted.
 */
export const EDITOR_STATIC_PREVIEW_SOURCE_LIMITS = Object.freeze({
    maxEdge: 2_048,
    maxPixels: 2_048 * 2_048,
    maxActivePixels: 3 * 2_048 * 2_048,
    maxEncodedBytes: 16 * 1_024 * 1_024,
    probeBytes: 64 * 1_024,
});

function sourceDimensionIssue(width: number | undefined, height: number | undefined): 'source-dimensions-unavailable' | 'source-too-large' | null {
    if (!Number.isFinite(width) || !Number.isFinite(height) || Number(width) <= 0 || Number(height) <= 0) return 'source-dimensions-unavailable';
    if (Number(width) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEdge || Number(height) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEdge
        || Number(width) * Number(height) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxPixels) return 'source-too-large';
    return null;
}

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
const u16be = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 256;
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
const u32be = (bytes: Uint8Array, offset: number) => bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];

function encodedImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (bytes.length >= 24 && ascii(bytes, 0, 8) === '\u0089PNG\r\n\u001a\n' && ascii(bytes, 12, 4) === 'IHDR') {
        return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
    }
    if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
        return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
    }
    if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
        const kind = ascii(bytes, 12, 4);
        if (kind === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
        if (kind === 'VP8 ' && ascii(bytes, 23, 3) === '\u009d\u0001\u002a') return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
        if (kind === 'VP8L' && bytes[20] === 0x2f) return {
            width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
            height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
        };
    }
    if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
        let offset = 2;
        while (offset + 3 < bytes.length) {
            if (bytes[offset++] !== 0xff) return null;
            while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
            const marker = bytes[offset++];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) return null;
            const length = u16be(bytes, offset);
            if (length < 2 || offset + length > bytes.length) return null;
            if (sof.has(marker)) return length >= 7 ? { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) } : null;
            offset += length;
        }
    }
    return null;
}

const abortError = () => Object.assign(new Error('Static preview source load cancelled.'), { name: 'AbortError' });
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

async function probeLocalEncodedSource(uri: string, signal: AbortSignal): Promise<EditorStaticPreviewEncodedProbeResult> {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(uri);
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 1) return { ok: false, code: 'source-probe-failed' };
    if (file.size > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEncodedBytes) return { ok: false, code: 'source-encoded-too-large' };
    if (signal.aborted) throw abortError();
    const handle = file.open();
    try {
        const expected = Math.min(file.size, EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes);
        const bytes = await handle.readBytes(expected);
        if (signal.aborted) throw abortError();
        if (bytes.length !== expected) return { ok: false, code: 'source-probe-failed' };
        const dimensions = encodedImageDimensions(bytes);
        return dimensions ? { ok: true, encodedBytes: file.size, ...dimensions } : { ok: false, code: 'source-header-unsupported' };
    } finally { handle.close(); }
}

async function probeRemoteEncodedSource(uri: string, signal: AbortSignal): Promise<EditorStaticPreviewEncodedProbeResult> {
    const { fetch: streamFetch } = require('expo/fetch') as typeof import('expo/fetch');
    const last = EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes - 1;
    const response = await streamFetch(uri, { headers: { Range: `bytes=0-${last}` }, signal });
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'source-probe-failed' };
    try {
        const match = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (response.status !== 206 || !match) return { ok: false, code: 'source-probe-failed' };
        const end = Number(match[1]), total = Number(match[2]);
        if (!Number.isSafeInteger(end) || !Number.isSafeInteger(total) || total < 1 || end + 1 !== Math.min(total, EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes)) {
            return { ok: false, code: 'source-probe-failed' };
        }
        if (total > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEncodedBytes) return { ok: false, code: 'source-encoded-too-large' };
        const bytes = new Uint8Array(end + 1); let offset = 0;
        for (;;) {
            if (signal.aborted) throw abortError();
            const chunk = await reader.read();
            if (chunk.done) break;
            if (offset + chunk.value.length > bytes.length) return { ok: false, code: 'source-probe-failed' };
            bytes.set(chunk.value, offset); offset += chunk.value.length;
        }
        if (offset !== bytes.length) return { ok: false, code: 'source-probe-failed' };
        const dimensions = encodedImageDimensions(bytes);
        return dimensions ? { ok: true, encodedBytes: total, ...dimensions } : { ok: false, code: 'source-header-unsupported' };
    } finally { await reader.cancel().catch(() => undefined); }
}

/** Range/stat probe that never admits an unbounded encoded payload to the native image decoder. */
export async function probeEditorStaticPreviewEncodedSource(uri: string, signal: AbortSignal): Promise<EditorStaticPreviewEncodedProbeResult> {
    try { return /^https?:\/\//i.test(uri) ? await probeRemoteEncodedSource(uri, signal) : await probeLocalEncodedSource(uri, signal); }
    catch (error) {
        if (signal.aborted || isAbort(error)) throw abortError();
        return { ok: false, code: 'source-probe-failed' };
    }
}

/** Collect only media used by the canonical active visual layers, in paint order. */
export function requiredEditorStaticPreviewSources(plan: EditorPreviewPlan): EditorStaticPreviewSourceRequirement[] {
    const required = new Map<string, Set<EditorStaticPreviewSourceUsage>>();
    const add = (mediaId: string | undefined, usage: EditorStaticPreviewSourceUsage) => {
        if (!mediaId) return;
        const usages = required.get(mediaId) ?? new Set<EditorStaticPreviewSourceUsage>();
        usages.add(usage); required.set(mediaId, usages);
    };
    for (const visual of plan.visuals) {
        add(visual.clip.mediaId, 'foreground');
        if (visual.clip.background?.type === 'image') add(visual.clip.background.mediaId, 'background');
    }
    return [...required].map(([mediaId, usages]) => ({ mediaId, usages: [...usages] }));
}

/** Stable identity for avoiding a reload while the active inputs and their source locations are unchanged. */
export function editorStaticPreviewSourceKey(plan: EditorPreviewPlan, timeline: Timeline, localMediaUris: Readonly<Record<string, string>>): string {
    return JSON.stringify(requiredEditorStaticPreviewSources(plan).map(requirement => {
        const media = timeline.media[requirement.mediaId], local = localMediaUris[requirement.mediaId];
        return [requirement.mediaId, requirement.usages, media?.kind ?? '', media?.width ?? 0, media?.height ?? 0,
            local ?? '', media?.assetSource?.projectId ?? '', media?.assetSource?.assetId ?? ''];
    }));
}

async function decodeWithSkia(uri: string, signal: AbortSignal): Promise<SkImage | null> {
    if (signal.aborted) throw abortError();
    const module = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const data = await module.Skia.Data.fromURI(uri);
    try {
        if (signal.aborted) throw abortError();
        const image = module.Skia.Image.MakeImageFromEncoded(data);
        if (signal.aborted) { image?.dispose(); throw abortError(); }
        return image;
    } finally { data.dispose(); }
}

const defaultDependencies: EditorStaticPreviewSourceDependencies = {
    resolve: (api, media, signal) => resolveEditorMediaSource(api, media, signal),
    probe: probeEditorStaticPreviewEncodedSource,
    decode: decodeWithSkia,
};

function ownedSources(key: string, values: readonly { mediaId: string; image: SkImage }[]): EditorStaticPreviewSourceSet {
    const images = Object.fromEntries(values.map(value => [value.mediaId, value.image])) as Record<string, SkImage>;
    let disposed = false;
    return {
        images, key,
        dispose() {
            if (disposed) return;
            disposed = true;
            new Set(Object.values(images)).forEach(image => image.dispose());
        },
    };
}

/**
 * One generation may be pending at a time. Starting or cancelling a load invalidates the old
 * generation; any images it eventually decodes are disposed before that call returns `stale`.
 * Ready image sets are transferred to the caller and are never retained by this loader.
 */
export function createEditorStaticPreviewSourceLoader(dependencies: EditorStaticPreviewSourceDependencies = defaultDependencies) {
    let generation = 0, controller: AbortController | null = null;
    const invalidate = () => { generation += 1; controller?.abort(); controller = null; };
    return {
        async load(request: EditorStaticPreviewSourceRequest): Promise<EditorStaticPreviewSourceLoadResult> {
            invalidate();
            const ticket = generation, nextController = new AbortController(); controller = nextController;
            const required = requiredEditorStaticPreviewSources(request.plan);
            const key = editorStaticPreviewSourceKey(request.plan, request.timeline, request.localMediaUris);
            const probeTasks = required.map(async (requirement): Promise<ProbeTaskResult> => {
                const media = request.timeline.media[requirement.mediaId];
                if (!media) return { issue: { ...requirement, code: 'missing-media' as const } };
                if (media.kind === 'graphic') return { issue: { ...requirement, code: 'graphic-unsupported' as const } };
                if (media.kind !== 'image') return { issue: { ...requirement, code: 'unsupported-media-kind' as const } };
                let source: EditorMediaSource | null;
                try {
                    const local = request.localMediaUris[requirement.mediaId];
                    source = local ? { uri: local, kind: 'image' as const }
                        : await dependencies.resolve(request.api, media, nextController.signal);
                } catch (error) {
                    if (ticket !== generation || nextController.signal.aborted || isAbort(error)) return { stale: true as const };
                    return { issue: { ...requirement, code: 'source-unavailable' as const } };
                }
                if (ticket !== generation || nextController.signal.aborted) return { stale: true as const };
                if (!source || source.kind !== 'image') return { issue: { ...requirement, code: 'source-unavailable' as const } };
                try {
                    const probe = await dependencies.probe(source.uri, nextController.signal);
                    if (ticket !== generation || nextController.signal.aborted) return { stale: true as const };
                    if (!probe.ok) return { issue: { ...requirement, code: probe.code } };
                    const dimensionIssue = sourceDimensionIssue(probe.width, probe.height);
                    if (dimensionIssue) return { issue: { ...requirement, code: dimensionIssue } };
                    return { source: { requirement, uri: source.uri, width: probe.width, height: probe.height } };
                } catch (error) {
                    if (ticket !== generation || nextController.signal.aborted || isAbort(error)) return { stale: true as const };
                    return { issue: { ...requirement, code: 'source-probe-failed' as const } };
                }
            });
            const probed = await Promise.all(probeTasks);
            if (ticket !== generation || nextController.signal.aborted || probed.some(result => 'stale' in result)) return { status: 'stale' };
            const probeIssues = probed.flatMap(result => 'issue' in result ? [result.issue] : []);
            if (probeIssues.length) {
                if (controller === nextController) controller = null;
                return { status: 'unsupported', issues: probeIssues };
            }
            const sources = probed.flatMap(result => 'source' in result ? [result.source] : []);
            const activePixels = sources.reduce((total, source) => total + source.width * source.height, 0);
            if (activePixels > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxActivePixels) {
                if (controller === nextController) controller = null;
                return { status: 'unsupported', issues: sources[0]
                    ? [{ ...sources[0].requirement, code: 'source-budget-exceeded' }] : [] };
            }
            const decodeTasks = sources.map(async (source): Promise<DecodeTaskResult> => {
                try {
                    const image = await dependencies.decode(source.uri, nextController.signal);
                    if (!image) return { issue: { ...source.requirement, code: 'decode-failed' as const } };
                    const decodedDimensionIssue = sourceDimensionIssue(image.width(), image.height());
                    if (decodedDimensionIssue) {
                        image.dispose();
                        return { issue: { ...source.requirement, code: decodedDimensionIssue } };
                    }
                    return { image: { mediaId: source.requirement.mediaId, image } };
                } catch (error) {
                    if (ticket !== generation || nextController.signal.aborted || isAbort(error)) return { stale: true as const };
                    return { issue: { ...source.requirement, code: 'decode-failed' as const } };
                }
            });
            const decoded = await Promise.all(decodeTasks);
            const images = decoded.flatMap(result => 'image' in result ? [result.image] : []);
            if (ticket !== generation || nextController.signal.aborted || decoded.some(result => 'stale' in result)) {
                ownedSources(key, images).dispose();
                return { status: 'stale' };
            }
            if (controller === nextController) controller = null;
            const decodeIssues = decoded.flatMap(result => 'issue' in result ? [result.issue] : []);
            if (decodeIssues.length) { ownedSources(key, images).dispose(); return { status: 'unsupported', issues: decodeIssues }; }
            return { status: 'ready', sources: ownedSources(key, images) };
        },
        cancel: invalidate,
        dispose: invalidate,
    };
}
