import type { SkImage } from '@shopify/react-native-skia';
import {
    createEditorStaticPreviewSourceLoader,
    EDITOR_STATIC_PREVIEW_SOURCE_LIMITS,
    editorStaticPreviewSourceKey,
    probeEditorStaticPreviewEncodedSource,
    requiredEditorStaticPreviewSources,
    type EditorStaticPreviewSourceDependencies,
} from '../src/lib/editorStaticPreviewSources';
import type { EditorPreviewPlan, EditorPreviewVisualPlan } from '../src/lib/editorPreviewPlan';
import { emptyTimeline, type Media, type Timeline } from '../src/lib/nativeEditorModel';

const mockProbeFiles = new Map<string, { bytes: Uint8Array; size: number }>();
const mockProbeCloses: string[] = [];
const mockProbeFetch = jest.fn();
jest.mock('expo-file-system', () => ({
    File: class {
        readonly uri: string;
        constructor(uri: string) { this.uri = uri; }
        get exists() { return mockProbeFiles.has(this.uri); }
        get size() { return mockProbeFiles.get(this.uri)?.size ?? 0; }
        open() {
            const uri = this.uri;
            return {
                readBytes: async (count: number) => (mockProbeFiles.get(uri)?.bytes ?? new Uint8Array()).slice(0, count),
                close: () => { mockProbeCloses.push(uri); },
            };
        }
    },
}));
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockProbeFetch(...args) }));

const deferred = <T,>() => {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const image = (name: string, width = 640, height = 360) => ({ name, width: () => width, height: () => height, dispose: jest.fn() }) as unknown as SkImage;
const png = (width: number, height: number, bytes = 128) => {
    const value = new Uint8Array(bytes);
    value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    value.set([0x49, 0x48, 0x44, 0x52], 12);
    const u32 = (offset: number, number: number) => value.set([(number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255], offset);
    u32(16, width); u32(20, height); return value;
};
const ranged = (body: Uint8Array, total = body.length, status = 206) => {
    const reader = { read: jest.fn().mockResolvedValueOnce({ done: false, value: body }).mockResolvedValueOnce({ done: true }), cancel: jest.fn(async () => {}) };
    return { reader, response: { status, headers: { get: (name: string) => name.toLowerCase() === 'content-range'
        ? `bytes 0-${body.length - 1}/${total}` : null }, body: { getReader: () => reader } } };
};
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
const dependencies = (decode: EditorStaticPreviewSourceDependencies['decode'] = async (uri: string) => image(uri),
    probe: EditorStaticPreviewSourceDependencies['probe'] = async () => ({ ok: true, encodedBytes: 1_024, width: 640, height: 360 })):
    EditorStaticPreviewSourceDependencies & { resolve: jest.Mock; probe: jest.Mock; decode: jest.Mock;
} => ({
    resolve: jest.fn(async (_api, item: Media) => ({ uri: `https://signed.example/${item.id}`, kind: 'image' as const })),
    probe: jest.fn(probe),
    decode: jest.fn(decode),
}) as EditorStaticPreviewSourceDependencies & { resolve: jest.Mock; probe: jest.Mock; decode: jest.Mock };

beforeEach(() => { mockProbeFiles.clear(); mockProbeCloses.length = 0; mockProbeFetch.mockReset(); });

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
    const late = deferred<SkImage | null>(), oldDecodeStarted = deferred<void>(), staleImage = image('stale'), freshImage = image('fresh');
    const decode = jest.fn((uri: string) => { if (uri.includes('old')) { oldDecodeStarted.resolve(); return late.promise; } return Promise.resolve(freshImage); });
    const deps = dependencies(decode), loader = createEditorStaticPreviewSourceLoader(deps);
    const old = loader.load(request(plan(visual('v1', 'old')), timeline([media('old')]), { old: 'file:///old.png' }));
    await oldDecodeStarted.promise;
    const currentPromise = loader.load(request(plan(visual('v2', 'new')), timeline([media('new')]), { new: 'file:///new.png' }));
    const current = await currentPromise; expect(current.status).toBe('ready');
    late.resolve(staleImage);
    await expect(old).resolves.toEqual({ status: 'stale' });
    expect((staleImage as unknown as { dispose: jest.Mock }).dispose).toHaveBeenCalledTimes(1);
    expect((freshImage as unknown as { dispose: jest.Mock }).dispose).not.toHaveBeenCalled();
    if (current.status === 'ready') current.sources.dispose();
});

test('cancel invalidates pending work and disposes a completion that ignores abort', async () => {
    const late = deferred<SkImage | null>(), decodeStarted = deferred<void>(), decoded = image('cancelled');
    const deps = dependencies(jest.fn(() => { decodeStarted.resolve(); return late.promise; }));
    const loader = createEditorStaticPreviewSourceLoader(deps);
    const loading = loader.load(request(plan(visual('v1', 'photo')), timeline([media('photo')]), { photo: 'file:///photo.png' }));
    await decodeStarted.promise; loader.cancel(); late.resolve(decoded);
    await expect(loading).resolves.toEqual({ status: 'stale' });
    expect((decoded as unknown as { dispose: jest.Mock }).dispose).toHaveBeenCalledTimes(1);
});

