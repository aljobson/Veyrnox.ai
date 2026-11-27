import { ApiError, type ClientTask } from '../src/lib/api';
import { withEditorExportSources, type EditorExportSourceRequest } from '../src/lib/editorExportSources';
import { emptyTimeline, type Media, type Timeline } from '../src/lib/nativeEditorModel';

type DiskEntry = { bytes: Uint8Array };
const mockDisk = new Map<string, DiskEntry>(), mockDirectories = new Set<string>(), mockDeletes: string[] = [];
const mockFetch = jest.fn();
const mockUriOf = (parts: unknown[]) => parts.map((part, index) => {
    const value = typeof part === 'string' ? part : (part as { uri: string }).uri;
    return index ? value.replace(/^\/+|\/+$/g, '') : value.replace(/\/+$/g, '');
}).join('/');

jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('expo-file-system', () => {
    const FileMode = { ReadOnly: 'r', WriteOnly: 'w' };
    class Directory {
        uri: string;
        constructor(...parts: unknown[]) { this.uri = mockUriOf(parts); }
        get exists() { return mockDirectories.has(this.uri); }
        create() { mockDirectories.add(this.uri); }
        delete() { mockDeletes.push(this.uri); mockDirectories.delete(this.uri); for (const key of [...mockDisk.keys()]) if (key.startsWith(`${this.uri}/`)) mockDisk.delete(key); }
    }
    class File {
        uri: string;
        constructor(...parts: unknown[]) { this.uri = mockUriOf(parts); }
        get exists() { return mockDisk.has(this.uri); }
        get size() { return mockDisk.get(this.uri)?.bytes.length ?? 0; }
        create() { mockDisk.set(this.uri, { bytes: new Uint8Array() }); }
        delete() { mockDeletes.push(this.uri); mockDisk.delete(this.uri); }
        open() {
            const uri = this.uri; let offset = 0;
            return {
                readBytes: async (count: number) => { const bytes = mockDisk.get(uri)?.bytes ?? new Uint8Array(); const value = bytes.slice(offset, offset + count); offset += value.length; return value; },
                writeBytes: async (chunk: Uint8Array) => { const before = mockDisk.get(uri)?.bytes ?? new Uint8Array(); const after = new Uint8Array(before.length + chunk.length);
                    after.set(before); after.set(chunk, before.length); mockDisk.set(uri, { bytes: after }); },
                close: jest.fn(),
            };
        }
    }
    return { Directory, File, FileMode, Paths: { document: 'file:///documents', cache: 'file:///cache' } };
});

const account = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const videoId = 'j-33333333-3333-4333-8333-333333333333';
const localId = 'l-44444444-4444-4444-8444-444444444444';
const maskId = 'p-55555555-5555-4555-8555-555555555555';
const assetProject = '66666666-6666-4666-8666-666666666666';
const assetId = '77777777-7777-4777-8777-777777777777';
const localUri = `file:///documents/veyrnox-editor-media/${account}/${project}/${localId}.mp4`;
const runRoot = `file:///cache/veyrnox-editor-media/${account}/${project}/export-run-test-run`;
const signedHost = 'fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com';
const mp4 = () => { const bytes = new Uint8Array(16); bytes.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); return bytes; };
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const response = (bytes: Uint8Array, contentType: string, size = bytes.length) => {
    let sent = false; const reader = { read: jest.fn(async () => sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes })), cancel: jest.fn(async () => {}) };
    return { response: { ok: true, status: 200, headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType
        : name.toLowerCase() === 'content-length' ? String(size) : null }, body: { getReader: () => reader } }, reader };
};
const task = (current = true): ClientTask => ({ gen: 4, user: account, current: () => current });
const media = (id: string, kind: string, patch: Partial<Media> = {}): Media => ({ id, kind, frames: 90, hasAudio: kind === 'video' || kind === 'audio', ...patch });
const timeline = (): Timeline => ({ ...emptyTimeline(), media: {
    [localId]: media(localId, 'video'), [videoId]: media(videoId, 'video'),
    [maskId]: media(maskId, 'image', { assetSource: { projectId: assetProject, assetId } }),
    unused: media('unused', 'video'),
}, video: [
    { id: 'v1', mediaId: localId, start: 0, len: 30, trackId: 'video-0', volume: 0 },
    { id: 'v2', mediaId: videoId, start: 30, len: 30, trackId: 'video-0', volume: 0,
        semanticMask: { version: 1, mediaId: maskId, category: 'person', sourceFrame: 30 },
        background: { type: 'image', color: '#000000', blur: 0, mediaId: maskId } },
] });
const request = (api: { request: jest.Mock }, patch: Partial<EditorExportSourceRequest> = {}): EditorExportSourceRequest => ({ api: api as never,
    task: task(), account, projectId: project, timeline: timeline(), localMediaUris: { [localId]: localUri }, ...patch });

