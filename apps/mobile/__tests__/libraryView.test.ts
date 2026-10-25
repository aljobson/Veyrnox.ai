import { MAX_FAVOURITES, canReuse, canSchedule, expiryOf, filterJobs, kindMap, parseProvenance, readFavourites, rowStatus, sizeLabel, toggled, writeFavourites } from '../src/lib/libraryView';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import type { CatalogModel, Job } from '../src/lib/media';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-19T12:00:00Z');

const job = (over: Partial<Job> = {}): Job => ({ job_id: A, state: 'succeeded', credits: 5, model_id: 'img', created_at: '2026-10-01T00:00:00Z', has_asset: true, asset_expires_at: '2027-01-09T00:00:00Z', ...over });
const model = (id: string, modality: string): CatalogModel => ({ id, name: id, modality, credits: 1, gated: false, durations: [], capabilities: null });
const kinds = kindMap([model('img', 'text-to-image'), model('vid', 'text-to-video'), model('aud', 'text-to-speech'), model('odd', 'mystery')]);

describe('filters', () => {
    const jobs = [job({ job_id: A }), job({ job_id: B, state: 'failed', model_id: 'vid' }), job({ job_id: 'c', state: 'running', model_id: 'aud' }), job({ job_id: 'd', model_id: 'gone' })];
    test('by status', () => {
        expect(filterJobs(jobs, { state: 'failed', kind: 'all', favourites: null }, kinds).map((j) => j.job_id)).toEqual([B]);
        expect(filterJobs(jobs, { state: 'all', kind: 'all', favourites: null }, kinds)).toHaveLength(4);
    });
    test('by kind of model; a model the catalog lacks only matches All types', () => {
        expect(filterJobs(jobs, { state: 'all', kind: 'video', favourites: null }, kinds).map((j) => j.job_id)).toEqual([B]);
        expect(filterJobs(jobs, { state: 'all', kind: 'image', favourites: null }, kinds).map((j) => j.job_id)).toEqual([A]);
        expect(filterJobs(jobs, { state: 'all', kind: 'all', favourites: null }, kinds).map((j) => j.job_id)).toContain('d');
    });
    test('favourites keep only starred ids, and combine with the other filters', () => {
        expect(filterJobs(jobs, { state: 'all', kind: 'all', favourites: [B] }, kinds).map((j) => j.job_id)).toEqual([B]);
        expect(filterJobs(jobs, { state: 'succeeded', kind: 'all', favourites: [B] }, kinds)).toEqual([]);
        expect(filterJobs(jobs, { state: 'all', kind: 'all', favourites: [] }, kinds)).toEqual([]);
    });
    test('models of an unknown kind are left out of the map', () => expect(kinds.has('odd')).toBe(false));
});

describe('expiry and status', () => {
    test('a stored file says when it expires; past that date it is gone', () => {
        const e = expiryOf(job(), NOW);
        expect(e.kind).toBe('on');
        expect(expiryOf(job({ asset_expires_at: '2026-10-01T00:00:00Z' }), NOW).kind).toBe('gone');
    });
    test('no expiry for a job without a stored, unheld file or without a date', () => {
        expect(expiryOf(job({ state: 'failed' }), NOW).kind).toBe('none');
        expect(expiryOf(job({ has_asset: false }), NOW).kind).toBe('none');
        expect(expiryOf(job({ held: true }), NOW).kind).toBe('none');
        expect(expiryOf(job({ asset_expires_at: null }), NOW).kind).toBe('none');
        expect(expiryOf(job({ asset_expires_at: 'soon' }), NOW).kind).toBe('none');
    });
    test('a failed job is only called refunded when the server says so', () => {
        expect(rowStatus(job({ state: 'failed', refunded: true }))).toBe('refunded');
        expect(rowStatus(job({ state: 'failed' }))).toBe('failed');
        expect(rowStatus(job({ held: true }))).toBe('held');
        expect(rowStatus(job({ state: 'running' }))).toBe('creating');
        expect(rowStatus(job({ state: 'queued' }))).toBe('queued');
        expect(rowStatus(job())).toBe('ready');
    });
});

