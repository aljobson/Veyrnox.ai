import { ApiError, type ApiClient } from '../api';
import { isRecord } from '../responseShapes';
import type { SaveBody } from './rules';
export type CloudProject = { id: string; beat_id: string; title: string; doc_version: number; revision: number; created_at: string; updated_at: string };
export type BeatVersion = { id: string; revision: number; title: string; reason: 'autosave' | 'checkpoint' | 'conflict' | 'stash'; saved_at: string };
export type CloudOptions = { signal?: AbortSignal; userId?: string };
const base = '/api/v1/music/beat-projects';
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;
const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const isProject = (v: unknown): v is CloudProject => isRecord(v) && uuid(v.id) && uuid(v.beat_id) && typeof v.title === 'string' && positive(v.doc_version) && positive(v.revision) && date(v.created_at) && date(v.updated_at);
const isVersion = (v: unknown): v is BeatVersion => isRecord(v) && uuid(v.id) && positive(v.revision) && typeof v.title === 'string' && typeof v.reason === 'string' && ['autosave', 'checkpoint', 'conflict', 'stash'].includes(v.reason) && date(v.saved_at);
export function normalizeCloudError(error: unknown): unknown {
    if (!(error instanceof ApiError)) return error;
    const envelope = error.body.error;
    const code = isRecord(envelope) && typeof envelope.code === 'string' ? envelope.code : error.code;
    return new ApiError(error.status, code === 'bad_response' ? code : code.toUpperCase(), error.body);
}
export function createBeatCloud(api: ApiClient) {
    async function call<T>(url: string, guard: (v: unknown) => v is T, options: CloudOptions = {}, init: RequestInit = {}): Promise<T> {
        let value: unknown;
        try { value = await api.request<unknown>(url, { ...init, signal: options.signal }, options.userId ? { owner: options.userId } : {}); }
        catch (error) { throw normalizeCloudError(error); }
        if (!guard(value)) throw new ApiError(200, 'bad_response');
        return value;
    }
    const projectResult = (id: string) => (v: unknown): v is { project: CloudProject } => isRecord(v) && isProject(v.project) && v.project.beat_id === id;
    return {
        list: (options?: CloudOptions) => call(base, (v): v is { projects: CloudProject[] } => isRecord(v) && Array.isArray(v.projects) && v.projects.every(isProject), options),
        get: (id: string, options?: CloudOptions) => call(path(id), (v): v is { project: CloudProject; doc_json: string } => isRecord(v) && typeof v.doc_json === 'string' && projectResult(id)(v), options),
        put: (id: string, body: SaveBody, key: string, options?: CloudOptions) => call(path(id), projectResult(id), options,
            { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }),
        remove: (id: string, revision: number, options?: CloudOptions) => call(path(id), (v): v is { removed: true } => isRecord(v) && v.removed === true, options,
            { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: revision }) }),
        versions: (id: string, options?: CloudOptions) => call(`${path(id)}/versions`, (v): v is { versions: BeatVersion[] } => isRecord(v) && Array.isArray(v.versions) && v.versions.every(isVersion), options),
        version: (id: string, versionId: string, options?: CloudOptions) => call(`${path(id)}/versions/${encodeURIComponent(versionId)}`,
            (v): v is { version: BeatVersion; doc_json: string } => isRecord(v) && isVersion(v.version) && v.version.id === versionId && typeof v.doc_json === 'string', options),
    };
}
export type BeatCloud = ReturnType<typeof createBeatCloud>;
