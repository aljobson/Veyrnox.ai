import { prepareEditorAnalysisSource } from '../src/lib/editorAnalysisSource';
import type { Media } from '../src/lib/nativeEditorModel';

type DiskEntry = { bytes: Uint8Array; size: number };
const mockDisk = new Map<string, DiskEntry>();
const mockDeletes: string[] = [];
const mockMoves: [string, string][] = [];
const mockDirectoryCreates: string[] = [];
const mockOpened: [string, string | undefined][] = [];
const mockClosed: [string, string | undefined][] = [];
const mockFetch = jest.fn();
let mockOwner: string | null = null;

const uriOf = (parts: unknown[]) => parts.map((part, index) => {
    const value = typeof part === 'string' ? part : (part as { uri: string }).uri;
    return index ? value.replace(/^\/+|\/+$/g, '') : value.replace(/\/+$/g, '');
}).join('/');

jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner }));
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('expo-file-system', () => {
    const FileMode = { ReadOnly: 'r', WriteOnly: 'w' };
    class Directory {
        uri: string;
        constructor(...parts: unknown[]) { this.uri = uriOf(parts); }
        create() { mockDirectoryCreates.push(this.uri); }
    }
    class File {
        uri: string;
        constructor(...parts: unknown[]) { this.uri = uriOf(parts); }
        get exists() { return mockDisk.has(this.uri); }
        get size() { return mockDisk.get(this.uri)?.size ?? 0; }
        create() { mockDisk.set(this.uri, { bytes: new Uint8Array(), size: 0 }); }
        open(mode?: string) {
            const uri = this.uri; let offset = 0; mockOpened.push([uri, mode]);
            return {
                readBytes: async (count: number) => { const bytes = mockDisk.get(uri)?.bytes ?? new Uint8Array(); const chunk = bytes.slice(offset, offset + count); offset += chunk.length; return chunk; },
                writeBytes: async (chunk: Uint8Array) => { const current = mockDisk.get(uri)?.bytes ?? new Uint8Array(); const next = new Uint8Array(current.length + chunk.length);
                    next.set(current); next.set(chunk, current.length); mockDisk.set(uri, { bytes: next, size: next.length }); },
                close: () => { mockClosed.push([uri, mode]); },
            };
        }
        delete() { mockDeletes.push(this.uri); mockDisk.delete(this.uri); }
        async move(destination: File) {
            const source = this.uri, entry = mockDisk.get(source); mockMoves.push([source, destination.uri]);
            if (!entry) throw new Error('missing-pending-file');
            mockDisk.set(destination.uri, entry); mockDisk.delete(source); this.uri = destination.uri;
        }
    }
    return { Directory, File, FileMode, Paths: { document: 'file:///documents' } };
});

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const mediaUuid = '33333333-3333-4333-8333-333333333333';
const media: Media = { id: `j-${mediaUuid}`, kind: 'video', frames: 300, width: 1280, height: 720 };
const assetProject = '44444444-4444-4444-8444-444444444444';
const assetId = '55555555-5555-4555-8555-555555555555';
const restoredMedia: Media = { ...media, id: `l-${mediaUuid}`, assetSource: { projectId: assetProject, assetId } };
const root = `file:///documents/veyrnox-editor-media/${owner}/${project}`;
const finalUri = `${root}/analysis-${mediaUuid}.mp4`;
const pendingUri = `${root}/analysis-${mediaUuid}-1700000000000.pending`;
const localPendingUri = `${root}/analysis-${mediaUuid}-1700000000000-local.pending`;
const pickerUri = 'content://picker/video/42';
const signedUrl = 'https://assets.example/video.mp4?signature=secret';
const validMp4 = () => {
    const bytes = new Uint8Array(16); bytes.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); return bytes;
};
const put = (uri: string, bytes = validMp4(), size = bytes.length) => mockDisk.set(uri, { bytes, size });
const api = (body: unknown = { url: signedUrl, content_type: 'video/mp4' }) => ({ request: jest.fn().mockResolvedValue(body) });
const readerResponse = (chunks: Uint8Array[] = [validMp4()], contentLength: string | null = String(chunks.reduce((sum, chunk) => sum + chunk.length, 0))) => {
    let index = 0;
    const reader = { read: jest.fn(async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }), cancel: jest.fn(async () => {}) };
    return { response: { ok: true, status: 200, headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? contentLength : null }, body: { getReader: () => reader } }, reader };
};
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

