import type { SkImage } from '@shopify/react-native-skia';
import {
    createEditorStaticPreviewSourceLoader,
    EDITOR_STATIC_PREVIEW_SOURCE_LIMITS,
    editorStaticPreviewSourceKey,
    requiredEditorStaticPreviewSources,
    type EditorStaticPreviewSourceDependencies,
} from '../src/lib/editorStaticPreviewSources';
import type { EditorPreviewPlan, EditorPreviewVisualPlan } from '../src/lib/editorPreviewPlan';
import { emptyTimeline, type Media, type Timeline } from '../src/lib/nativeEditorModel';

const deferred = <T,>() => {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const image = (name: string, width = 640, height = 360) => ({ name, width: () => width, height: () => height, dispose: jest.fn() }) as unknown as SkImage;
const media = (id: string, patch: Partial<Media> = {}): Media => ({ id, kind: 'image', frames: 90, name: id, hasAudio: false, width: 640, height: 360, ...patch });
const visual = (id: string, mediaId: string, backgroundId?: string) => ({
    layerIndex: 0, clip: { id, mediaId, start: 0, len: 90, trackId: 'video-0', ...(backgroundId ? { background: { type: 'image', color: '#000000', blur: 0, mediaId: backgroundId } } : {}) },
    media: media(mediaId), sourceIndex: 0, sourceTimeSeconds: 0, offset: 0,
    transform: { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
    reveal: { x: 0, y: 0, width: 1, height: 1 }, filter: { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0 }, colour: {}, mask: null,
    crop: { x: 0, y: 0, width: 1, height: 1 }, fit: 'contain', blend: 'source-over', transition: null,
}) as unknown as EditorPreviewVisualPlan;
const plan = (...visuals: EditorPreviewVisualPlan[]): EditorPreviewPlan => ({
    frame: 0, background: '#000000', visuals, texts: [], capabilities: { exact: true, requirements: [], unsupported: [] },
});
const timeline = (entries: Media[]): Timeline => ({ ...emptyTimeline(), media: Object.fromEntries(entries.map(entry => [entry.id, entry])) });
const request = (preview: EditorPreviewPlan, tl: Timeline, localMediaUris: Record<string, string> = {}) => ({
    plan: preview, timeline: tl, localMediaUris, api: { request: jest.fn() },
});
const dependencies = (decode: EditorStaticPreviewSourceDependencies['decode'] = async (uri: string) => image(uri)): EditorStaticPreviewSourceDependencies & {
    resolve: jest.Mock; decode: jest.Mock;
} => ({
    resolve: jest.fn(async (_api, item: Media) => ({ uri: `https://signed.example/${item.id}`, kind: 'image' as const })),
    decode: jest.fn(decode),
}) as EditorStaticPreviewSourceDependencies & { resolve: jest.Mock; decode: jest.Mock };

test('collects only active foreground and image-background ids in paint order and deduplicates roles', () => {
    const preview = plan(visual('v1', 'same', 'back'), visual('v2', 'other', 'same'), visual('v3', 'same', 'back'));
    expect(requiredEditorStaticPreviewSources(preview)).toEqual([
        { mediaId: 'same', usages: ['foreground', 'background'] },
        { mediaId: 'back', usages: ['background'] },
        { mediaId: 'other', usages: ['foreground'] },
    ]);
    const tl = timeline([media('same'), media('back'), media('other'), media('unused')]);
    expect(editorStaticPreviewSourceKey(preview, tl, { same: 'file:///same.png' })).toContain('file:///same.png');
    expect(editorStaticPreviewSourceKey(preview, tl, {})).not.toContain('unused');
});

test('prefers a local uri, decodes each deduplicated active source once and transfers disposal to the caller', async () => {
    const deps = dependencies(), loader = createEditorStaticPreviewSourceLoader(deps);
    const preview = plan(visual('v1', 'photo', 'photo'), visual('v2', 'photo'));
    const result = await loader.load(request(preview, timeline([media('photo')]), { photo: 'file:///picked.png' }));
    expect(result.status).toBe('ready');
    expect(deps.resolve).not.toHaveBeenCalled(); expect(deps.decode).toHaveBeenCalledTimes(1); expect(deps.decode).toHaveBeenCalledWith('file:///picked.png', expect.any(AbortSignal));
    if (result.status !== 'ready') throw Error('ready');
    const handle = result.sources.images.photo as unknown as { dispose: jest.Mock };
    expect(handle).toBeDefined(); result.sources.dispose(); result.sources.dispose(); expect(handle.dispose).toHaveBeenCalledTimes(1);
});

test('resolves a signed asset source only when no local uri exists', async () => {
    const deps = dependencies(), loader = createEditorStaticPreviewSourceLoader(deps);
    const asset = media('asset', { assetSource: { projectId: 'project', assetId: 'file' } });
    const result = await loader.load(request(plan(visual('v1', 'asset')), timeline([asset])));
    expect(result.status).toBe('ready'); expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(deps.resolve.mock.calls[0][1]).toBe(asset); expect(deps.decode).toHaveBeenCalledWith('https://signed.example/asset', expect.any(AbortSignal));
    if (result.status === 'ready') result.sources.dispose();
});

test('a newer generation aborts the old one and disposes its stale late image', async () => {
    const late = deferred<SkImage | null>(), staleImage = image('stale'), freshImage = image('fresh');
    const decode = jest.fn((uri: string) => uri.includes('old') ? late.promise : Promise.resolve(freshImage));
    const deps = dependencies(decode), loader = createEditorStaticPreviewSourceLoader(deps);
    const old = loader.load(request(plan(visual('v1', 'old')), timeline([media('old')]), { old: 'file:///old.png' }));
    await Promise.resolve();
    const currentPromise = loader.load(request(plan(visual('v2', 'new')), timeline([media('new')]), { new: 'file:///new.png' }));
    const current = await currentPromise; expect(current.status).toBe('ready');
    late.resolve(staleImage);
    await expect(old).resolves.toEqual({ status: 'stale' });
    expect((staleImage as unknown as { dispose: jest.Mock }).dispose).toHaveBeenCalledTimes(1);
    expect((freshImage as unknown as { dispose: jest.Mock }).dispose).not.toHaveBeenCalled();
    if (current.status === 'ready') current.sources.dispose();
});

test('cancel invalidates pending work and disposes a completion that ignores abort', async () => {
    const late = deferred<SkImage | null>(), decoded = image('cancelled'), deps = dependencies(jest.fn(() => late.promise));
    const loader = createEditorStaticPreviewSourceLoader(deps);
    const loading = loader.load(request(plan(visual('v1', 'photo')), timeline([media('photo')]), { photo: 'file:///photo.png' }));
    await Promise.resolve(); loader.cancel(); late.resolve(decoded);
    await expect(loading).resolves.toEqual({ status: 'stale' });
    expect((decoded as unknown as { dispose: jest.Mock }).dispose).toHaveBeenCalledTimes(1);
});

test('fails closed for graphics, missing media, video and decode failures without preloading unrelated media', async () => {
    const deps = dependencies(jest.fn(async () => null)), loader = createEditorStaticPreviewSourceLoader(deps);
    const tl = timeline([
        media('graphic', { kind: 'graphic' }), media('video', { kind: 'video' }), media('broken'), media('unused'),
    ]);
    const result = await loader.load(request(plan(
        visual('v1', 'graphic'), visual('v2', 'missing'), visual('v3', 'video'), visual('v4', 'broken'),
    ), tl));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'graphic', usages: ['foreground'], code: 'graphic-unsupported' },
        { mediaId: 'missing', usages: ['foreground'], code: 'missing-media' },
        { mediaId: 'video', usages: ['foreground'], code: 'unsupported-media-kind' },
        { mediaId: 'broken', usages: ['foreground'], code: 'decode-failed' },
    ] });
    expect(deps.resolve.mock.calls.map((call: unknown[]) => (call[1] as Media).id)).toEqual(['broken']);
    expect(deps.resolve.mock.calls.flat().some((value: unknown) => value === tl.media.unused)).toBe(false);
});

