import { File } from 'expo-file-system';
import { ApiError, type ApiClient } from './api';
import { discardCacheCopy } from './cacheFiles';
import { loadManipulator, type ManipulatorLib } from './chatResizer';
import { config } from './config';
import { ensureOnline, OfflineError } from './network';
import { putFromDisk, type PutFile } from './uploads';

export const SOCIAL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;
export const SOCIAL_UPLOAD_CAPS: Record<string, number> = { 'image/jpeg': 20 * 1024 * 1024, 'image/png': 20 * 1024 * 1024, 'image/webp': 20 * 1024 * 1024, 'video/mp4': 100 * 1024 * 1024 };
const normalize = (type?: string) => type === 'image/jpg' ? 'image/jpeg' : type ?? '';
export function checkLocal({ mimeType, size }: { mimeType?: string; size?: number }): 'ok' | 'upload_type_not_allowed' | 'upload_size_required' | 'upload_too_large' {
    const cap = SOCIAL_UPLOAD_CAPS[normalize(mimeType)];
    if (!cap) return 'upload_type_not_allowed';
    if (!Number.isSafeInteger(size) || !size || size < 0) return 'upload_size_required';
    return size > cap ? 'upload_too_large' : 'ok';
}
export interface PublishFile { uri: string; mimeType: string; size: number }
export interface UploadRow { id: string; filename: string; mime_type: string; size_bytes: number; url: string }
interface Grant { id: string; upload_url: string; content_type: string; headers?: Record<string, string> }
export function assertAttempt(accountLive: () => boolean, signal?: AbortSignal): void {
    if (!accountLive()) throw new ApiError(0, 'upload_superseded');
    if (signal?.aborted) throw new ApiError(0, 'upload_cancelled');
}

// Only HEIC/HEIF need conversion. No resize and no video transcoding.
export async function prepareImage(file: { uri: string; mimeType?: string }, options: {
    load?: () => ManipulatorLib; sizeOf?: (uri: string) => number; accountLive?: () => boolean; signal?: AbortSignal;
} = {}): Promise<PublishFile> {
    const live = options.accountLive ?? (() => true);
    let uri = file.uri;
    let mimeType = normalize(file.mimeType);
    try {
        assertAttempt(live, options.signal);
        if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            const lib = (options.load ?? loadManipulator)();
            const rendered = await lib.ImageManipulator.manipulate(uri).renderAsync();
            assertAttempt(live, options.signal);
            const saved = await rendered.saveAsync({ compress: 1, format: lib.SaveFormat.JPEG });
            uri = saved.uri;
            assertAttempt(live, options.signal);
            mimeType = 'image/jpeg';
        } else if (!SOCIAL_UPLOAD_CAPS[mimeType]) throw new ApiError(400, 'upload_type_not_allowed');
        const size = (options.sizeOf ?? ((path) => new File(path).size))(uri);
        assertAttempt(live, options.signal);
        const checked = checkLocal({ mimeType, size });
        if (checked !== 'ok') throw new ApiError(400, checked);
        return { uri, mimeType, size };
    } catch (err) { discardCacheCopy(uri); throw err; }
}
export function neutralFilename(type: string, date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' })[normalize(type)] ?? 'jpg';
    return `${type.startsWith('video/') ? 'Video' : 'Photo'} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${ext}`.slice(0, 180);
}
const path = '/api/v1/social/uploads';
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const reserveUpload = (api: ApiClient, file: PublishFile) => api.request<Grant>(path, json('POST', {
    action: 'reserve', filename: neutralFilename(file.mimeType), content_type: normalize(file.mimeType), size_bytes: file.size, rights_confirmed: true,
}));
export const completeUpload = async (api: ApiClient, id: string): Promise<UploadRow> => (await api.request<{ upload: UploadRow }>(path, json('POST', { action: 'complete', id }))).upload;
export const listUploads = async (api: ApiClient): Promise<UploadRow[]> => (await api.request<{ uploads: UploadRow[] }>(path)).uploads;
export const removeUpload = (api: ApiClient, id: string) => api.request(path, json('DELETE', { id }));
export function validUploadUrl(value: string, dev = __DEV__, base = config.apiBase): boolean {
    try {
        const url = new URL(value);
        return !url.username && !url.password && ((url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com')) ||
            (dev && url.protocol === 'http:' && url.origin === new URL(base).origin));
    } catch { return false; }
}
export async function uploadToPublish(api: ApiClient, file: PublishFile, options: {
    onProgress: (fraction: number) => void; signal: AbortSignal; accountLive: () => boolean; put?: PutFile;
}): Promise<UploadRow> {
    const { signal, accountLive } = options;
    const check = () => assertAttempt(accountLive, signal);
    let id: string | undefined;
    try {
        check();
        const checked = checkLocal(file);
        if (checked !== 'ok') throw new ApiError(400, checked);
        await ensureOnline(); check();
        const grant = await reserveUpload(api, file);
        id = grant.id; check();
        if (!validUploadUrl(grant.upload_url)) throw new ApiError(400, 'upload_failed');
        const headers = Object.fromEntries(Object.entries(grant.headers ?? {}).filter(([key]) => !['content-length', 'content-type'].includes(key.toLowerCase())));
        await (options.put ?? putFromDisk)(grant.upload_url, { ...headers, 'Content-Type': grant.content_type }, file.uri, options.onProgress, signal);
        check(); options.onProgress(1);
        const row = await completeUpload(api, id);
        check();
        return row;
    } catch (err) {
        if (!accountLive()) throw new ApiError(0, 'upload_superseded');
        let failure = signal.aborted ? new ApiError(0, 'upload_cancelled') : err;
        if (id && accountLive()) {
            try {
                await removeUpload(api, id);
                if (failure instanceof ApiError) failure = new ApiError(failure.status, failure.code, { ...failure.body, reservationRemoved: true });
                else failure = new ApiError(0, 'upload_failed', { reservationRemoved: true });
            } catch { /* Best effort; a pending row is eventually swept. */ }
        }
        if (!accountLive()) throw new ApiError(0, 'upload_superseded');
        throw failure;
    }
}
export function publishUploadMessage(err: unknown): string | null {
    if (err instanceof OfflineError) return 'publishUploads.offline';
    if (!(err instanceof ApiError)) return 'publishUploads.failed';
    if (err.code === 'upload_superseded' || (err.status === 503 && err.code === 'uploads_not_open')) return null;
    if (err.code === 'upload_cancelled') return 'publishUploads.canceled';
    if (err.code === 'upload_url_expired') return 'publishUploads.expired';
    if (err.code === 'upload_not_found') return 'publishUploads.notFound';
    if (err.code === 'upload_admission_unavailable') return 'publishUploads.admission';
    if (['upload_type_not_allowed', 'upload_size_required', 'upload_too_large', 'upload_budget_exceeded', 'upload_in_use', 'upload_type_mismatch', 'upload_unreadable'].includes(err.code)) return `publishUploads.error.${err.code}`;
    if (err.status === 429) return 'publishUploads.rate';
    if (err.code === 'upload_failed') return 'publishUploads.failed';
    if (err.status === 0) return 'publishUploads.offline';
    return 'publishUploads.failed';
}