beforeEach(() => { jest.clearAllMocks(); mockDisk.clear(); mockDirectories.clear(); mockDeletes.length = 0; mockDisk.set(localUri, { bytes: mp4() }); });

test('deduplicates exact dependencies, borrows owned local files and removes every remote byte after the callback', async () => {
    const video = mp4(), mask = png();
    const api = { request: jest.fn(async (path: string, _init: RequestInit, options: unknown) => {
        expect(options).toEqual({ owner: account, task: expect.objectContaining({ user: account }) });
        return path.includes('/jobs/') ? { url: `https://${signedHost}/video`, mime_type: 'video/mp4', size_bytes: video.length,
            asset_expires_at: '2030-01-01T00:00:00Z' } : { url: `https://${signedHost}/mask`, content_type: 'image/png', byte_size: mask.length };
    }) };
    mockFetch.mockImplementation(async (url: string) => response(url.endsWith('/video') ? video : mask, url.endsWith('/video') ? 'video/mp4' : 'image/png').response);
    const result = await withEditorExportSources(request(api), async sources => {
        expect(Object.keys(sources)).toEqual([localId, videoId, maskId]);
        expect(sources[localId]).toBe(localUri); expect(sources[videoId]).toBe(`${runRoot}/${videoId}.mp4`);
        expect(sources[maskId]).toBe(`${runRoot}/${maskId}.png`); expect(mockDisk.has(sources[videoId])).toBe(true);
        return 'export-result';
    }, { runId: () => 'test-run', now: () => Date.parse('2029-01-01T00:00:00Z') });
    expect(result).toEqual({ ok: true, value: 'export-result' }); expect(api.request).toHaveBeenCalledTimes(2); expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockDisk.has(`${runRoot}/${videoId}.mp4`)).toBe(false); expect(mockDisk.has(`${runRoot}/${maskId}.png`)).toBe(false); expect(mockDeletes).toContain(runRoot);
});

test('renders generated graphics from the document without inventing a file dependency', async () => {
    const graphicId = 'graphic-1', api = { request: jest.fn() }, tl = timeline();
    tl.media = { [graphicId]: media(graphicId, 'graphic', { hasAudio: false, graphic: { shape: 'circle', color: '#123456' } }) };
    tl.video = [{ id: 'v', mediaId: graphicId, start: 0, len: 30, trackId: 'video-0', volume: 0 }];
    const result = await withEditorExportSources(request(api, { timeline: tl, localMediaUris: {} }), async sources => {
        expect(sources).toEqual({}); return 'graphic-result';
    }, { runId: () => 'test-run' });
    expect(result).toEqual({ ok: true, value: 'graphic-result' });
    expect(api.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockDeletes).toContain(runRoot);
});