test('rejects oversized or unknown trusted dimensions before resolution or native decode', async () => {
    const deps = dependencies(), loader = createEditorStaticPreviewSourceLoader(deps);
    const result = await loader.load(request(plan(
        visual('v1', 'huge'), visual('v2', 'unknown'),
    ), timeline([
        media('huge', { width: 16_384, height: 16_384 }), media('unknown', { width: 0, height: 0 }),
    ])));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'huge', usages: ['foreground'], code: 'source-too-large' },
        { mediaId: 'unknown', usages: ['foreground'], code: 'source-dimensions-unavailable' },
    ] });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.decode).not.toHaveBeenCalled();
});

test('disposes a decoded image when encoded dimensions contradict trusted metadata', async () => {
    const oversized = image('oversized', EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEdge + 1, 640);
    const deps = dependencies(async () => oversized), loader = createEditorStaticPreviewSourceLoader(deps);
    const result = await loader.load(request(plan(visual('v1', 'photo')), timeline([media('photo')])));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'photo', usages: ['foreground'], code: 'source-too-large' },
    ] });
    expect((oversized as unknown as { dispose: jest.Mock }).dispose).toHaveBeenCalledTimes(1);
});

test('rejects an over-budget active image set before starting any source work', async () => {
    const deps = dependencies(), loader = createEditorStaticPreviewSourceLoader(deps);
    const ids = ['one', 'two', 'three', 'four'];
    const result = await loader.load(request(
        plan(...ids.map((id, index) => visual(`v${index}`, id))),
        timeline(ids.map(id => media(id, { width: 2_048, height: 2_048 }))),
    ));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'one', usages: ['foreground'], code: 'source-budget-exceeded' },
    ] });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.decode).not.toHaveBeenCalled();
});
