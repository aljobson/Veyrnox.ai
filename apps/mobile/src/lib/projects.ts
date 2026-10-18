import type { ApiClient } from './api';

// ADR-0131: read-only workspaces and projects (the editor's cloud saves). The routes sit behind TENANT_PROJECTS_ENABLED
// and answer 404 while it is off. They also return errors as {error:{code,message}} (an object), which the API client
// reports with the code 'unknown', so the wording here follows the HTTP status.

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export interface Workspace {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
}

export interface Project {
    readonly id: string;
    readonly workspaceId: string | null;
    readonly name: string;
    readonly version: number;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
}

export interface Version {
    readonly revision: number;
    readonly createdAt: string | null;
    readonly restoredFrom: number | null;
}

export function parseWorkspaces(body: unknown): Workspace[] {
    const list = isObject(body) && Array.isArray(body.workspaces) ? body.workspaces : [];
    const out: Workspace[] = [];
    for (const raw of list) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        if (id) out.push({ id, name: str(raw.name) ?? 'Workspace', isDefault: raw.is_default === true });
    }
    return out;
}

export function parseProject(raw: unknown): Project | null {
    const r = isObject(raw) && isObject(raw.project) ? raw.project : raw;
    if (!isObject(r)) return null;
    const id = str(r.id);
    if (!id) return null;
    return {
        id,
        workspaceId: str(r.workspace_id),
        name: str(r.name) ?? 'Untitled project',
        version: typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 0 ? r.version : 0,
        createdAt: str(r.created_at),
        updatedAt: str(r.updated_at),
    };
}

export function parseProjects(body: unknown): Project[] {
    const list = isObject(body) && Array.isArray(body.projects) ? body.projects : [];
    return list.map(parseProject).filter((p): p is Project => p !== null);
}

export function parseHistory(body: unknown): { versions: Version[]; nextBefore: number | null } {
    const b = isObject(body) ? body : {};
    const versions: Version[] = [];
    for (const raw of Array.isArray(b.versions) ? b.versions : []) {
        if (!isObject(raw) || typeof raw.revision !== 'number' || !Number.isInteger(raw.revision)) continue;
        versions.push({ revision: raw.revision, createdAt: str(raw.created_at), restoredFrom: typeof raw.restored_from === 'number' ? raw.restored_from : null });
    }
    return { versions, nextBefore: typeof b.next_before === 'number' ? b.next_before : null };
}

// Adds a page to what is shown, skipping revisions already shown; `added` is false when a page brought nothing new.
export function mergeVersions(existing: readonly Version[], next: readonly Version[]): { versions: Version[]; added: boolean } {
    const seen = new Set(existing.map((v) => v.revision));
    const fresh = next.filter((v) => !seen.has(v.revision) && seen.add(v.revision));
    return { versions: [...existing, ...fresh], added: fresh.length > 0 };
}

export const versionLabel = (v: Version): string => (v.restoredFrom !== null ? `Version ${v.revision}, restored from version ${v.restoredFrom}` : `Version ${v.revision}`);

const enc = encodeURIComponent;
export const fetchWorkspaces = async (api: ApiClient) => parseWorkspaces(await api.request('/api/v1/workspaces'));
export const fetchProjects = async (api: ApiClient, workspaceId: string) => parseProjects(await api.request(`/api/v1/projects?workspace_id=${enc(workspaceId)}`));
export const fetchProject = async (api: ApiClient, id: string) => parseProject(await api.request(`/api/v1/projects/${enc(id)}`));
export const fetchHistory = async (api: ApiClient, id: string, before?: number) =>
    parseHistory(await api.request(`/api/v1/projects/${enc(id)}/history${before === undefined ? '' : `?before=${enc(String(before))}`}`));

export function projectsErrorMessage(err: unknown): string {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 0) return 'No connection. Check your internet and try again.';
    if (status === 404) return 'Projects are not available yet.';
    if (status === 401 || status === 403) return 'You do not have permission to see this.';
    if (status === 429) return 'Too many requests. Try again in a moment.';
    if (status === 502 || status === 503) return 'The service is busy. Try again in a moment.';
    return 'Something went wrong. Try again.';
}
