import { ApiError, type ApiClient, type ClientTask } from './api';
import { putFromDisk, type PutFile } from './uploads';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function uploadBrandAsset(api: Pick<ApiClient, 'request'>, task: ClientTask, projectId: string,
    file: { uri: string; contentType: string; size: number }, put: PutFile = putFromDisk, signal: AbortSignal) {
    const check = () => {
        if (!task.current()) throw new ApiError(401, 'account_changed');
        if (signal.aborted) throw new ApiError(0, 'upload_cancelled');
    };
    check();
    const path = `/api/v1/projects/${encodeURIComponent(projectId)}/assets`;
    const grant = await api.request<{ asset_id: string; upload_url: string; content_type: string; headers?: Record<string, string> }>(path, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `brand-asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` },
        body: JSON.stringify({ media_type: file.contentType, size_bytes: file.size }),
    }, { task });
    check();
    if (!grant || typeof grant.asset_id !== 'string' || !UUID.test(grant.asset_id) || typeof grant.upload_url !== 'string' || !grant.upload_url.startsWith('https://') || grant.content_type !== file.contentType) throw new ApiError(400, 'upload_invalid_grant');
    await put(grant.upload_url, { ...grant.headers, 'Content-Type': grant.content_type }, file.uri, () => {}, signal).catch(err => {
        check();
        // A missing storage object is resource-specific too; only reservation 404 disables uploads.
        if (err instanceof ApiError && err.status === 404) throw new ApiError(422, 'upload_rejected');
        throw err;
    });
    check();
    const result = await api.request<{ state: string }>(`${path}/${encodeURIComponent(grant.asset_id)}/inspect`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: '{}' }, { task }).catch(err => {
        check();
        if (err instanceof ApiError && err.status === 404) throw new ApiError(422, 'upload_rejected');
        throw err;
    });
    check();
    if (result?.state !== 'inspected') throw new ApiError(422, 'upload_rejected');
    return { projectId, assetId: grant.asset_id };
}
function serverCode(err: ApiError): string | null {
    const e = err.body.error;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const code = (e as Record<string, unknown>).code;
    return typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : null;
}
export function uploadErrorKey(err: unknown) {
    if (err instanceof ApiError) {
        const code = serverCode(err) ?? err.code;
        if (err.status === 404) return 'brand.upload.err.off';
        if (err.status === 503) return 'brand.upload.err.unavailable';
        if (err.status === 400 && ['INVALID_MEDIA', 'upload_invalid_grant'].includes(code)) return 'brand.upload.err.type';
        if (err.status === 422 && code === 'upload_rejected') return 'brand.upload.err.rejected';
        if (err.status === 429) return 'brand.err.rate';
        if (err.status === 0) return code === 'upload_cancelled' ? null : 'brand.err.network';
    }
    return 'brand.err.failed';
}
