import { fetch as streamFetch } from 'expo/fetch';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { ApiClient, ClientTask } from './api';
import { ApiError } from './api';
import type { Media, Timeline } from './nativeEditorModel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_MEDIA = /^j-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/;
const SIGNED_STORAGE_HOSTS = new Set([
    'fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com',
    'fb18d9f7052afbea5a5e0eae69948af2.eu.r2.cloudflarestorage.com',
]);

export const EDITOR_EXPORT_SOURCE_LIMITS = Object.freeze({
    maximumSources: 40,
    maximumTotalBytes: 200 * 1024 * 1024,
    maximumBytes: Object.freeze({ video: 100 * 1024 * 1024, audio: 20 * 1024 * 1024, image: 20 * 1024 * 1024 }),
});

type SourceKind = 'video' | 'audio' | 'image';
type SignedSource = { readonly url: string; readonly mimeType: string; readonly sizeBytes: number };
export type EditorExportSourceFailureCode = 'cancelled' | 'stale' | 'held' | 'revoked' | 'expired'
    | 'offline' | 'missing-source' | 'invalid-source' | 'source-too-large' | 'download-failed';
export type EditorExportSourceFailure = { readonly ok: false; readonly code: EditorExportSourceFailureCode; readonly mediaId?: string };
export type EditorExportSourceResult<T> = { readonly ok: true; readonly value: T } | EditorExportSourceFailure;
export type EditorExportSourceRequest = {
    readonly api: Pick<ApiClient, 'request'>;
    readonly task: ClientTask;
    readonly account: string;
    readonly projectId: string;
    readonly timeline: Timeline;
    readonly localMediaUris: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
};

type FileHandle = ReturnType<File['open']>;
export type EditorExportSourceDependencies = {
    readonly fetch: typeof streamFetch;
    readonly now: () => number;
    readonly runId: () => string;
};
const dependencies: EditorExportSourceDependencies = {
    fetch: streamFetch,
    now: Date.now,
    runId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
};

class SourceFailure extends Error {
    constructor(readonly code: EditorExportSourceFailureCode) { super(code); }
}

const fail = (code: EditorExportSourceFailureCode, mediaId?: string): EditorExportSourceFailure => ({ ok: false, code, ...(mediaId ? { mediaId } : {}) });
const stopped = (request: EditorExportSourceRequest) => {
    if (request.signal?.aborted) throw new SourceFailure('cancelled');
    if (!request.task.current()) throw new SourceFailure('stale');
};
const abortable = <T,>(operation: Promise<T>, request: EditorExportSourceRequest): Promise<T> => {
    stopped(request);
    const signal = request.signal;
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
        const cancel = () => { signal.removeEventListener('abort', cancel); reject(new SourceFailure('cancelled')); };
        signal.addEventListener('abort', cancel, { once: true });
        operation.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => {
            signal.removeEventListener('abort', cancel); reject(error);
        });
    });
};
const safeDelete = (entry: Directory | File) => { try { if (entry.exists) entry.delete(); } catch { /* The cache sweep is the final guard. */ } };
const safeClose = (handle?: FileHandle) => { try { handle?.close(); } catch { /* best effort */ } };
const ascii = (bytes: Uint8Array, offset: number, text: string) => [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

function sourceKind(media: Media): SourceKind | null {
    if (media.kind === 'video') return 'video';
    if (media.kind === 'audio') return 'audio';
    if (media.kind === 'image' || media.kind === 'graphic') return 'image';
    return null;
}

function mimeKind(mimeType: string): SourceKind | null {
    if (['video/mp4', 'video/quicktime'].includes(mimeType)) return 'video';
    if (['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'].includes(mimeType)) return 'audio';
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'].includes(mimeType)) return 'image';
    return null;
}

function signatureMatches(bytes: Uint8Array, kind: SourceKind) {
    const box = bytes.length >= 12 && ascii(bytes, 4, 'ftyp');
    const imageBox = box && ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].some(brand => ascii(bytes, 8, brand));
    if (kind === 'video') return box && !imageBox;
    if (kind === 'audio') return box && !imageBox || bytes.length >= 12 && (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE') || ascii(bytes, 0, 'ID3'))
        || bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] & 0xe0) === 0xe0 || (bytes[1] & 0xf6) === 0xf0);
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
        || bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        || bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')
        || bytes.length >= 6 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))
        || imageBox;
}

function extension(mimeType: string) {
    return ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
        'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[mimeType] ?? 'bin';
}

