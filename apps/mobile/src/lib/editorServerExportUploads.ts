import { ApiError, type ApiClient } from './api';
import { getCacheUser } from './appCache';
import { putFromDisk, type PutFile } from './uploads';
import { requireOnline } from './network';
import { UUID } from './editorServerExportStore';

export type ExportFile = { id: string; name?: string; file: string; type: string; size: number };
export const canonicalType = (type: string) => ({ 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-mpeg': 'audio/mpeg' }[type.toLowerCase()] || type.toLowerCase());
export function fileRefusal(file: ExportFile): 'localType' | 'localSize' | null {
    const type = canonicalType(file.type);
    if (!['video/mp4', 'audio/mpeg', 'audio/wav'].includes(type)) return 'localType';
    return !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (type === 'video/mp4' ? 100 : 20) * 1024 * 1024 ? 'localSize' : null;
}
type Grant = { key: string; upload_url: string; content_type: string; headers: Record<string, string>; reserved: boolean; expires_in: number; reserved_until?: string };
export type UploadedFile = { owner: string; file: string; size: number; type: string; mediaId: string; grant: Grant; expiresAt: number; reuseUntil: number; complete: boolean };
export const reusableUpload = (record: UploadedFile | undefined, file: ExportFile, owner: string, now: number) => !!record?.complete && record.owner === owner && record.file === file.file && record.size === file.size && record.type === canonicalType(file.type) && now < record.reuseUntil;
export async function uploadExportFiles(api: ApiClient, files: ExportFile[], cache: Map<string, UploadedFile>, signal: AbortSignal, now = Date.now, put: PutFile = putFromDisk, progress = (_id: string, _fraction: number) => {}) {
    const owner = getCacheUser();
    const check = () => { if (signal.aborted) throw new ApiError(0, 'upload_cancelled'); if (!owner || owner !== getCacheUser()) throw new ApiError(0, 'account_changed'); requireOnline(); };
    check();
    if (files.length > 10) throw new ApiError(400, 'localCount');
    for (const file of files) { const refusal = fileRefusal(file); if (refusal) throw new ApiError(400, refusal); }
    const pending = files.filter(file => !reusableUpload(cache.get(file.id), file, owner!, now()));
    for (const [index, file] of pending.entries()) {
        let record = cache.get(file.id);
        if (record?.owner !== owner || record?.file !== file.file || record?.size !== file.size || record?.type !== canonicalType(file.type) || record?.complete) record = undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            check();
            try {
                if (!record || now() >= record.expiresAt) {
                    const anchor = now();
                    const grant = await api.request<Grant>('/api/v1/uploads', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: canonicalType(file.type), size_bytes: file.size, batch_count: pending.length - index, batch_bytes: pending.slice(index).reduce((sum, item) => sum + item.size, 0) }) });
                    check();
                    const match = /^uploads\/([^/]+)\/([^/]+)\.(mp4|mp3|wav)$/.exec(grant.key || '');
                    if (!grant.reserved || !match || match[1] !== owner || !UUID.test(match[2]) || grant.content_type !== canonicalType(file.type)
                        || !grant.upload_url?.startsWith('https://') || !grant.headers || !Number.isFinite(grant.expires_in) || grant.expires_in <= 0) throw new ApiError(400, 'upload_invalid_grant');
                    const deadline = Date.parse(grant.reserved_until ?? '');
                    record = { owner: owner!, file: file.file, size: file.size, type: canonicalType(file.type), mediaId: `u-${match[2]}`, grant, expiresAt: anchor + grant.expires_in * 1000, reuseUntil: Number.isFinite(deadline) ? deadline : anchor + 22 * 3600000, complete: false };
                    cache.set(file.id, record);
                }
                try { await put(record.grant.upload_url, record.grant.headers, file.file, fraction => progress(file.id, fraction), signal); }
                catch (error) { if ((error as ApiError).status !== 412) throw error; }
                check(); record.complete = true; progress(file.id, 1); break;
            } catch (error) {
                check();
                const status = (error as ApiError).status;
                if (attempt === 2) throw error;
                if (status === 403 && record && now() >= record.expiresAt) { record = undefined; continue; }
                if (status !== 0 && !(error instanceof TypeError)) throw error;
            }
        }
        if (!record?.complete) throw new ApiError(0, 'upload_failed');
    }
    check();
    if (files.some(file => !reusableUpload(cache.get(file.id), file, owner!, now()))) throw new ApiError(400, 'upload_consent_expired');
    return new Map(files.map(file => [file.id, cache.get(file.id)!.mediaId]));
}