beforeEach(() => {
    jest.clearAllMocks(); mockDisk.clear(); mockDeletes.length = 0; mockMoves.length = 0; mockDirectoryCreates.length = 0; mockOpened.length = 0; mockClosed.length = 0;
    mockOwner = owner; jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockFetch.mockResolvedValue(readerResponse().response);
});
afterEach(() => jest.restoreAllMocks());

test('reuses an existing valid owned local file without network work', async () => {
    put(finalUri); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, media, finalUri)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: false });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockMoves).toEqual([]);
    expect(mockOpened).toEqual([[finalUri, undefined]]); expect(mockClosed).toEqual(mockOpened);
});

test('copies and validates an arbitrary picker URI into the owned account/project root', async () => {
    put(pickerUri); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, media, pickerUri)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: false });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
    expect(mockMoves).toEqual([[localPendingUri, finalUri]]); expect(mockDisk.has(pickerUri)).toBe(true); expect(mockDisk.has(localPendingUri)).toBe(false);
    expect(mockDisk.get(finalUri)?.bytes).toEqual(validMp4()); expect(mockOpened).toContainEqual([pickerUri, 'r']); expect(mockOpened).toContainEqual([localPendingUri, 'w']);
});

test('materializes restored l- media with assetSource from its valid device URI', async () => {
    put(pickerUri); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, restoredMedia, pickerUri)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: false });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockMoves).toEqual([[localPendingUri, finalUri]]);
});

test.each([
    ['missing media', owner, project, undefined, 'invalid-source'],
    ['image media', owner, project, { ...media, kind: 'image' }, 'invalid-source'],
    ['missing owner', null, project, media, 'unavailable'],
    ['invalid owner', 'owner', project, media, 'unavailable'],
    ['invalid project', owner, '../project', media, 'unavailable'],
    ['invalid remote media id', owner, project, { ...media, id: 'j-not-a-uuid' }, 'unavailable'],
] as const)('rejects %s before network or file-system work', async (_label, account, projectId, item, code) => {
    mockOwner = account; const client = api();
    await expect(prepareEditorAnalysisSource(client as never, projectId, item as Media | undefined, pickerUri)).resolves.toEqual({ ok: false, code });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockDirectoryCreates).toEqual([]);
});

test('streams a signed remote video with both request and transfer AbortSignals, verifies it, and atomically caches it', async () => {
    const client = api(), controller = new AbortController();
    await expect(prepareEditorAnalysisSource(client as never, project, media, undefined, controller.signal)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: true });
    expect(client.request).toHaveBeenCalledWith(`/api/v1/jobs/${mediaUuid}/asset`, { signal: controller.signal });
    expect(mockFetch).toHaveBeenCalledWith(signedUrl, { signal: controller.signal });
    expect(mockMoves).toEqual([[pendingUri, finalUri]]); expect(mockDisk.has(pendingUri)).toBe(false); expect(mockDisk.get(finalUri)?.bytes).toEqual(validMp4());
    expect([...mockDisk.keys()].join('|')).not.toContain('signature=secret');
});

test('reuses a valid remote cache before requesting another signed URL', async () => {
    put(finalUri); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, media)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: true });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockMoves).toEqual([]);
});

test('falls back to the remote asset when a picker file has an invalid signature', async () => {
    put(pickerUri, new Uint8Array(16)); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, media, pickerUri)).resolves.toEqual({ ok: true, uri: finalUri, downloaded: true });
    expect(client.request).toHaveBeenCalledTimes(1); expect(mockFetch).toHaveBeenCalledTimes(1); expect(mockMoves).toEqual([[pendingUri, finalUri]]);
    expect(mockDisk.has(pickerUri)).toBe(true); expect(mockDisk.has(localPendingUri)).toBe(false);
});

test('falls back through assetSource when a restored local URI is missing or unreadable', async () => {
    const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, restoredMedia, 'content://picker/missing')).resolves.toEqual({ ok: true, uri: finalUri, downloaded: true });
    expect(client.request).toHaveBeenCalledWith(`/api/v1/projects/${assetProject}/assets/${assetId}/download`, { signal: undefined });
    expect(mockFetch).toHaveBeenCalledWith(signedUrl, { signal: undefined }); expect(mockMoves).toEqual([[pendingUri, finalUri]]);
});