function requiredMediaIds(timeline: Timeline): string[] {
    const ids: string[] = [], seen = new Set<string>();
    const add = (id?: string) => { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } };
    const solo = timeline.tracks.some(track => track.kind !== 'text' && track.solo);
    for (const clip of timeline.video) {
        const track = timeline.tracks.find(candidate => candidate.id === clip.trackId);
        if (track?.hidden) continue;
        const media = clip.mediaId ? timeline.media[clip.mediaId] : undefined;
        // Generated graphics are rendered from their validated document payload and have no file.
        // The same rule applies when a generated graphic is selected as an image background.
        if (media?.kind !== 'graphic') add(clip.mediaId);
        add(clip.semanticMask?.mediaId);
        if ((clip.background?.type === 'image' || clip.background?.type === 'video')
            && timeline.media[clip.background.mediaId]?.kind !== 'graphic') add(clip.background.mediaId);
        if (media?.hasAudio && (clip.volume ?? 1) > 0 && !track?.muted && (!solo || track?.solo)) add(clip.mediaId);
    }
    for (const clip of timeline.audio) {
        const track = timeline.tracks.find(candidate => candidate.id === clip.trackId);
        if (track?.muted || solo && !track?.solo || (clip.volume ?? 1) <= 0) continue;
        add(clip.mediaId);
    }
    return ids;
}

function ownedLocalUri(uri: string, roots: readonly Directory[]) {
    try {
        const candidate = new URL(uri);
        if (candidate.protocol !== 'file:' || candidate.host || candidate.search || candidate.hash) return false;
        const path = decodeURIComponent(candidate.pathname);
        if (path.split('/').some(part => part === '.' || part === '..' || part.includes('\\'))) return false;
        return roots.some(root => { const value = new URL(root.uri).pathname.replace(/\/+$/, ''); return path.startsWith(`${value}/`); });
    } catch { return false; }
}

async function validLocal(file: File, kind: SourceKind, request: EditorExportSourceRequest) {
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > EDITOR_EXPORT_SOURCE_LIMITS.maximumBytes[kind]) return false;
    stopped(request); const handle = file.open(FileMode.ReadOnly);
    try { return signatureMatches(await abortable(handle.readBytes(32), request), kind); }
    finally { safeClose(handle); }
}

