import { t } from './i18n';
import type { ApiClient } from './api';
import { appCache, getCacheUser, subscribeCacheUser } from './appCache';
import { POLICIES, type Cache } from './cache';
import { MAX_FILM_BYTES, parseFilm, type Film } from './filmStudio';
import { loadStudio, readStudioSlot, saveStudio } from './filmStudioStore';

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
            name: (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : t('filmCloud.untitledfilm')).slice(0, 120),
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
let generation = 0;
let editSeq = 0;
type Sent = { id: string | null; expected: number | null; raw: string; key: string; asNew: boolean; origin: ActiveCloudLink | null };
let unconfirmed: Sent | null = null;
const removedIds = new Set<string>();
export const SAVE_SETTLE_MS = 15_000;
const sameLink = (a: ActiveCloudLink | null, b: ActiveCloudLink | null) => a?.id === b?.id && a?.revision === b?.revision;
export const getCloudSaveStatus = (film: Film) => {
    if (!getActiveCloudLink()) return { kind: 'phone' } as const;
    return lastSaved?.raw === JSON.stringify(film)
        ? { kind: 'saved', date: lastSaved.project.updatedAt } as const : { kind: 'dirty' } as const;
};
let latest: { owner: string; generation: number; raw: string; film: Film } | null = null;
let inFlight: { owner: string; generation: number; promise: Promise<CloudFilm> } | null = null;
let lastSaved: { raw: string; project: CloudFilm } | null = null;
const retryKeys = new Map<string, string>();
subscribeCacheUser(clearOpenedFilm);
export const getFilmGeneration = () => generation;
export const getOpenedFilm = () => opened?.owner === getCacheUser() ? opened : null;
export const getActiveCloudLink = (): ActiveCloudLink | null => getOpenedFilm()?.cloud ?? null;
export function clearOpenedFilm(): void {
    generation++;
    opened = null; unconfirmed = null; removedIds.clear(); editSeq++; latest = null; inFlight = null; lastSaved = null; retryKeys.clear();
}

export async function replaceActiveStudio(film: Film, cache: Cache = appCache): Promise<void> {
    const owner = getCacheUser();
    if (!owner) throw new Error(t('filmCloud.signintokeepastudioon'));
    const raw = JSON.stringify(film);
    editSeq++;
    latest = { owner, generation, raw, film };
    const active = getOpenedFilm();
    if (active) {
        opened = { ...active, raw, film, openedAt: Date.now() };
        return;
    }
    const saved = await saveStudio(raw, cache, owner);
    if (!saved.ok) throw new Error(saved.error);
}

export type CloudSaveError = { kind: 'tooLarge' | 'limit' | 'rateLimited' | 'conflict' | 'offline' | 'unavailable' | 'removedElsewhere' | 'failed'; seconds?: number };
export async function cloudSaveError(err: unknown, api?: Reader, putId?: string): Promise<CloudSaveError> {
    const e = record(err), status = e.status;
    if (e.code === 'tooLarge') return { kind: 'tooLarge' };
    if (status === 409) return { kind: 'conflict' };
    if (status === 429) return record(record(e.body).error).code === 'LIMIT_REACHED'
        ? { kind: 'limit' } : { kind: 'rateLimited', seconds: typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : 60 };
    if (status === 0) return { kind: 'offline' };
    if (status === 404 && api && putId) {
        try { if (!(await fetchCloudFilms(api)).some(p => p.id === putId)) return { kind: 'removedElsewhere' }; } catch { /* No confirmed absence. */ }
    }
    return { kind: status === 403 || status === 503 || status === 404 ? 'unavailable' : 'failed' };
}
const unanswered = (err: unknown) => record(err).status === 0 || Number(record(err).status) >= 500;

