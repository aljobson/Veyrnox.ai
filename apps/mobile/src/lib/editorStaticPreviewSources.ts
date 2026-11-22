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

export type EditorStaticPreviewSourceDependencies = {
    resolve(api: Pick<ApiClient, 'request'>, media: Media, signal: AbortSignal): Promise<EditorMediaSource | null>;
    decode(uri: string, signal: AbortSignal): Promise<SkImage | null>;
};

export type EditorStaticPreviewSourceRequest = {
    readonly plan: EditorPreviewPlan;
    readonly timeline: Timeline;
    readonly api: Pick<ApiClient, 'request'>;
    readonly localMediaUris: Readonly<Record<string, string>>;
};

type SourceTaskResult =
    | { readonly image: { readonly mediaId: string; readonly image: SkImage } }
    | { readonly issue: EditorStaticPreviewSourceIssue }
    | { readonly stale: true };

/**
 * The default Skia decoder cannot subsample encoded input. Trusted media metadata therefore
 * gates native decode, and decoded dimensions are checked again before a handle is exposed.
 * The second check catches bad metadata but cannot undo a transient decode allocation; callers
 * must not bypass the metadata gate until the decoder can resize before allocating full pixels.
 */
export const EDITOR_STATIC_PREVIEW_SOURCE_LIMITS = Object.freeze({
    maxEdge: 2_048,
    maxPixels: 2_048 * 2_048,
    maxActivePixels: 3 * 2_048 * 2_048,
});

function sourceDimensionIssue(width: number | undefined, height: number | undefined): 'source-dimensions-unavailable' | 'source-too-large' | null {
    if (!Number.isFinite(width) || !Number.isFinite(height) || Number(width) <= 0 || Number(height) <= 0) return 'source-dimensions-unavailable';
    if (Number(width) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEdge || Number(height) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEdge
        || Number(width) * Number(height) > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxPixels) return 'source-too-large';
    return null;
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

const abortError = () => Object.assign(new Error('Static preview source load cancelled.'), { name: 'AbortError' });
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

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
            const activePixels = required.reduce((total, requirement) => {
                const media = request.timeline.media[requirement.mediaId];
                return media?.kind === 'image' && !sourceDimensionIssue(media.width, media.height)
                    ? total + Number(media.width) * Number(media.height) : total;
            }, 0);
            if (activePixels > EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxActivePixels) {
                if (controller === nextController) controller = null;
                const firstImage = required.find(requirement => request.timeline.media[requirement.mediaId]?.kind === 'image') ?? required[0];
                return { status: 'unsupported', issues: firstImage ? [{ ...firstImage, code: 'source-budget-exceeded' }] : [] };
            }
            const tasks = required.map(async (requirement): Promise<SourceTaskResult> => {
                const media = request.timeline.media[requirement.mediaId];
                if (!media) return { issue: { ...requirement, code: 'missing-media' as const } };
                if (media.kind === 'graphic') return { issue: { ...requirement, code: 'graphic-unsupported' as const } };
                if (media.kind !== 'image') return { issue: { ...requirement, code: 'unsupported-media-kind' as const } };
                const dimensionIssue = sourceDimensionIssue(media.width, media.height);
                if (dimensionIssue) return { issue: { ...requirement, code: dimensionIssue } };
                try {
                    const local = request.localMediaUris[requirement.mediaId];
                    const source = local ? { uri: local, kind: 'image' as const }
                        : await dependencies.resolve(request.api, media, nextController.signal);
                    if (ticket !== generation || nextController.signal.aborted) return { stale: true as const };
                    if (!source || source.kind !== 'image') return { issue: { ...requirement, code: 'source-unavailable' as const } };
                    const image = await dependencies.decode(source.uri, nextController.signal);
                    if (!image) return { issue: { ...requirement, code: 'decode-failed' as const } };
                    const decodedDimensionIssue = sourceDimensionIssue(image.width(), image.height());
                    if (decodedDimensionIssue) {
                        image.dispose();
                        return { issue: { ...requirement, code: decodedDimensionIssue } };
                    }
                    return { image: { mediaId: requirement.mediaId, image } };
                } catch (error) {
                    if (ticket !== generation || nextController.signal.aborted || isAbort(error)) return { stale: true as const };
                    return { issue: { ...requirement, code: 'decode-failed' as const } };
                }
            });
            const results = await Promise.all(tasks);
            const images = results.flatMap(result => 'image' in result ? [result.image] : []);
            if (ticket !== generation || nextController.signal.aborted || results.some(result => 'stale' in result)) {
                ownedSources(key, images).dispose();
                return { status: 'stale' };
            }
            if (controller === nextController) controller = null;
            const issues = results.flatMap(result => 'issue' in result ? [result.issue] : []);
            if (issues.length) {
                ownedSources(key, images).dispose();
                return { status: 'unsupported', issues };
            }
            return { status: 'ready', sources: ownedSources(key, images) };
        },
        cancel: invalidate,
        dispose: invalidate,
    };
}