test('fails closed before decode when active sources include unsupported media and never preloads unrelated media', async () => {
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
    ] });
    expect(deps.resolve.mock.calls.map((call: unknown[]) => (call[1] as Media).id)).toEqual(['broken']);
    expect(deps.decode).not.toHaveBeenCalled();
    expect(deps.resolve.mock.calls.flat().some((value: unknown) => value === tl.media.unused)).toBe(false);
});

test('reports a decode failure after a source passes the encoded probe', async () => {
    const deps = dependencies(async () => null), loader = createEditorStaticPreviewSourceLoader(deps);
    const result = await loader.load(request(plan(visual('v1', 'broken')), timeline([media('broken')])));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'broken', usages: ['foreground'], code: 'decode-failed' },
    ] });
    expect(deps.probe).toHaveBeenCalledTimes(1); expect(deps.decode).toHaveBeenCalledTimes(1);
});

test('uses probed dimensions rather than trusting timeline metadata before native decode', async () => {
    const probe = jest.fn(async (uri: string) => uri.endsWith('/huge')
        ? { ok: true as const, encodedBytes: 1_024, width: 16_384, height: 16_384 }
        : { ok: true as const, encodedBytes: 1_024, width: 640, height: 360 });
    const deps = dependencies(undefined, probe), loader = createEditorStaticPreviewSourceLoader(deps);
    const result = await loader.load(request(plan(
        visual('v1', 'huge'), visual('v2', 'unknown'),
    ), timeline([
        media('huge', { width: 640, height: 360 }), media('unknown', { width: 0, height: 0 }),
    ])));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'huge', usages: ['foreground'], code: 'source-too-large' },
    ] });
    expect(deps.resolve).toHaveBeenCalledTimes(2);
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
    const deps = dependencies(undefined, async () => ({ ok: true, encodedBytes: 1_024, width: 2_048, height: 2_048 }));
    const loader = createEditorStaticPreviewSourceLoader(deps);
    const ids = ['one', 'two', 'three', 'four'];
    const result = await loader.load(request(
        plan(...ids.map((id, index) => visual(`v${index}`, id))),
        timeline(ids.map(id => media(id, { width: 2_048, height: 2_048 }))),
    ));
    expect(result).toEqual({ status: 'unsupported', issues: [
        { mediaId: 'one', usages: ['foreground'], code: 'source-budget-exceeded' },
    ] });
    expect(deps.resolve).toHaveBeenCalledTimes(4);
    expect(deps.probe).toHaveBeenCalledTimes(4);
    expect(deps.decode).not.toHaveBeenCalled();
});

test('the default local probe checks file size, reads only the bounded header and closes its handle', async () => {
    const uri = 'file:///picked.png', bytes = png(640, 360, 4_096);
    mockProbeFiles.set(uri, { bytes, size: bytes.length });
    await expect(probeEditorStaticPreviewEncodedSource(uri, new AbortController().signal)).resolves.toEqual({
        ok: true, encodedBytes: bytes.length, width: 640, height: 360,
    });
    expect(mockProbeCloses).toEqual([uri]);

    mockProbeFiles.set(uri, { bytes, size: EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEncodedBytes + 1 });
    await expect(probeEditorStaticPreviewEncodedSource(uri, new AbortController().signal)).resolves.toEqual({
        ok: false, code: 'source-encoded-too-large',
    });
    expect(mockProbeCloses).toEqual([uri]);
});

test('the default signed-remote probe requires a strict bounded range and cancels its reader', async () => {
    const body = png(800, 600, EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes);
    const response = ranged(body, 512_000); mockProbeFetch.mockResolvedValue(response.response);
    await expect(probeEditorStaticPreviewEncodedSource('https://signed.example/photo', new AbortController().signal)).resolves.toEqual({
        ok: true, encodedBytes: 512_000, width: 800, height: 600,
    });
    expect(mockProbeFetch).toHaveBeenCalledWith('https://signed.example/photo', {
        headers: { Range: `bytes=0-${EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes - 1}` }, signal: expect.any(AbortSignal),
    });
    expect(response.reader.cancel).toHaveBeenCalledTimes(1);
});

test('the remote probe fails closed for missing range metadata or an oversized declared total without reading a full body', async () => {
    const missing = ranged(png(640, 360), 128, 200);
    missing.response.headers.get = () => null;
    mockProbeFetch.mockResolvedValueOnce(missing.response);
    await expect(probeEditorStaticPreviewEncodedSource('https://signed.example/missing', new AbortController().signal)).resolves.toEqual({
        ok: false, code: 'source-probe-failed',
    });
    expect(missing.reader.read).not.toHaveBeenCalled();
    expect(missing.reader.cancel).toHaveBeenCalledTimes(1);

    const boundedPrefix = png(640, 360, EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.probeBytes);
    const oversized = ranged(boundedPrefix, EDITOR_STATIC_PREVIEW_SOURCE_LIMITS.maxEncodedBytes + 1);
    mockProbeFetch.mockResolvedValueOnce(oversized.response);
    await expect(probeEditorStaticPreviewEncodedSource('https://signed.example/oversized', new AbortController().signal)).resolves.toEqual({
        ok: false, code: 'source-encoded-too-large',
    });
    expect(oversized.reader.read).not.toHaveBeenCalled();
    expect(oversized.reader.cancel).toHaveBeenCalledTimes(1);
});
