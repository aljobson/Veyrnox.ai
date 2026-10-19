import { formatDuration, parseTitleDetail, parseTitlesPage, posterUrl, titlesUrl } from '../src/lib/cinema';

const ID = '11111111-1111-4111-8111-111111111111';
const ROW = { id: ID, content_type: 'SHORT', title: 'Night shift', synopsis: 's', display_name: 'Studio', username: 'st', episode_count: 0, duration_seconds: 94, published_at: '2026-10-01T00:00:00Z' };

describe('titles page', () => {
    test('maps rows and the cursor', () => {
        const page = parseTitlesPage({ titles: [ROW, { id: 'x', content_type: 'WEIRD' }, null], next: '2026-10-01T00:00:00Z', next_id: ID });
        expect(page.titles).toHaveLength(1);
        expect(page.titles[0]).toMatchObject({ id: ID, contentType: 'SHORT', creator: 'Studio', durationSeconds: 94 });
        expect(page.next).toEqual({ before: '2026-10-01T00:00:00Z', beforeId: ID });
    });
    test('no cursor on the last page, and junk gives an empty page', () => {
        expect(parseTitlesPage({ titles: [ROW], next: null, next_id: null }).next).toBeNull();
        expect(parseTitlesPage('nope')).toEqual({ titles: [], next: null });
    });
    test('builds the anonymous URLs', () => {
        expect(titlesUrl(null, 'https://x')).toBe('https://x/api/cinema/titles?limit=24');
        expect(titlesUrl({ before: '2026-10-01T00:00:00+01:00', beforeId: ID }, 'https://x')).toBe(
            `https://x/api/cinema/titles?limit=24&before=2026-10-01T00%3A00%3A00%2B01%3A00&before_id=${ID}`,
        );
        expect(posterUrl(ID, 'https://x')).toBe(`https://x/api/cinema/posters/${ID}`);
    });
});

describe('title detail', () => {
    test('a free film is watchable, a locked one is not', () => {
        expect(parseTitleDetail({ title: { ...ROW, creator: { display_name: 'C' }, access: 'free' } })?.watchable).toBe(true);
        expect(parseTitleDetail({ title: { ...ROW, access: 'locked', reason: 'free_ceiling' } })?.watchable).toBe(false);
    });
    test('a series lists its episodes with free ones watchable only', () => {
        const d = parseTitleDetail({
            title: { ...ROW, content_type: 'SERIES', seasons: [{ position: 1, episodes: [
                { id: 'e1', position: 1, title: 'One', access: 'free', duration_seconds: 60 },
                { id: 'e2', position: 2, title: 'Two', access: 'locked' },
            ] }] },
        });
        expect(d?.watchable).toBe(false);
        expect(d?.episodes.map((e) => [e.id, e.season, e.watchable])).toEqual([['e1', 1, true], ['e2', 1, false]]);
    });
    test('rejects a body without a title', () => {
        expect(parseTitleDetail({})).toBeNull();
    });
});

test('formats a duration', () => {
    expect(formatDuration(94)).toBe('1:34');
    expect(formatDuration(null)).toBe('');
});

describe('creator username (for blocking)', () => {
    test('is kept only when it is a valid username', () => {
        const ok = parseTitleDetail({ title: { ...ROW, creator: { display_name: 'C', username: 'studio_9' } } });
        const bad = parseTitleDetail({ title: { ...ROW, creator: { display_name: 'C', username: 'Not Valid!' } } });
        const none = parseTitleDetail({ title: { ...ROW, creator: { display_name: 'C' } } });
        expect(ok?.title.creatorUsername).toBe('studio_9');
        expect(bad?.title.creatorUsername).toBeNull();
        expect(none?.title.creatorUsername).toBeNull();
    });
});