test.each([
    ['invalid signature', readerResponse([new Uint8Array(16)]).response],
    ['oversize content length', readerResponse([validMp4()], String(100 * 1024 * 1024 + 1)).response],
    ['truncated declared length', readerResponse([validMp4()], '20').response],
] as const)('cleans an invalid or oversized remote transfer: %s', async (_label, response) => {
    mockFetch.mockResolvedValueOnce(response);
    await expect(prepareEditorAnalysisSource(api() as never, project, media)).resolves.toEqual({ ok: false, code: 'invalid-source' });
    expect(mockDisk.has(pendingUri)).toBe(false); expect(mockDisk.has(finalUri)).toBe(false); expect(mockMoves).toEqual([]);
});

test('an abort cancels an unresolved signed-URL request even when the API double ignores its signal', async () => {
    const waiting = deferred<never>(), started = deferred<void>(), controller = new AbortController();
    const client = { request: jest.fn((_path: string, init?: RequestInit) => { expect(init?.signal).toBe(controller.signal); started.resolve(); return waiting.promise; }) };
    const operation = prepareEditorAnalysisSource(client as never, project, media, undefined, controller.signal);
    await started.promise; controller.abort();
    await expect(operation).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(mockFetch).not.toHaveBeenCalled(); expect(mockDisk.has(pendingUri)).toBe(false);
});

test('an abort cancels an unresolved expo fetch even when the transport double ignores its signal', async () => {
    const waiting = deferred<never>(), started = deferred<void>(), controller = new AbortController();
    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => { expect(init?.signal).toBe(controller.signal); started.resolve(); return waiting.promise; });
    const operation = prepareEditorAnalysisSource(api() as never, project, media, undefined, controller.signal);
    await started.promise; controller.abort();
    await expect(operation).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(mockDisk.has(pendingUri)).toBe(false); expect(mockMoves).toEqual([]);
});

test('an abort cancels an unresolved in-flight body read and removes the partial file', async () => {
    const controller = new AbortController(), readStarted = deferred<void>(), never = deferred<never>();
    const reader = { read: jest.fn(() => { readStarted.resolve(); return never.promise; }), cancel: jest.fn(async () => {}) };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } });
    const operation = prepareEditorAnalysisSource(api() as never, project, media, undefined, controller.signal);
    await readStarted.promise; expect(mockDisk.has(pendingUri)).toBe(true); controller.abort();
    await expect(operation).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(mockDisk.has(pendingUri)).toBe(false); expect(mockDeletes).toContain(pendingUri); expect(reader.cancel).toHaveBeenCalledTimes(1);
});

test('a pre-aborted task performs no network or file-system work', async () => {
    const controller = new AbortController(); controller.abort(); const client = api();
    await expect(prepareEditorAnalysisSource(client as never, project, media, pickerUri, controller.signal)).resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(client.request).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled(); expect(mockDirectoryCreates).toEqual([]);
});

test('request rejection returns download-failed without a pending file', async () => {
    const client = { request: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(prepareEditorAnalysisSource(client as never, project, media)).resolves.toEqual({ ok: false, code: 'download-failed' });
    expect(mockFetch).not.toHaveBeenCalled(); expect(mockDisk.has(pendingUri)).toBe(false);
});

test('stream rejection removes a partially written pending file and returns download-failed', async () => {
    let reads = 0; const reader = { read: jest.fn(async () => { if (reads++ === 0) return { done: false, value: validMp4().slice(0, 8) }; throw new Error('network-lost'); }),
        cancel: jest.fn(async () => {}) };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } });
    await expect(prepareEditorAnalysisSource(api() as never, project, media)).resolves.toEqual({ ok: false, code: 'download-failed' });
    expect(mockDisk.has(pendingUri)).toBe(false); expect(mockDeletes).toContain(pendingUri); expect(mockMoves).toEqual([]);
});

test.each([
    { url: 'http://assets.example/video.mp4', content_type: 'video/mp4' },
    { url: 'https://assets.example/video.mp4', content_type: 'image/png' },
    { url: 'https://user:secret@assets.example/video.mp4', content_type: 'video/mp4' },
] as const)('refuses an unusable remote response without transferring it', async response => {
    await expect(prepareEditorAnalysisSource(api(response) as never, project, media)).resolves.toEqual({ ok: false, code: 'unavailable' });
    expect(mockFetch).not.toHaveBeenCalled(); expect(mockDisk.has(pendingUri)).toBe(false);
});