export async function saveActiveStudioToCloud(api: Reader, film: Film, idempotencyKey: string,
    options: { asNew?: boolean; replay?: Sent } = {}): Promise<CloudFilm> {
    const owner = getCacheUser(), captured = generation;
    if (!owner) throw new Error('not_authenticated');
    const raw = options.replay?.raw ?? JSON.stringify(film);
    // UTF-8 bytes, without relying on a native TextEncoder implementation.
    if (unescape(encodeURIComponent(raw)).length > MAX_FILM_BYTES) throw Object.assign(new Error('tooLarge'), { code: 'tooLarge' });
    const parsed = parseFilm(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const current = () => owner === getCacheUser() && captured === generation;
    if (!options.replay) {
        latest = { owner, generation: captured, raw, film: parsed.film }; editSeq++;
        const active = getOpenedFilm();
        if (active) opened = { ...active, raw, film: parsed.film };
    }
    const previous = inFlight?.owner === owner && inFlight.generation === captured ? inFlight.promise : null;
    const run = async (): Promise<CloudFilm> => {
        const preceding = previous ? await previous.catch(() => null) : null;
        if (!current()) throw new Error('film_session_changed');
        if (!options.asNew && !options.replay && preceding && lastSaved?.project === preceding && lastSaved.raw === raw) return lastSaved.project;
        const link = getActiveCloudLink(), asNew = !!options.asNew;
        const fingerprint = JSON.stringify(asNew ? ['asNew', link, raw] : [link, raw]);
        const key = options.replay?.key ?? retryKeys.get(fingerprint) ?? idempotencyKey;
        retryKeys.set(fingerprint, key);
        const sent: Sent = options.replay ?? { id: asNew ? null : link?.id ?? null, expected: asNew ? null : link?.revision ?? null, raw, key, asNew, origin: asNew ? link : null };
        const send = () => api.request(sent.id ? cloudFilmPath(sent.id) : CLOUD_FILMS_PATH, {
            method: sent.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sent.key },
            body: JSON.stringify(sent.id ? { expected_revision: sent.expected, studio_json: sent.raw } : { studio_json: sent.raw }),
        });
        let response: unknown;
        try {
            try { response = await send(); }
            catch (err) { if (!unanswered(err) || !current()) throw err; response = await send(); }
        } catch (err) {
            if (current() && sent.id && unanswered(err)) unconfirmed = sent;
            throw err;
        }
        const [project] = parseCloudFilms({ projects: [record(response).project] });
        if (!project) throw new Error('invalid_cloud_response');
        const held = getActiveCloudLink();
        const adopt = sent.id ? project.id === sent.id && project.revision === sent.expected! + 1 &&
            held?.id === sent.id && project.revision > held.revision
            : sent.asNew ? sameLink(held, sent.origin) && project.id !== sent.origin?.id : held === null;
        if (current() && adopt && !removedIds.has(project.id)) {
            const now = getOpenedFilm();
            const edit = latest?.owner === owner && latest.generation === captured ? latest : { raw, film: parsed.film };
            opened = { owner, raw: now?.raw ?? edit.raw, film: now?.film ?? edit.film,
                openedAt: now?.openedAt ?? Date.now(), cloud: { id: project.id, revision: project.revision } };
            editSeq++; lastSaved = { raw, project }; retryKeys.delete(fingerprint);
            if (unconfirmed?.id === sent.id) unconfirmed = null;
        }
        return project;
    };
    const promise = run();
    const pending = { owner, generation: captured, promise };
    inFlight = pending;
    try { return await promise; }
    finally { if (inFlight === pending) inFlight = null; }
}

export type Prepared = { kind: 'kept' | 'memoryOnly'; owner: string; generation: number; editSeq: number; cache: Cache;
    restore?: { value: unknown; name: string } };
