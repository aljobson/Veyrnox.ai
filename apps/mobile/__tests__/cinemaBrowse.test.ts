import { ApiError } from '../src/lib/api';
import { fetchEntitlement, fetchDiscovery, discoveryUrl, firstEpisode, firstWatchable, parseDiscoveryPage, parseEntitlement, titleShareUrl, CATEGORIES } from '../src/lib/cinemaBrowse';
import { titlesUrl } from '../src/lib/cinema';

const ID = '11111111-1111-4111-8111-111111111111';
const ROW = { id: ID, content_type: 'SERIES', title: 'Night shift', synopsis: 's', display_name: 'Studio', username: 'st', episode_count: 40, duration_seconds: null, published_at: '2026-10-01T00:00:00Z', categories: ['drama', 'thriller', 'x'] };
const res = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body }) as unknown as Response;

test('the 12 categories match the server list', () => {
    expect(CATEGORIES.map((c) => c.slug)).toEqual(['romance', 'drama', 'thriller', 'comedy', 'horror', 'sci-fi', 'fantasy', 'action', 'mystery', 'documentary', 'animation', 'kids']);
});

describe('discovery', () => {
    test('builds the URL with mode, category and cursor', () => {
        expect(discoveryUrl('series', null, null, 'https://x')).toBe('https://x/api/cinema/discovery?mode=series');
        expect(discoveryUrl('voting', 'sci-fi', { at: '2026-10-01T00:00:00Z', id: ID }, 'https://x')).toBe(`https://x/api/cinema/discovery?mode=voting&category=sci-fi&before=2026-10-01T00%3A00%3A00Z&before_id=${ID}`);
        expect(titlesUrl(null, 'https://x', 'kids')).toBe('https://x/api/cinema/titles?limit=24&category=kids');
    });
    test('parses titles, categories (max two), competitions and the cursor', () => {
        const page = parseDiscoveryPage({ titles: [{ ...ROW, competitions: [{ id: ID, name: 'Autumn', ends_at: '2026-11-01T00:00:00Z', qualified_votes: 3 }, null] }, { id: 'x' }], next: { at: 'a', id: 'b' } });
        expect(page?.titles).toHaveLength(1);
        expect(page?.titles[0]).toMatchObject({ episodeCount: 40, categories: ['drama', 'thriller'] });
        expect(page?.titles[0].competitions).toEqual([{ id: ID, name: 'Autumn', endsAt: '2026-11-01T00:00:00Z', qualifiedVotes: 3 }]);
        expect(page?.next).toEqual({ at: 'a', id: 'b' });
        expect(parseDiscoveryPage('nope')).toBeNull();
    });
    test('a closed switch is the closed state, not an error', async () => {
        expect(await fetchDiscovery('voting', null, null, async () => res(503, { error: 'voting_not_open' }))).toEqual({ kind: 'closed' });
        expect(await fetchDiscovery('series', null, null, async () => res(503, { error: 'viewing_not_open' }))).toEqual({ kind: 'closed' });
        expect(await fetchDiscovery('series', null, null, async () => res(503, { error: 'temporarily_unavailable' }))).toEqual({ kind: 'error' });
        expect(await fetchDiscovery('series', null, null, async () => { throw new Error('offline'); })).toEqual({ kind: 'error' });
        expect(await fetchDiscovery('series', null, null, async () => res(200, { nope: 1 }))).toEqual({ kind: 'error' });
    });
    test('an ok answer carries the page', async () => {
        const r = await fetchDiscovery('series', null, null, async () => res(200, { titles: [{ ...ROW, competitions: [] }], next: null }));
        expect(r.kind).toBe('ok');
    });
});

describe('entitlement', () => {
    test('free, unlocked and pass are open; locked carries the reason', () => {
        expect(parseEntitlement({ access: 'free', credits: 0 })).toEqual({ kind: 'open' });
        expect(parseEntitlement({ access: 'pass' })).toEqual({ kind: 'open' });
        expect(parseEntitlement({ access: 'locked', reason: 'free_ceiling', credits: 0 })).toEqual({ kind: 'locked', reason: 'free_ceiling', credits: 0 });
        expect(parseEntitlement({ access: 'locked', credits: 6 })).toEqual({ kind: 'locked', reason: 'paid', credits: 6 });
        expect(parseEntitlement(null)).toMatchObject({ kind: 'locked', reason: 'busy' });
    });
    test('typed errors become designed reasons', async () => {
        const fail = (status: number, code: string, body = {}) => ({ request: async () => { throw new ApiError(status, code, body); } });
        expect(await fetchEntitlement(fail(503, 'unlocks_not_open'), ID)).toMatchObject({ reason: 'not_open' });
        expect(await fetchEntitlement(fail(404, 'content_not_found'), ID)).toMatchObject({ reason: 'gone' });
        expect(await fetchEntitlement(fail(0, 'network'), ID)).toMatchObject({ reason: 'network' });
        expect(await fetchEntitlement(fail(402, 'locked', { reason: 'free_ceiling' }), ID)).toMatchObject({ reason: 'free_ceiling' });
        expect(await fetchEntitlement(fail(429, 'rate_limited'), ID)).toMatchObject({ reason: 'busy' });
        expect(await fetchEntitlement({ request: async () => ({ access: 'free' }) as never }, ID)).toEqual({ kind: 'open' });
    });
    test('asks with the id encoded', async () => {
        const seen: string[] = [];
        await fetchEntitlement({ request: async (p: string) => { seen.push(p); return { access: 'free' }; } } as never, ID);
        expect(seen).toEqual([`/api/v1/cinema/entitlement?content_id=${ID}`]);
    });
});

test('episode order and the first watchable one', () => {
    const e = (id: string, season: number, position: number, watchable: boolean) => ({ id, title: id, season, position, durationSeconds: null, watchable });
    const list = [e('b', 1, 2, true), e('a', 1, 1, false), e('c', 2, 1, true)];
    expect(firstEpisode(list)?.id).toBe('a');
    expect(firstWatchable(list)?.id).toBe('b');
    expect(firstWatchable([e('a', 1, 1, false)])).toBeNull();
});

test('the share address is the public title page and refuses a bad id', () => {
    expect(titleShareUrl(ID.toUpperCase())).toBe(`https://veyrnox.ai/social-cinema/title/${ID}`);
    expect(titleShareUrl('../x')).toBeNull();
});

describe('paid locked state (ADR-0207)', () => {
    test('a locked title with a credit price is paid, and no price is carried to the screen text', () => {
        expect(parseEntitlement({ access: 'locked', credits: 6 })).toMatchObject({ reason: 'paid' });
        expect(parseEntitlement({ access: 'locked', credits: 0 })).toMatchObject({ reason: 'locked' });
        expect(parseEntitlement({ access: 'locked', reason: 'free_ceiling', credits: 6 })).toMatchObject({ reason: 'free_ceiling' });
    });
});
