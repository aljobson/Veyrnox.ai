import type { ApiClient } from './api';
import { appCache, getCacheUser, subscribeCacheUser } from './appCache';
import type { Cache } from './cache';
import { parseFilm, type Film } from './filmStudio';
import { loadStudio, saveStudio } from './filmStudioStore';

export const CLOUD_FILMS_PATH = '/api/v1/film-studio';
export const CLOUD_FILM_LIMIT = 20;
export const CLOUD_FILM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cloudFilmPath = (id: string) => `${CLOUD_FILMS_PATH}/${encodeURIComponent(id)}`;
type Reader = Pick<ApiClient, 'request'>;
export interface CloudFilm { id: string; name: string; shotCount: number; revision: number; updatedAt: string | null }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parseCloudFilms(body: unknown): CloudFilm[] {
    const rows = record(body).projects;
    if (!Array.isArray(rows)) return [];
    const films: CloudFilm[] = [];
    for (const value of rows) {
        const row = record(value);
        if (typeof row.id !== 'string' || !CLOUD_FILM_UUID.test(row.id) || typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1) continue;
        films.push({
            id: row.id,
            name: (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Untitled film').slice(0, 120),
            shotCount: typeof row.shot_count === 'number' && Number.isInteger(row.shot_count) && row.shot_count >= 0 && row.shot_count <= 200 ? row.shot_count : 0,
            revision: row.revision,
            updatedAt: typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : null,
        });
        if (films.length === CLOUD_FILM_LIMIT) break;
    }
    return films;
}

export async function fetchCloudFilms(api: Reader): Promise<CloudFilm[]> {
    return parseCloudFilms(await api.request(CLOUD_FILMS_PATH));
}

export async function fetchCloudFilm(api: Reader, id: string): Promise<{ film: CloudFilm; raw: string } | null> {
    const body = record(await api.request(cloudFilmPath(id)));
    const [film] = parseCloudFilms({ projects: [body.project] });
    if (!film || film.id !== id || typeof body.studio_json !== 'string' || !parseFilm(body.studio_json).ok) return null;
    return { film, raw: body.studio_json };
}

export function cloudStatus(err: unknown): 'offline' | 'unavailable' | 'busy' | 'gone' | 'error' {
    switch (record(err).status) {
        case 0: return 'offline';
        case 401: case 403: return 'unavailable';
        case 404: return 'gone';
        case 429: case 502: case 503: return 'busy';
        default: return 'error';
    }
}

export interface ActiveCloudLink { readonly id: string; readonly revision: number }
let opened: { owner: string; raw: string; film: Film; openedAt: number; cloud: ActiveCloudLink | null } | null = null;
subscribeCacheUser(() => { opened = null; });
export const getOpenedFilm = () => opened?.owner === getCacheUser() ? opened : null;
export const getActiveCloudLink = (): ActiveCloudLink | null => getOpenedFilm()?.cloud ?? null;
export function clearOpenedFilm(): void { opened = null; }

export async function replaceActiveStudio(film: Film, cache: Cache = appCache): Promise<void> {
    const owner = getCacheUser();
    if (!owner) throw new Error('Sign in to keep a studio on this phone.');
    const raw = JSON.stringify(film);
    const active = getOpenedFilm();
    if (active) {
        opened = { ...active, raw, film, openedAt: Date.now() };
        return;
    }
    const saved = await saveStudio(raw, cache, owner);
    if (!saved.ok) throw new Error(saved.error);
}

export async function saveActiveStudioToCloud(api: Reader, film: Film, idempotencyKey: string): Promise<CloudFilm> {
    const owner = getCacheUser();
    if (!owner) throw new Error('not_authenticated');
    const raw = JSON.stringify(film);
    const parsed = parseFilm(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const link = getActiveCloudLink();
    const body = link ? { expected_revision: link.revision, studio_json: raw } : { studio_json: raw };
    const response = record(await api.request(link ? cloudFilmPath(link.id) : CLOUD_FILMS_PATH, {
        method: link ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
    }));
    const [project] = parseCloudFilms({ projects: [response.project] });
    if (!project) throw new Error('invalid_cloud_response');
    opened = { owner, raw, film: parsed.film, openedAt: Date.now(), cloud: { id: project.id, revision: project.revision } };
    return project;
}

export async function loadActiveStudio(cache: Cache = appCache): Promise<{ film: Film; savedAt: number } | null> {
    const active = getOpenedFilm();
    return active ? { film: active.film, savedAt: active.openedAt } : loadStudio(cache);
}

type OpenResult = { ok: true; film: Film } | { ok: false; reason: ReturnType<typeof cloudStatus> | 'invalid' | 'switched' };
// The cache argument remains injectable for callers/tests; a cloud open never reads or writes it.
export async function openCloudFilm(api: Reader, id: string, _cache: Cache = appCache, signal?: AbortSignal): Promise<OpenResult> {
    const owner = getCacheUser();
    if (owner === undefined) return { ok: false, reason: 'unavailable' };
    let invalidated = false;
    const unsubscribe = subscribeCacheUser(() => { invalidated = true; });
    const switched = () => invalidated || getCacheUser() !== owner || signal?.aborted;
    try {
        const result = await fetchCloudFilm(api, id);
        if (switched()) return { ok: false, reason: 'switched' };
        if (!result) return { ok: false, reason: 'invalid' };
        const parsed = parseFilm(result.raw);
        if (!parsed.ok) return { ok: false, reason: 'invalid' };
        // Ownership check and assignment are synchronous: no disk write can outlive a session.
        if (switched()) return { ok: false, reason: 'switched' };
        opened = { owner, raw: result.raw, film: parsed.film, openedAt: Date.now(), cloud: { id: result.film.id, revision: result.film.revision } };
        return { ok: true, film: parsed.film };
    } catch (err) {
        return { ok: false, reason: switched() ? 'switched' : cloudStatus(err) };
    } finally { unsubscribe(); }
}
