import { EDITORIAL_SERIES } from '../src/lib/cinemaEditorialData';
import { editorialSeriesList, editorialSeriesBySlug, editorialSeriesWebUrl, editorialEpisodeWebUrl, phoneCategories, episodeLock, parseEpisodeLocks } from '../src/lib/cinemaSeries';
import { CATEGORIES } from '../src/lib/cinemaBrowse';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, '../../app/veyrnox/social-cinema/editorialSeries.js'), 'utf8').replace(/^export /gm, '');
const web = new Function(`${source}\nreturn { editorialSeries, editorialSeriesCards };`)();
const projection = (s: any) => ({
    slug: s.slug, title: s.title, season: s.season, seasonTitle: s.seasonTitle,
    description: s.description, posterUrl: s.posterUrl, categories: s.categories,
    creatorName: s.creator.name, sourceName: s.source.name,
    episodes: s.episodes.map((e: any) => ({ id: e.id, position: e.position, title: e.title, durationSeconds: e.durationSeconds })),
});

test('generated data preserves every projected field and source order', () => {
    expect(web.editorialSeries.map(projection)).toEqual(EDITORIAL_SERIES);
    expect(() => execFileSync('node', ['scripts/sync-cinema-series.mjs', '--check'], { cwd: root })).not.toThrow();
});

test('URLs only accept known series and their own episodes', () => {
    const [a, b] = EDITORIAL_SERIES;
    expect(editorialSeriesWebUrl(a.slug)).toBe(`https://veyrnox.ai/social-cinema/series/${a.slug}`);
    expect(editorialEpisodeWebUrl(a.slug, a.episodes[0].id)).toBe(`https://veyrnox.ai/social-cinema/watch/${a.episodes[0].id}?series=${a.slug}`);
    expect(editorialEpisodeWebUrl(a.slug, b.episodes[0].id)).toBeNull();
    for (const bad of ['', 'unknown', 'constructor', '../x']) {
        expect(editorialSeriesBySlug(bad)).toBeNull();
        expect(editorialSeriesWebUrl(bad)).toBeNull();
        expect(editorialEpisodeWebUrl(bad, a.episodes[0].id)).toBeNull();
        expect(editorialEpisodeWebUrl(a.slug, bad)).toBeNull();
    }
});

test('categories match web filtering while phone chips omit adventure', () => {
    for (const { slug } of CATEGORIES) {
        expect(editorialSeriesList(slug).map(s => s.slug)).toEqual(web.editorialSeriesCards(slug).map((s: any) => s.series_slug));
    }
    expect(editorialSeriesList(null)).toEqual(EDITORIAL_SERIES);
    expect(phoneCategories(['sci-fi', 'adventure'])).toEqual(['sci-fi']);
});

test.each([
    [{ access: 'free' }, null], [{ access: 'locked', reason: 'free_ceiling', credits: 0 }, 'free_ceiling'],
    [{ access: 'locked', credits: 6 }, 'paid'], [{ access: 'pass' }, 'locked'], [{ access: 'unlocked' }, 'locked'], [null, 'busy'],
])('episodeLock(%j) = %s', (raw, expected) => expect(episodeLock(raw)).toBe(expected));

test('episode locks traverse multiple seasons and tolerate malformed detail', () => {
    expect([...parseEpisodeLocks({ title: { seasons: [
        { episodes: [{ id: 'one', access: 'free' }, { id: 'two', access: 'locked', credits: 6 }] },
        { episodes: [{ id: 'three', access: 'locked', reason: 'free_ceiling' }, null] }, null,
    ] } })]).toEqual([['one', null], ['two', 'paid'], ['three', 'free_ceiling']]);
    expect(parseEpisodeLocks(null).size).toBe(0);
});

// Isolate generator rejection tests in a temporary miniature checkout, never modify web source.
test('generator validates before writing and check mode never writes', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cinema-series-'));
    const mobile = path.join(dir, 'apps/mobile');
    const output = path.join(mobile, 'src/lib/cinemaEditorialData.ts');
    const input = path.join(dir, 'app/veyrnox/social-cinema/editorialSeries.js');
    try {
        fs.mkdirSync(path.dirname(input), { recursive: true });
        fs.mkdirSync(path.join(mobile, 'scripts'), { recursive: true });
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(path.join(root, 'scripts/sync-cinema-series.mjs'), path.join(mobile, 'scripts/sync-cinema-series.mjs'));
        const fixture = () => JSON.parse(JSON.stringify(web.editorialSeries));
        const run = (series: any, check = false) => {
            fs.writeFileSync(input, `export const editorialSeries = ${JSON.stringify(series)};`);
            return spawnSync('node', ['scripts/sync-cinema-series.mjs', ...(check ? ['--check'] : [])], { cwd: mobile, encoding: 'utf8' });
        };
        fs.writeFileSync(output, 'sentinel');
        for (const mutate of [
            (s: any) => { s[0].slug = '../bad'; },
            (s: any) => { s[0].episodes[0].id = 'BAD'; },
            (s: any) => { s[0].posterUrl = 'https://example.com/poster'; },
            (s: any) => { s[0].episodes[0].position = 2; },
            (s: any) => { s[0].episodes[0].durationSeconds = 0; },
            (s: any) => { s[0].episodes[0].durationSeconds = 1.5; },
            (s: any) => { s[1].episodes[0].id = s[0].episodes[0].id; },
        ]) {
            const series = fixture(); mutate(series);
            expect(run(series).status).not.toBe(0);
            expect(fs.readFileSync(output, 'utf8')).toBe('sentinel');
        }
        const stale = run(fixture(), true);
        expect(stale.status).toBe(1);
        expect(stale.stderr).toContain('Cinema series snapshot is stale. Run node scripts/sync-cinema-series.mjs');
        expect(fs.readFileSync(output, 'utf8')).toBe('sentinel');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
