import type { SkImage } from '@shopify/react-native-skia';
import { CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES } from './editorLocalExport';
import { createNativeEditorCompositor, type NativeEditorCompositor } from './editorCompositorNative';
import { editorPreviewPlan, type EditorPreviewCapability, type EditorPreviewPlan } from './editorPreviewPlan';
import type { Timeline } from './nativeEditorModel';

declare const require: (id: string) => unknown;

export type EditorNativePreviewRequest = {
    readonly account: string;
    readonly project: string;
    readonly timeline: Timeline;
    readonly frame: number;
    readonly width: number;
    readonly height: number;
    readonly sources: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
};

export type EditorNativePreviewResult =
    | { readonly ok: true; readonly image: SkImage; readonly plan: EditorPreviewPlan }
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-input' | 'unsupported' | 'source-unavailable' | 'compositor-unavailable' | 'decode-failed';
        readonly capabilities?: readonly EditorPreviewCapability[] };

export type EditorNativePreviewDependencies = {
    readonly compositor: NativeEditorCompositor;
    readonly bytes: (uri: string) => Promise<Uint8Array>;
    readonly makeImage: (bytes: Uint8Array, width: number, height: number, stride: number) => SkImage | null;
};

function requiredSources(plan: EditorPreviewPlan) {
    const values = new Set<string>();
    for (const visual of plan.visuals) {
        if (visual.media && visual.media.kind !== 'graphic' && visual.clip.mediaId) values.add(visual.clip.mediaId);
        if (visual.clip.background?.type === 'image') values.add(visual.clip.background.mediaId);
        if (visual.clip.semanticMask) values.add(visual.clip.semanticMask.mediaId);
    }
    for (const text of plan.texts) if (text.customFont) values.add(text.customFont.family);
    return [...values];
}

function defaults(request: EditorNativePreviewRequest): EditorNativePreviewDependencies {
    const skia = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const files = require('expo-file-system') as typeof import('expo-file-system');
    return {
        compositor: createNativeEditorCompositor(request.account, request.project, request.sources),
        bytes: uri => new files.File(uri).bytes(),
        makeImage(bytes, width, height, stride) {
            const data = skia.Skia.Data.fromBytes(bytes);
            try {
                return skia.Skia.Image.MakeImage({ width, height, colorType: skia.ColorType.RGBA_8888,
                    alphaType: skia.AlphaType.Premul }, data, stride);
            } finally { data.dispose(); }
        },
    };
}

/**
 * Renders one exact canonical editor frame through the same native compositor used by local
 * export. The raw S9 frame is always discarded after Skia copies it, including failure paths.
 */
export async function renderNativeEditorPreviewFrame(request: EditorNativePreviewRequest,
    dependencies?: EditorNativePreviewDependencies): Promise<EditorNativePreviewResult> {
    if (request.signal.aborted) return { ok: false, code: 'cancelled' };
    if (!Number.isSafeInteger(request.frame) || request.frame < 0 || !Number.isSafeInteger(request.width) || request.width < 1
        || request.width > 1280 || !Number.isSafeInteger(request.height) || request.height < 1 || request.height > 1280
        || request.width * request.height > 1280 * 720) return { ok: false, code: 'invalid-input' };
    const plan = editorPreviewPlan(request.timeline, request.frame, CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES);
    if (!plan.capabilities.exact) return { ok: false, code: 'unsupported', capabilities: [
        ...new Set(plan.capabilities.unsupported.map(value => value.capability)),
    ] };
    if (requiredSources(plan).some(id => !request.sources[id])) return { ok: false, code: 'source-unavailable' };
    let runtime: EditorNativePreviewDependencies;
    try { runtime = dependencies ?? defaults(request); }
    catch { return { ok: false, code: 'compositor-unavailable' }; }
    let descriptor: Awaited<ReturnType<NativeEditorCompositor>> | null = null;
    try {
        descriptor = await runtime.compositor({ plan, index: request.frame,
            timestampUs: Math.round(request.frame * 1_000_000 / request.timeline.fps),
            width: request.width, height: request.height }, request.signal);
        if (request.signal.aborted) return { ok: false, code: 'cancelled' };
        const bytes = await runtime.bytes(descriptor.uri);
        if (request.signal.aborted) return { ok: false, code: 'cancelled' };
        if (bytes.byteLength !== descriptor.byteLength) return { ok: false, code: 'decode-failed' };
        const image = runtime.makeImage(bytes, descriptor.width, descriptor.height, descriptor.stride);
        if (!image) return { ok: false, code: 'decode-failed' };
        if (request.signal.aborted) { image.dispose(); return { ok: false, code: 'cancelled' }; }
        return { ok: true, image, plan };
    } catch (error) {
        return { ok: false, code: request.signal.aborted || (error instanceof Error && error.name === 'AbortError')
            ? 'cancelled' : 'compositor-unavailable' };
    } finally {
        if (descriptor) runtime.compositor.discard([descriptor]);
    }
}