export type PrepareResult = Prepared | { kind: 'localConflict'; localName: string } | { kind: 'unreadable' | 'notKept' | 'changed' };
async function keepCurrent(owner: string, captured: number, cache: Cache): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const active = getOpenedFilm(), seq = editSeq;
        if (!active || owner !== getCacheUser() || captured !== generation) return null;
        const saved = await saveStudio(active.raw, cache, owner);
        if (owner !== getCacheUser() || captured !== generation) return null;
        if (!saved.ok) return null;
        if (seq === editSeq) return seq;
    }
    return null;
}
export async function prepareKeepOnPhone(owner: string, choice?: 'replace' | 'keep', cache: Cache = appCache): Promise<PrepareResult> {
    const captured = generation, active = getOpenedFilm();
    if (!active || owner !== getCacheUser()) return { kind: 'changed' };
    const slot = await readStudioSlot(cache, owner);
    if (owner !== getCacheUser() || captured !== generation) return { kind: 'changed' };
    if (slot.state === 'error') return { kind: 'unreadable' };
    const other = slot.state === 'present' && slot.value !== getOpenedFilm()?.raw;
    const parsed = slot.state === 'present' && typeof slot.value === 'string' ? parseFilm(slot.value) : null;
    const localName = parsed?.ok && parsed.film.name ? parsed.film.name : t('filmCloud.untitledfilm');
    if (other && !choice) return { kind: 'localConflict', localName };
    const base = { owner, generation: captured, cache, editSeq };
    if (choice === 'keep') return { ...base, kind: 'memoryOnly' };
    const restore = other && slot.state === 'present' ? { value: slot.value, name: localName } : undefined;
    const seq = await keepCurrent(owner, captured, cache);
    if (seq === null) {
        await restorePhoneSlot({ ...base, kind: 'kept', restore });
        return { kind: 'notKept' };
    }
    return { ...base, kind: 'kept', editSeq: seq, restore };
}
export async function restorePhoneSlot(prepared: Prepared): Promise<boolean> {
    if (!prepared.restore || prepared.owner !== getCacheUser()) return true;
    await prepared.cache.write(POLICIES.filmStudio, prepared.restore.value, prepared.owner).catch(() => undefined);
    const slot = await readStudioSlot(prepared.cache, prepared.owner);
    return slot.state === 'present' && slot.value === prepared.restore.value;
}
export async function commitUnlink(id: string, prepared: Prepared): Promise<{ film: Film; memoryOnly: boolean } | null> {
    const active = getOpenedFilm();
    if (!active || active.cloud?.id !== id || prepared.owner !== getCacheUser() || prepared.generation !== generation) return null;
    removedIds.add(id); const unlinkedGeneration = ++generation; inFlight = null; unconfirmed = null; lastSaved = null; retryKeys.clear(); latest = null;
    // Removal is confirmed: detach synchronously before persistence can yield to another session.
    opened = { ...active, cloud: null };
    let kept = prepared.kind === 'kept';
    if (kept && prepared.editSeq !== editSeq) kept = await keepCurrent(prepared.owner, generation, prepared.cache) !== null;
    if (prepared.owner !== getCacheUser() || generation !== unlinkedGeneration) return null;
    const film = getOpenedFilm()!.film;
    opened = kept ? null : { ...getOpenedFilm()!, cloud: null };
    return { film, memoryOnly: !kept };
}
export async function removeCloudFilm(api: Reader, row: CloudFilm): Promise<'removed' | 'busy' | 'changed' | 'unavailable' | 'failed'> {
    const owner = getCacheUser(), captured = generation;
    const current = () => owner === getCacheUser() && captured === generation;
    const linked = getActiveCloudLink()?.id === row.id;
    const deadline = Date.now() + SAVE_SETTLE_MS;
    while (linked && inFlight && current()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const pending = inFlight;
        const settled = await Promise.race([pending.promise.then(() => true, () => true),
            new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); })]);
        if (timer) clearTimeout(timer);
        if (!settled) return 'busy';
        if (inFlight === pending) inFlight = null;
    }
    if (!current()) return 'changed';
    if (linked && unconfirmed?.id === row.id) {
        const sent = unconfirmed;
        try { await saveActiveStudioToCloud(api, getOpenedFilm()!.film, sent.key, { replay: sent }); }
        catch (err) { return record(err).status === 409 ? 'changed' : 'unavailable'; }
        if (unconfirmed) return 'changed';
    }
    if (!current()) return 'changed';
    const link = getActiveCloudLink();
    if (linked && link?.id !== row.id) return 'changed';
    try {
        const body = await api.request(cloudFilmPath(row.id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expected_revision: linked ? link!.revision : row.revision }) });
        if (!current()) return 'changed';
        return record(body).removed === true ? 'removed' : 'unavailable';
    } catch (err) {
        const status = record(err).status;
        return status === 409 ? 'changed' : status === 404 || status === 403 || status === 503 ? 'unavailable' : 'failed';
    }
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
    const captured = ++generation;
    latest = null; inFlight = null; unconfirmed = null; lastSaved = null; retryKeys.clear();
    let invalidated = false;
    const unsubscribe = subscribeCacheUser(() => { invalidated = true; });
    const switched = () => captured !== generation || invalidated || getCacheUser() !== owner || signal?.aborted;
    try {
        const result = await fetchCloudFilm(api, id);
        if (switched()) return { ok: false, reason: 'switched' };
        if (!result) return { ok: false, reason: 'invalid' };
        const parsed = parseFilm(result.raw);
        if (!parsed.ok) return { ok: false, reason: 'invalid' };
        // Ownership check and assignment are synchronous: no disk write can outlive a session.
        if (switched()) return { ok: false, reason: 'switched' };
        opened = { owner, raw: result.raw, film: parsed.film, openedAt: Date.now(), cloud: { id: result.film.id, revision: result.film.revision } };
        editSeq++; lastSaved = { raw: JSON.stringify(parsed.film), project: result.film };
        return { ok: true, film: parsed.film };
    } catch (err) {
        return { ok: false, reason: switched() ? 'switched' : cloudStatus(err) };
    } finally { unsubscribe(); }
}
