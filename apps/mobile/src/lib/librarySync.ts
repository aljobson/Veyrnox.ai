import type { ApiClient } from './api';
import type { Cache } from './cache';
import { POLICIES } from './cache';
import { draftIsEmpty, parseDraft, SAVED_DRAFT_VERSION, type CreateDraft } from './createOptions';
import { MAX_FAVOURITES, readFavourites, writeFavourites } from './libraryView';

// Library favourites and the unsent Create draft on the server (ADR-0340, routes /api/v1/library-sync). The server
// answers 404 while its own LIBRARY_SYNC_ENABLED is off, and a failed or slow request means "unavailable": the screens
// then work from this phone's own copy, as before. Nothing here ever blocks a screen or throws, and nothing is logged:
// a draft holds the person's prompt.

type Requester = Pick<ApiClient, 'request'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// The words and settings both the web and the phone restore. No file, no Cinema or Character panel, no key.
export interface SharedDraft {
    readonly v: 1;
    readonly modelId: string;
    readonly prompt: string;
    readonly duration: number | null;
    readonly aspect: string | null;
    readonly count: number;
    readonly seed: string;
    readonly negative: string;
    readonly voice: string;
}

export type LibrarySync =
    | { readonly kind: 'ok'; readonly favourites: string[]; readonly draft: unknown; readonly draftUpdatedAt: number | null }
    | { readonly kind: 'unavailable' };

export function toSharedDraft(draft: CreateDraft): SharedDraft | null {
    if (draftIsEmpty(draft)) return null;
    return {
        v: 1, modelId: draft.modelId, prompt: draft.prompt, duration: Number.isInteger(draft.duration) ? draft.duration : null,
        aspect: draft.aspect, count: draft.count, seed: draft.seed, negative: draft.negative, voice: draft.voice ?? '',
    };
}

// Read back only for the model of the screen; the phone-only settings start off.
export function fromSharedDraft(shared: unknown, modelId: string): CreateDraft | null {
    if (!isObject(shared) || shared.v !== 1) return null;
    return parseDraft({ ...shared, v: SAVED_DRAFT_VERSION }, modelId);
}

export async function fetchLibrarySync(api: Requester): Promise<LibrarySync> {
    try {
        const body = await api.request<unknown>('/api/v1/library-sync');
        if (!isObject(body)) return { kind: 'unavailable' };
        const favourites = Array.isArray(body.favourites) ? body.favourites.filter((id): id is string => typeof id === 'string' && UUID.test(id)).slice(0, MAX_FAVOURITES) : [];
        const at = typeof body.draft_updated_at === 'string' ? Date.parse(body.draft_updated_at) : NaN;
        return { kind: 'ok', favourites, draft: isObject(body.draft) ? body.draft : null, draftUpdatedAt: Number.isFinite(at) ? at : null };
    } catch {
        return { kind: 'unavailable' };
    }
}

async function send(api: Requester, path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<boolean> {
    try {
        await api.request(path, { method, ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }) });
        return true;
    } catch {
        return false;
    }
}

export const pushFavourite = (api: Requester, jobId: string, starred: boolean): Promise<boolean> =>
    send(api, '/api/v1/library-sync/favourites', 'PUT', { job_id: jobId, starred });
export const pushDraft = (api: Requester, draft: SharedDraft): Promise<boolean> => send(api, '/api/v1/library-sync/draft', 'PUT', { draft });
export const clearRemoteDraft = (api: Requester): Promise<boolean> => send(api, '/api/v1/library-sync/draft', 'DELETE');

// The first time this phone meets the account's list it keeps stars of its own that predate sync and hands them back to
// upload, once. After that the account's list replaces the phone's, so an unstar made on the web holds.
export async function reconcileFavourites(cache: Cache, userId: string | undefined, serverIds: readonly string[]): Promise<{ ids: string[]; upload: string[] }> {
    if (!userId) return { ids: [], upload: [] };
    const server = serverIds.filter((id) => UUID.test(id)).slice(0, MAX_FAVOURITES);
    const first = !(await cache.read<boolean>(POLICIES.favouritesSynced, userId).catch(() => null))?.value;
    const upload = first ? (await readFavourites(cache, userId)).filter((id) => !server.includes(id)) : [];
    const ids = [...upload, ...server].slice(0, MAX_FAVOURITES);
    await writeFavourites(cache, userId, ids).catch(() => undefined);
    await cache.write(POLICIES.favouritesSynced, true, userId).catch(() => undefined);
    return { ids, upload };
}