describe('Schedule this', () => {
    test('offered for stored, unheld, unexpired images and videos only', () => {
        expect(canSchedule(job(), kinds, NOW)).toBe(true);
        expect(canSchedule(job({ model_id: 'vid' }), kinds, NOW)).toBe(true);
        expect(canSchedule(job({ model_id: 'aud' }), kinds, NOW)).toBe(false);
        expect(canSchedule(job({ model_id: 'gone' }), kinds, NOW)).toBe(false);
        expect(canSchedule(job({ held: true }), kinds, NOW)).toBe(false);
        expect(canSchedule(job({ state: 'running' }), kinds, NOW)).toBe(false);
        expect(canSchedule(job({ has_asset: false }), kinds, NOW)).toBe(false);
        expect(canSchedule(job({ asset_expires_at: '2026-10-01T00:00:00Z' }), kinds, NOW)).toBe(false);
    });
});

describe('Use in another tool', () => {
    test('offered for every stored, unheld, unexpired known media kind', () => {
        expect(canReuse(job(), kinds, NOW)).toBe(true);
        expect(canReuse(job({ model_id: 'vid' }), kinds, NOW)).toBe(true);
        expect(canReuse(job({ model_id: 'aud' }), kinds, NOW)).toBe(true);
        expect(canReuse(job({ model_id: 'gone' }), kinds, NOW)).toBe(false);
        expect(canReuse(job({ held: true }), kinds, NOW)).toBe(false);
        expect(canReuse(job({ state: 'running' }), kinds, NOW)).toBe(false);
        expect(canReuse(job({ has_asset: false }), kinds, NOW)).toBe(false);
        expect(canReuse(job({ asset_expires_at: '2026-10-01T00:00:00Z' }), kinds, NOW)).toBe(false);
    });
});

describe('favourites', () => {
    test('toggle adds newest first, removes, ignores a bad id and caps the list', () => {
        expect(toggled([], A)).toEqual([A]);
        expect(toggled([A], B)).toEqual([B, A]);
        expect(toggled([B, A], B)).toEqual([A]);
        expect(toggled([A], 'not-an-id')).toEqual([A]);
        const many = Array.from({ length: MAX_FAVOURITES }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
        expect(toggled(many, B)).toHaveLength(MAX_FAVOURITES);
        expect(toggled(many, B)[0]).toBe(B);
    });
    test('saved per account, never shared, gone after a wipe', async () => {
        const cache = createCache(createMemoryStorage());
        await writeFavourites(cache, 'u1', [A, B]);
        expect(await readFavourites(cache, 'u1')).toEqual([A, B]);
        expect(await readFavourites(cache, 'u2')).toEqual([]);
        await writeFavourites(cache, undefined, [A]);
        expect(await readFavourites(cache, undefined)).toEqual([]);
        await cache.clear();
        expect(await readFavourites(cache, 'u1')).toEqual([]);
    });
    test('reads back only well formed ids', async () => {
        const cache = createCache(createMemoryStorage());
        await writeFavourites(cache, 'u1', [A, 'x', 5 as unknown as string]);
        expect(await readFavourites(cache, 'u1')).toEqual([A]);
    });
});

describe('provenance record', () => {
    const body = { generated: true, model: { id: 'm', name: 'Model M' }, credits: 4, created_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', content: { sha256: 'A'.repeat(64), mime_type: 'image/png', size_bytes: 2048 } };
    test('reads the model, date, cost and file', () => {
        expect(parseProvenance(body)).toEqual({ model: 'Model M', madeAt: '2026-10-01T00:01:00Z', credits: 4, mime: 'image/png', sizeBytes: 2048, sha256: 'a'.repeat(64) });
    });
    test('a missing or malformed digest stays null; nothing is invented', () => {
        expect(parseProvenance({ ...body, content: { sha256: 'zz', mime_type: 'image/png', size_bytes: 1 } })?.sha256).toBeNull();
        expect(parseProvenance({ ...body, content: null })?.mime).toBeNull();
        expect(parseProvenance({ ...body, model: { id: 'only-id' } })?.model).toBe('only-id');
    });
    test('refuses anything that is not a generation record', () => {
        expect(parseProvenance(null)).toBeNull();
        expect(parseProvenance({ generated: false })).toBeNull();
        expect(parseProvenance({ generated: true, model: {} })).toBeNull();
    });
    test('file sizes read plainly', () => {
        expect(sizeLabel(null)).toBeNull();
        expect(sizeLabel(512)).toBe('512 B');
        expect(sizeLabel(2048)).toBe('2 KB');
        expect(sizeLabel(5 * 1024 * 1024)).toBe('5.0 MB');
    });
});
