import { ApiError, type ApiClient } from './api';
import { MEDIA_ID, validDocument, type AssetError, type ProjectDocument } from './editorBridge';
import { mediaApi } from './media';
import { observe } from './network';
import { fetchWorkspaces, parseProject } from './projects';

export interface DocumentHead { revision: number; document: ProjectDocument }
export async function defaultWorkspace(api: ApiClient) {
    const list = await observe(fetchWorkspaces(api));
    return list.find(w => w.isDefault) ?? list[0] ?? null;
}
export async function createProject(api: ApiClient, workspaceId: string, name: string, key: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, 'invalid_name');
    const result = parseProject(await observe(api.request('/api/v1/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ workspace_id: workspaceId, name: trimmed }),
    })));
    if (!result) throw new ApiError(503, 'invalid_response');
    return result;
}
const path = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/document`;
export async function getDocument(api: ApiClient, id: string): Promise<DocumentHead> {
    const head = await observe(api.request<DocumentHead>(path(id)));
    if (!Number.isSafeInteger(head?.revision) || head.revision < 0 || !validDocument(head.document, id)) throw new ApiError(503, 'invalid_response');
    return head;
}
export async function putDocument(api: ApiClient, id: string, expectedRevision: number, document: ProjectDocument, key: string) {
    const result = await observe(api.request<{ revision: number }>(path(id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ expected_revision: expectedRevision, document }),
    }));
    if (!Number.isSafeInteger(result?.revision) || result.revision <= expectedRevision) throw new ApiError(503, 'invalid_response');
    return result;
}
export function conflictCopyName(name: string) {
    const base = name.trim() || 'Project', suffix = ' — edit copy';
    return `${base.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
}
export class AssetResolutionError extends Error {
    constructor(readonly code: AssetError) { super(code); }
}
export async function resolveAsset(api: ApiClient, mediaId: string, now: number) {
    const match = MEDIA_ID.exec(mediaId);
    if (!match) throw new AssetResolutionError('unavailable');
    try {
        const asset = await observe(mediaApi(api).getAsset(match[1], match[2])) as { url: string; mime_type: string; expires_in?: number; asset_expires_at?: string };
        if (new URL(asset.url).protocol !== 'https:' || !/^(video|audio|image)\//.test(asset.mime_type)) throw new AssetResolutionError('unavailable');
        if (asset.asset_expires_at && Date.parse(asset.asset_expires_at) <= now) throw new AssetResolutionError('expired');
        const seconds = asset.expires_in === undefined ? 900 : asset.expires_in;
        if (!Number.isFinite(seconds) || seconds <= 0) throw new AssetResolutionError('expired');
        return { url: asset.url, mime: asset.mime_type, expiresAt: now + Math.min(seconds, 900) * 1000 };
    } catch (err) {
        if (err instanceof AssetResolutionError) throw err;
        const status = (err as ApiError).status;
        throw new AssetResolutionError(status === 0 ? 'offline' : status === 429 ? 'rate_limited' : 'unavailable');
    }
}
export function editorErrorKey(status: number): string {
    if ([403, 404, 503].includes(status)) return 'editor.unavailable';
    if (status === 0) return 'editor.offline';
    if (status === 400) return 'editor.rejected';
    if (status === 409) return 'editor.conflict';
    if (status === 429) return 'editor.paused';
    return 'editor.retry';
}
