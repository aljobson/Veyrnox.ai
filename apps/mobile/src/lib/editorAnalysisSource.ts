import { fetch as streamFetch } from 'expo/fetch';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { ApiClient } from './api';
import { getCacheUser } from './appCache';
import { resolveEditorMediaSource } from './editorPreview';
import type { Media } from './nativeEditorModel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Local imports keep their l- identity after a project backup is restored on another device.
const MEDIA_ID = /^(?:[jlpef]-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_ANALYSIS_SOURCE_BYTES = 100 * 1024 * 1024;
const COPY_CHUNK_BYTES = 256 * 1024;
export type AnalysisSourceResult = { ok: true; uri: string; downloaded: boolean } | { ok: false; code: 'cancelled' | 'unavailable' | 'invalid-source' | 'download-failed' };

class InvalidSource extends Error {}
class Cancelled extends Error {}

const mp4 = (bytes: Uint8Array) => bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
const validFile = async (file: File) => {
    if (!file.exists || file.size < 12 || file.size > MAX_ANALYSIS_SOURCE_BYTES) return false;
    const handle = file.open();
    try { return mp4(await handle.readBytes(16)); } finally { handle.close(); }
};

const remove = (file?: File) => { try { if (file?.exists) file.delete(); } catch { /* best-effort partial materialization cleanup */ } };
const abortable = <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return operation;
    if (signal.aborted) return Promise.reject(new Cancelled());
    return new Promise<T>((resolve, reject) => {
        const cancel = () => { signal.removeEventListener('abort', cancel); reject(new Cancelled()); };
        signal.addEventListener('abort', cancel, { once: true });
        operation.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
};
const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw new Cancelled(); };

async function copyLocal(source: File, pending: File, signal?: AbortSignal) {
    if (!await abortable(validFile(source), signal)) return false;
    stopped(signal); pending.create({ overwrite: true });
    const input = source.open(FileMode.ReadOnly), output = pending.open(FileMode.WriteOnly);
    let bytes = 0;
    try {
        for (;;) {
            stopped(signal);
            const chunk = await abortable(input.readBytes(COPY_CHUNK_BYTES), signal);
            if (!chunk.length) break;
            bytes += chunk.length; if (bytes > MAX_ANALYSIS_SOURCE_BYTES) throw new InvalidSource();
            await abortable(output.writeBytes(chunk), signal);
        }
    } finally { input.close(); output.close(); }
    return bytes === source.size && await abortable(validFile(pending), signal);
}

async function downloadRemote(uri: string, pending: File, signal?: AbortSignal) {
    stopped(signal);
    const response = await abortable(streamFetch(uri, { signal }), signal);
    if (!response.ok) throw new Error(`analysis-download-${response.status}`);
    const rawLength = response.headers.get('content-length');
    const expected = rawLength === null ? null : Number(rawLength);
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 12 || expected > MAX_ANALYSIS_SOURCE_BYTES)) throw new InvalidSource();
    const reader = response.body?.getReader();
    if (!reader) throw new Error('analysis-download-body');
    pending.create({ overwrite: true });
    const output = pending.open(FileMode.WriteOnly);
    let bytes = 0;
    try {
        for (;;) {
            stopped(signal);
            const chunk = await abortable(reader.read(), signal);
            if (chunk.done) break;
            bytes += chunk.value.length; if (bytes > MAX_ANALYSIS_SOURCE_BYTES) throw new InvalidSource();
            await abortable(output.writeBytes(chunk.value), signal);
        }
    } finally {
        output.close();
        void reader.cancel().catch(() => undefined);
    }
    if (expected !== null && bytes !== expected) throw new InvalidSource();
    return await abortable(validFile(pending), signal);
}

/** Materialize a remote editor video inside the same account/project root accepted by the native analysis bridge. */
export async function prepareEditorAnalysisSource(api: Pick<ApiClient, 'request'>, projectId: string, media: Media | undefined,
    localUri?: string, signal?: AbortSignal): Promise<AnalysisSourceResult> {
    if (signal?.aborted) return { ok: false, code: 'cancelled' };
    if (!media || media.kind !== 'video') return { ok: false, code: 'invalid-source' };
    const account = getCacheUser(), match = MEDIA_ID.exec(media.id);
    if (!account || !UUID.test(account) || !UUID.test(projectId) || !match) return { ok: false, code: 'unavailable' };
    const directory = new Directory(Paths.document, 'veyrnox-editor-media', account, projectId);
    try { directory.create({ intermediates: true, idempotent: true }); }
    catch { return { ok: false, code: 'download-failed' }; }
    const destination = new File(directory, `analysis-${match[1].toLowerCase()}.mp4`);
    try {
        if (await abortable(validFile(destination), signal)) { stopped(signal); return { ok: true, uri: destination.uri, downloaded: !localUri }; }
    } catch (error) { if (error instanceof Cancelled || signal?.aborted) return { ok: false, code: 'cancelled' }; /* An unreadable cache is replaced below. */ }
    remove(destination);
    if (localUri) {
        const pending = new File(directory, `analysis-${match[1].toLowerCase()}-${Date.now()}-local.pending`);
        let moved = false;
        try {
            if (await copyLocal(new File(localUri), pending, signal)) {
                stopped(signal); await pending.move(destination, { overwrite: true }); moved = true;
                return { ok: true, uri: destination.uri, downloaded: false };
            }
        } catch (error) { if (error instanceof Cancelled || signal?.aborted) return { ok: false, code: 'cancelled' }; }
        finally { if (!moved) remove(pending); }
    }
    let pending: File | undefined, moved = false;
    try {
        const source = await abortable(resolveEditorMediaSource(api, media, signal), signal);
        stopped(signal);
        if (!source || source.kind !== 'video') return { ok: false, code: 'unavailable' };
        pending = new File(directory, `analysis-${match[1].toLowerCase()}-${Date.now()}.pending`);
        if (!await downloadRemote(source.uri, pending, signal)) return { ok: false, code: 'invalid-source' };
        stopped(signal); await pending.move(destination, { overwrite: true }); moved = true;
        return { ok: true, uri: destination.uri, downloaded: true };
    } catch (error) { return error instanceof Cancelled || signal?.aborted ? { ok: false, code: 'cancelled' }
        : error instanceof InvalidSource ? { ok: false, code: 'invalid-source' } : { ok: false, code: 'download-failed' }; }
    finally { if (!moved) remove(pending); }
}