function parseSigned(body: unknown, media: Media, now: number): SignedSource {
    if (!body || typeof body !== 'object') throw new SourceFailure('invalid-source');
    const value = body as Record<string, unknown>, url = typeof value.url === 'string' ? value.url : '';
    let parsed: URL; try { parsed = new URL(url); } catch { throw new SourceFailure('invalid-source'); }
    if (parsed.protocol !== 'https:' || !SIGNED_STORAGE_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new SourceFailure('invalid-source');
    const mimeType = String(value.content_type ?? value.mime_type ?? '').toLowerCase().split(';', 1)[0].trim();
    const sizeBytes = value.byte_size ?? value.size_bytes;
    const kind = sourceKind(media);
    if (!kind || mimeKind(mimeType) !== kind || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1) throw new SourceFailure('invalid-source');
    if (Number(sizeBytes) > EDITOR_EXPORT_SOURCE_LIMITS.maximumBytes[kind]) throw new SourceFailure('source-too-large');
    if (typeof value.asset_expires_at === 'string') {
        const expiry = Date.parse(value.asset_expires_at);
        if (!Number.isFinite(expiry) || expiry <= now) throw new SourceFailure('expired');
    }
    return { url: parsed.href, mimeType, sizeBytes: Number(sizeBytes) };
}

async function sign(request: EditorExportSourceRequest, media: Media, now: number): Promise<SignedSource> {
    let path: string;
    if (media.assetSource) path = `/api/v1/projects/${encodeURIComponent(media.assetSource.projectId)}/assets/${encodeURIComponent(media.assetSource.assetId)}/download`;
    else {
        const match = JOB_MEDIA.exec(media.id);
        if (!match) throw new SourceFailure('missing-source');
        path = `/api/v1/jobs/${encodeURIComponent(match[1])}/asset`;
    }
    try {
        const body = await abortable(request.api.request<unknown>(path, { signal: request.signal }, { owner: request.account, task: request.task }), request);
        stopped(request); return parseSigned(body, media, now);
    } catch (error) {
        if (error instanceof SourceFailure) throw error;
        if (error instanceof ApiError) {
            if (error.code.toLowerCase() === 'held') throw new SourceFailure('held');
            if (error.status === 401 || error.status === 403 || ['account_changed', 'not_authenticated'].includes(error.code)) throw new SourceFailure('revoked');
            if (error.status === 0) throw new SourceFailure('offline');
        }
        throw new SourceFailure('download-failed');
    }
}

async function download(signed: SignedSource, destination: File, request: EditorExportSourceRequest, deps: EditorExportSourceDependencies) {
    const response = await abortable(deps.fetch(signed.url, { signal: request.signal, credentials: 'omit', redirect: 'error' }), request);
    if (!response.ok) throw new SourceFailure(response.status === 401 || response.status === 403 ? 'revoked' : 'download-failed');
    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase().split(';', 1)[0].trim();
    const contentLength = Number(response.headers.get('content-length'));
    if (contentType !== signed.mimeType || !Number.isSafeInteger(contentLength) || contentLength !== signed.sizeBytes) throw new SourceFailure('invalid-source');
    const reader = response.body?.getReader(); if (!reader) throw new SourceFailure('download-failed');
    destination.create({ overwrite: true }); const output = destination.open(FileMode.WriteOnly); let bytes = 0;
    try {
        for (;;) {
            stopped(request); const chunk = await abortable(reader.read(), request); if (chunk.done) break;
            bytes += chunk.value.length; if (bytes > signed.sizeBytes) throw new SourceFailure('invalid-source');
            await abortable(output.writeBytes(chunk.value), request);
        }
    } finally { safeClose(output); void reader.cancel().catch(() => undefined); }
    if (bytes !== signed.sizeBytes || destination.size !== signed.sizeBytes) throw new SourceFailure('invalid-source');
}

function failure(error: unknown, request: EditorExportSourceRequest, mediaId?: string): EditorExportSourceFailure {
    if (request.signal?.aborted) return fail('cancelled', mediaId);
    if (!request.task.current()) return fail('stale', mediaId);
    return fail(error instanceof SourceFailure ? error.code : 'download-failed', mediaId);
}

/**
 * Materializes exactly the timeline sources needed by local export. Signed URLs live only inside
 * this call; remote bytes are owned by one run directory which is removed in `finally`.
 */
export async function withEditorExportSources<T>(request: EditorExportSourceRequest,
    use: (sources: Readonly<Record<string, string>>) => Promise<T>, provided: Partial<EditorExportSourceDependencies> = {}): Promise<EditorExportSourceResult<T>> {
    const deps = { ...dependencies, ...provided };
    if (!UUID.test(request.account) || request.task.user !== request.account || !UUID.test(request.projectId)) return fail('stale');
    try { stopped(request); } catch (error) { return failure(error, request); }
    const ids = requiredMediaIds(request.timeline);
    if (ids.length > EDITOR_EXPORT_SOURCE_LIMITS.maximumSources) return fail('source-too-large');
    const roots = [new Directory(Paths.document, 'veyrnox-editor-media', request.account, request.projectId),
        new Directory(Paths.cache, 'veyrnox-editor-media', request.account, request.projectId)];
    const run = new Directory(roots[1], `export-run-${deps.runId()}`), sources: Record<string, string> = {};
    let total = 0, invoking = false;
    try {
        run.create({ intermediates: true, idempotent: false });
        for (const mediaId of ids) {
            stopped(request);
            if (!IDENTIFIER.test(mediaId)) return fail('invalid-source', mediaId);
            const media = request.timeline.media[mediaId], kind = media && sourceKind(media);
            if (!media || !kind) return fail('missing-source', mediaId);
            const localUri = request.localMediaUris[mediaId];
            if (localUri && ownedLocalUri(localUri, roots)) {
                const local = new File(localUri);
                if (await validLocal(local, kind, request)) { sources[mediaId] = local.uri; total += local.size; }
            }
            if (!sources[mediaId]) {
                const signed = await sign(request, media, deps.now());
                if (total + signed.sizeBytes > EDITOR_EXPORT_SOURCE_LIMITS.maximumTotalBytes) return fail('source-too-large', mediaId);
                const destination = new File(run, `${mediaId}.${extension(signed.mimeType)}`);
                try {
                    await download(signed, destination, request, deps);
                    if (!await validLocal(destination, kind, request)) return fail('invalid-source', mediaId);
                    sources[mediaId] = destination.uri; total += destination.size;
                } catch (error) { safeDelete(destination); throw error; }
            }
            if (total > EDITOR_EXPORT_SOURCE_LIMITS.maximumTotalBytes) return fail('source-too-large', mediaId);
        }
        stopped(request);
        invoking = true;
        return { ok: true, value: await use(Object.freeze({ ...sources })) };
    } catch (error) { if (invoking) throw error; return failure(error, request, ids.find(id => !sources[id])); }
    finally { safeDelete(run); }
}