test('does not invent a file dependency for a generated graphic used as an image background', async () => {
    const graphicId = 'graphic-background', api = { request: jest.fn() }, tl = timeline();
    tl.media[graphicId] = media(graphicId, 'graphic', { hasAudio: false, graphic: { shape: 'circle', color: '#123456' } });
    tl.video = [{ ...tl.video[0], background: { type: 'image', color: '#000000', blur: 0, mediaId: graphicId } }];
    const result = await withEditorExportSources(request(api, { timeline: tl }), async sources => {
        expect(sources).toEqual({ [localId]: localUri }); return 'graphic-background-result';
    }, { runId: () => 'test-run' });
    expect(result).toEqual({ ok: true, value: 'graphic-background-result' });
    expect(api.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
});

test('materializes a video used only as a clip background', async () => {
    const bytes = mp4(), api = { request: jest.fn(async () => ({ url: `https://${signedHost}/video`, mime_type: 'video/mp4', size_bytes: bytes.length,
        asset_expires_at: '2030-01-01T00:00:00Z' })) }, tl = timeline();
    tl.video = [{ ...tl.video[0], background: { type: 'video', color: '#000000', blur: 0, mediaId: videoId } }];
    mockFetch.mockResolvedValue(response(bytes, 'video/mp4').response);
    const result = await withEditorExportSources(request(api, { timeline: tl }), async sources => {
        expect(sources).toEqual({ [localId]: localUri, [videoId]: `${runRoot}/${videoId}.mp4` });
        return 'video-background-result';
    }, { runId: () => 'test-run', now: () => Date.parse('2029-01-01T00:00:00Z') });
    expect(result).toEqual({ ok: true, value: 'video-background-result' });
    expect(api.request).toHaveBeenCalledTimes(1); expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('rejects a changed encoded size and cleans the partial run', async () => {
    const bytes = mp4(), api = { request: jest.fn(async () => ({ url: `https://${signedHost}/video`, mime_type: 'video/mp4', size_bytes: bytes.length + 1 })) };
    mockFetch.mockResolvedValue(response(bytes, 'video/mp4', bytes.length + 1).response);
    const tl = timeline(); tl.video = [{ id: 'v', mediaId: videoId, start: 0, len: 30, trackId: 'video-0', volume: 0 }];
    await expect(withEditorExportSources(request(api, { timeline: tl, localMediaUris: {} }), async () => 'never', { runId: () => 'test-run' }))
        .resolves.toEqual({ ok: false, code: 'invalid-source', mediaId: videoId });
    expect(mockDisk.has(`${runRoot}/${videoId}.mp4`)).toBe(false); expect(mockDeletes).toContain(runRoot);
});

test.each([
    [new ApiError(404, 'held'), 'held'], [new ApiError(403, 'forbidden'), 'revoked'], [new ApiError(0, 'network'), 'offline'],
] as const)('preserves signing authority failure semantics', async (error, code) => {
    const api = { request: jest.fn(async () => { throw error; }) }, tl = timeline();
    tl.video = [{ id: 'v', mediaId: videoId, start: 0, len: 30, trackId: 'video-0', volume: 0 }];
    await expect(withEditorExportSources(request(api, { timeline: tl, localMediaUris: {} }), async () => 'never', { runId: () => 'test-run' }))
        .resolves.toEqual({ ok: false, code, mediaId: videoId });
    expect(mockFetch).not.toHaveBeenCalled(); expect(mockDeletes).toContain(runRoot);
});

test('cancels an unresolved signing request even when its double ignores AbortSignal', async () => {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const never = new Promise<never>(() => undefined), api = { request: jest.fn(() => { started(); return never; }) };
    const tl = timeline(); tl.video = [{ id: 'v', mediaId: videoId, start: 0, len: 30, trackId: 'video-0', volume: 0 }];
    const controller = new AbortController(), result = withEditorExportSources(request(api, { timeline: tl, localMediaUris: {}, signal: controller.signal }), async () => 'never', { runId: () => 'test-run' });
    await ready; controller.abort(); await expect(result).resolves.toEqual({ ok: false, code: 'cancelled', mediaId: videoId });
    expect(mockFetch).not.toHaveBeenCalled(); expect(mockDeletes).toContain(runRoot);
});

test('refuses a foreign or stale task before touching disk or network', async () => {
    const api = { request: jest.fn() }, foreign = task(); Object.defineProperty(foreign, 'user', { value: 'other' });
    await expect(withEditorExportSources(request(api, { task: foreign }), async () => 'never')).resolves.toEqual({ ok: false, code: 'stale' });
    await expect(withEditorExportSources(request(api, { task: task(false) }), async () => 'never')).resolves.toEqual({ ok: false, code: 'stale' });
    expect(api.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockDirectories.size).toBe(0);
});

test('always cleans the run when the local-export callback throws and does not relabel its error', async () => {
    const api = { request: jest.fn() }, tl = timeline(); tl.video = [tl.video[0]];
    const operation = withEditorExportSources(request(api, { timeline: tl }), async () => { throw new Error('export-failed'); }, { runId: () => 'test-run' });
    await expect(operation).rejects.toThrow('export-failed'); expect(mockDeletes).toContain(runRoot); expect(api.request).not.toHaveBeenCalled();
});
