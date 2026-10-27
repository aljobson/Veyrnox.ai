import { parseAccounts, parseAnalytics } from '../src/lib/publish';
import { analyticsCsv, contentCsvName, contentTypePerformance, createHashtagRegex, csvCell, hasAnalytics, hashtagPerformance,
    portfolioCsvName, postAnalyticsCsv, reportOptions, summarizePortfolio, topContent, totalPostMetric } from '../src/lib/publishAnalyticsDepth';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const accounts = [
    { id: 'a', network: 'twitter', external_account_id: 'external_x', status: 'active' },
    { id: 'b', network: 'instagram', display_name: 'instagram', external_account_id: 'external_ig', status: 'active' },
    { id: 'c', network: 'youtube', display_name: '', external_account_id: 'empty_name', status: 'active' },
    { id: 'd', network: 'twitch', display_name: '   ', external_account_id: 'whitespace_name', status: 'active' },
];
const raw = { sync: { last_ok_at: '2026-10-26T12:00:00Z', failing: false }, evolution: [
    { date: '2026-10-25', metrics: { followers: 10 } }, { date: '2026-10-26', metrics: { followers: 12 } },
], posts: [
    { id: '1', published_at: '2026-10-25T10:00:00Z', type: 'IMAGE', caption: '=SUM(1,2) "hello"\n#Studio #STUDIO #東京 #Création', permalink: 'https://example.com/1', metrics: { likes: 5, comments: 2, reach: 0, views: 20 } },
    { id: '2', published_at: '2026-10-26T10:00:00Z', type: 'video', caption: '#Studio #Video', permalink: 'https://example.com/2', metrics: { likes: 3, shares: 4, impressions: 90, views: 10 } },
    { id: '3', published_at: null, type: null, caption: '@hello #Video', permalink: null, metrics: {} },
] };
const parsed = parseAnalytics(raw);
const parsedAccounts = parseAccounts({ accounts }).accounts;
const entries = parsedAccounts.map((account, i) => ({ account, data: i ? parseAnalytics({ posts: [], sync: { failing: true } }) : parsed }));

