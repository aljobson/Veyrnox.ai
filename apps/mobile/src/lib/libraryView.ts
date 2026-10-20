import { POLICIES, type Cache } from './cache';
import { kindOf, type CatalogModel, type Job, type JobState, type Kind } from './media';

// ADR-0156: what the Library screen shows and how it is filtered. Mirrors app/veyrnox/_lib/{libraryFilter,favourites}.js.
// The server owns the list; the filters and favourites below are local and change nothing on the server.

export const STATE_FILTERS = ['all', 'succeeded', 'running', 'queued', 'failed'] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
export const KIND_FILTERS = ['all', 'image', 'video', 'audio'] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];
export const VIEWS = ['grid', 'list'] as const;
export type View = (typeof VIEWS)[number];

// What a job made. The list returns no file type, so this is the kind of the model that ran it (the cached catalog).
// A model the catalog no longer lists has no kind and matches only "All types".
export function kindMap(models: readonly CatalogModel[]): Map<string, Kind> {
    const out = new Map<string, Kind>();
    for (const m of models) {
        const k = kindOf(m.modality);
        if (k) out.set(m.id, k);
    }
    return out;
}

export interface Filters {
    readonly state: StateFilter;
    readonly kind: KindFilter;
    // Job ids, when only starred creations should show.
    readonly favourites: readonly string[] | null;
}

export function filterJobs(jobs: readonly Job[], f: Filters, kinds: ReadonlyMap<string, Kind>): Job[] {
    return jobs.filter(
        (j) => (f.state === 'all' || j.state === (f.state as JobState)) && (f.kind === 'all' || kinds.get(j.model_id) === f.kind) && (!f.favourites || f.favourites.includes(j.job_id)),
    );
}

export type Expiry = { readonly kind: 'none' } | { readonly kind: 'on'; readonly date: Date } | { readonly kind: 'gone' };

// Only a stored, unheld file has an expiry worth saying. Past the date the file is gone.
export function expiryOf(job: Job, now: number = Date.now()): Expiry {
    if (job.state !== 'succeeded' || !job.has_asset || job.held || !job.asset_expires_at) return { kind: 'none' };
    const at = Date.parse(job.asset_expires_at);
    if (!Number.isFinite(at)) return { kind: 'none' };
    return at <= now ? { kind: 'gone' } : { kind: 'on', date: new Date(at) };
}

export type RowStatus = 'ready' | 'creating' | 'queued' | 'refunded' | 'failed' | 'held';

export function rowStatus(job: Job): RowStatus {
    if (job.held) return 'held';
    if (job.state === 'failed') return job.refunded ? 'refunded' : 'failed';
    return job.state === 'succeeded' ? 'ready' : job.state === 'running' ? 'creating' : 'queued';
}

// The composer takes images and videos, so only those can be scheduled, and only once the file exists and is not held.
export function canSchedule(job: Job, kinds: ReadonlyMap<string, Kind>, now: number = Date.now()): boolean {
    const k = kinds.get(job.model_id);
    return job.state === 'succeeded' && job.has_asset && !job.held && (k === 'image' || k === 'video') && expiryOf(job, now).kind !== 'gone';
}

export const MAX_FAVOURITES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Starred job ids, newest first, kept on this phone for this account. Not synced: another device has its own.
export async function readFavourites(cache: Cache, userId: string | undefined): Promise<string[]> {
    const saved = await cache.read<unknown>(POLICIES.favourites, userId).catch(() => null);
    const list = saved?.value;
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && UUID.test(id)).slice(0, MAX_FAVOURITES) : [];
}

export function toggled(current: readonly string[], jobId: string): string[] {
    if (!UUID.test(jobId)) return [...current];
    return current.includes(jobId) ? current.filter((id) => id !== jobId) : [jobId, ...current].slice(0, MAX_FAVOURITES);
}

export async function writeFavourites(cache: Cache, userId: string | undefined, ids: readonly string[]): Promise<void> {
    if (!userId) return;
    await cache.write(POLICIES.favourites, ids, userId);
}

export interface Provenance {
    readonly model: string;
    readonly madeAt: string | null;
    readonly credits: number | null;
    readonly mime: string | null;
    readonly sizeBytes: number | null;
    readonly sha256: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// GET /api/v1/jobs/:id/provenance. Nothing here is invented: a missing digest stays null, and the screen then says
// the record does not match a file you hold to it (the server's own wording of the same limit).
export function parseProvenance(body: unknown): Provenance | null {
    if (!isObject(body) || body.generated !== true) return null;
    const model = isObject(body.model) ? body.model : {};
    const content = isObject(body.content) ? body.content : {};
    const name = typeof model.name === 'string' && model.name ? model.name : typeof model.id === 'string' ? model.id : null;
    if (!name) return null;
    const sha = typeof content.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(content.sha256) ? content.sha256.toLowerCase() : null;
    return {
        model: name,
        madeAt: typeof body.completed_at === 'string' ? body.completed_at : typeof body.created_at === 'string' ? body.created_at : null,
        credits: typeof body.credits === 'number' && Number.isFinite(body.credits) ? body.credits : null,
        mime: typeof content.mime_type === 'string' ? content.mime_type : null,
        sizeBytes: typeof content.size_bytes === 'number' && content.size_bytes >= 0 ? content.size_bytes : null,
        sha256: sha,
    };
}

export function sizeLabel(bytes: number | null): string | null {
    if (bytes === null) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