test('matches the real web helper under Node: CSV bytes, type/top/hashtag results and the complete portfolio', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import * as m from ${JSON.stringify(resolve(__dirname, '../../../lib/social/analyticsSummary.js'))};
        let text = ''; for await (const part of process.stdin) text += part;
        const { accounts, raw } = JSON.parse(text);
        const portfolio = m.summarizePortfolio(accounts.map((account, i) => ({ account, data: i ? { posts: [], sync: { failing: true, last_ok_at: null } } : raw })));
        console.log(JSON.stringify({ portfolio, csv: m.analyticsCsv(portfolio.rows), content: accounts.map(a => m.postAnalyticsCsv(a, raw.posts)),
            types: m.contentTypePerformance(raw.posts), top: m.topContent(raw.posts), hashtags: m.hashtagPerformance(raw.posts) }));
    `], { input: JSON.stringify({ accounts, raw }), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect(run.status).toBe(0); expect(run.stderr).toBe('');
    const web = JSON.parse(run.stdout);
    const portfolio = summarizePortfolio(entries);
    expect(analyticsCsv(portfolio.rows)).toBe(web.csv);
    expect(parsedAccounts.map(a => postAnalyticsCsv(a, parsed.posts))).toEqual(web.content);
    expect(contentTypePerformance(parsed.posts)).toEqual(web.types);
    expect(topContent(parsed.posts).map(r => ({ ...r, post: raw.posts.find(p => p.id === r.post.id) }))).toEqual(web.top);
    expect(hashtagPerformance(parsed.posts)).toEqual(web.hashtags);
    expect(portfolio).toEqual({ ...web.portfolio, rows: web.portfolio.rows.map((r: object, i: number) => ({ ...r, account: parsedAccounts[i] })) });
    expect(parsedAccounts.map(a => a.displayName)).toEqual(['twitter', 'instagram', 'youtube', 'twitch']);
    expect(parsedAccounts.map(a => a.rawDisplayName)).toEqual([null, 'instagram', '', '   ']);
});
test('formula guard, quoted cells, null cells and CRLF rows', () => {
    expect(csvCell('=SUM')).toBe("'=SUM");
    for (const prefix of ['+', '-', '@']) expect(csvCell(prefix + 'x')).toBe("'" + prefix + 'x');
    expect(csvCell('a,"b"\n')).toBe('"a,""b""\n"');
    expect(csvCell(null)).toBe(''); expect(csvCell(undefined)).toBe(''); expect(csvCell(-2)).toBe('-2');
    expect(postAnalyticsCsv(parsedAccounts[0], parsed.posts)).toContain('\r\n');
    expect(postAnalyticsCsv(parsedAccounts[0], parsed.posts)).toContain(",,,,0");
});
test('preserves absent metrics, ranks supported values with the web tie break and bounds limits', () => {
    expect(totalPostMetric(parsed.posts, 'saves')).toBeNull(); expect(totalPostMetric(parsed.posts, 'reach')).toBe(0);
    expect(topContent(parsed.posts).map(p => p.post.id)).toEqual(['2', '1', '3']);
    expect(topContent(parsed.posts, 'reach').map(p => p.post.id)).toEqual(['1']);
    expect(topContent(parsed.posts, 'bad')).toEqual([]); expect(topContent(parsed.posts, 'views', 0)).toEqual([]);
    expect(hashtagPerformance(parsed.posts, 51)).toEqual([]);
    expect(topContent([...parsed.posts, ...parsed.posts, ...parsed.posts])).toHaveLength(5);
    expect(hashtagPerformance(parseAnalytics({ posts: [{ id: 'tags', caption: Array.from({ length: 12 }, (_, i) => `#tag${i}`).join(' ') }] }).posts)).toHaveLength(10);
    expect(summarizePortfolio([])).toMatchObject({ followers: null, reach: null, views: null, impressions: null, posts: 0 });
});
test('Hermes fallback is exercised when Unicode construction throws', () => {
    const make = jest.fn(() => { throw new SyntaxError('unsupported'); });
    const fallback = createHashtagRegex(make);
    expect(make).toHaveBeenCalledWith('#[\\p{L}\\p{N}_]+', 'gu');
    expect(hashtagPerformance(parsed.posts, 10, fallback)).toEqual(hashtagPerformance(parsed.posts));
    expect(hashtagPerformance(parsed.posts, 10, fallback)).toEqual(hashtagPerformance(parsed.posts, 10, fallback));
});
test.each(['twitter', 'instagram', 'tiktok', 'youtube', 'twitch'])('supports %s', n => expect(hasAnalytics(n)).toBe(true));
test('unsupported and inherited object properties are not analytics networks', () => {
    expect(hasAnalytics('facebook')).toBe(false); expect(hasAnalytics('constructor')).toBe(false);
});
test('safe filenames and web report parameter validation', () => {
    expect(contentCsvName('twitter')).toBe('veyrnox-twitter-content.csv');
    for (const value of ['../x', 'Twitter', '', 'a/b', 'a1']) expect(contentCsvName(value)).toBe('veyrnox-account-content.csv');
    expect(portfolioCsvName('2026-10-01', '2026-10-27')).toBe('veyrnox-analytics-2026-10-01-to-2026-10-27.csv');
    expect(reportOptions({ days: '90', compare: '1', content: '0', accent: '#AABBCC', reportTitle: 'x'.repeat(101), account: 'a' }))
        .toEqual({ days: 90, compare: true, includeContent: false, accent: '#aabbcc', title: 'x'.repeat(100), account: 'a' });
    expect(reportOptions({ days: '8', compare: 'true', content: 'false', accent: 'red' }))
        .toMatchObject({ days: 30, compare: false, includeContent: true, accent: '#38bdf8' });
});
