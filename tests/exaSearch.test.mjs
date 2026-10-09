// ADR-0067 amendment 8: the capped search adapter. A fixed URL, a hard limit on the text, typed errors, no vendor text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXA_SEARCH_URL, SEARCH_LIMITS, SearchError, searchWeb } from '../packages/adapters/exa.js';

const okBody = (results, extra = {}) => ({ results, costDollars: { total: 0.008 }, ...extra });
const R = (n, over = {}) => ({ title: `Title ${n}`, url: `https://example.com/${n}`, text: `Text ${n}`, ...over });
function fetchReturning(body, status = 200, seen = []) {
    return async (url, init) => { seen.push({ url, init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };
}
const code = async (p) => { try { await p; return null; } catch (e) { assert.ok(e instanceof SearchError, String(e)); assert.equal(e.message, e.code, 'the message is only the code'); return e.code; } };

test('the request goes to the fixed URL with the key, the limits and the query, and nothing else', async () => {
    const seen = [];
    const r = await searchWeb({ apiKey: 'k-1', query: '  latest node release  ', fetchImpl: fetchReturning(okBody([R(1)]), 200, seen) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, EXA_SEARCH_URL);
    assert.equal(EXA_SEARCH_URL, 'https://api.exa.ai/search');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers['x-api-key'], 'k-1');
    assert.deepEqual(JSON.parse(seen[0].init.body), {
        query: 'latest node release', numResults: SEARCH_LIMITS.results, type: 'auto',
        contents: { text: { maxCharacters: SEARCH_LIMITS.charsPerResult } },
    });
    assert.deepEqual(r.results, [{ title: 'Title 1', url: 'https://example.com/1', text: 'Text 1' }]);
});

test('the limits are the ones the price depends on', () => {
    assert.deepEqual(SEARCH_LIMITS, { results: 3, charsPerResult: 2000, queryChars: 300, titleChars: 200, timeoutMs: 8000 });
});

test('a long query is cut, and a blank one never reaches the network', async () => {
    const seen = [];
    await searchWeb({ apiKey: 'k', query: 'q'.repeat(900), fetchImpl: fetchReturning(okBody([R(1)]), 200, seen) });
    assert.equal(JSON.parse(seen[0].init.body).query.length, SEARCH_LIMITS.queryChars);
    for (const blank of ['', '   ', null, undefined, 5]) {
        const calls = [];
        assert.equal(await code(searchWeb({ apiKey: 'k', query: blank, fetchImpl: fetchReturning(okBody([]), 200, calls) })), 'search_request_rejected');
        assert.equal(calls.length, 0);
    }
});

test('the text is cut again on our side even if the provider sent more than asked', async () => {
    const big = 'x'.repeat(50_000);
    const r = await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody([R(1, { text: big }), R(2, { title: 'T'.repeat(900) })])) });
    assert.equal(r.results[0].text.length, SEARCH_LIMITS.charsPerResult);
    assert.equal(r.results[1].title.length, SEARCH_LIMITS.titleChars);
});

test('at most three results, and only usable ones: http or https, no credentials, with some text', async () => {
    const rows = [
        R(1), R(2, { url: 'javascript:alert(1)' }), R(3, { url: 'https://user:pw@example.com/x' }), R(4, { text: '   ' }), R(5, { url: 'ftp://example.com/f' }),
        R(6, { url: 'not a url' }), R(7), R(8), R(9),
    ];
    const r = await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody(rows)) });
    assert.deepEqual(r.results.map((x) => x.url), ['https://example.com/1', 'https://example.com/7', 'https://example.com/8']);
});

test('a missing title falls back to nothing rather than crashing, and junk fields are ignored', async () => {
    const r = await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody([{ url: 'https://example.com/a', text: 'body', title: 5, extra: 'x' }, null, 'str', 7])) });
    assert.deepEqual(r.results, [{ title: '', url: 'https://example.com/a', text: 'body' }]);
});

test('the provider-reported cost is kept when it is a number and dropped when it is not', async () => {
    assert.equal((await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody([R(1)], { costDollars: { total: 0.011 } })) })).costUsd, 0.011);
    for (const bad of [undefined, null, 'x', -1, NaN, {}]) {
        assert.equal((await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody([R(1)], { costDollars: bad === undefined ? undefined : { total: bad } })) })).costUsd, null, String(bad));
    }
});

test('no results is a normal answer, not an error', async () => {
    assert.deepEqual((await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning(okBody([])) })).results, []);
    assert.deepEqual((await searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning({}) })).results, []);
});

test('errors are typed and never carry vendor text', async () => {
    const secret = 'upstream said: key sk-live-123 is invalid for account bob@example.com';
    for (const [status, expected] of [[401, 'search_auth_failed'], [403, 'search_auth_failed'], [402, 'search_payment_required'], [429, 'search_rate_limited'],
        [400, 'search_request_rejected'], [422, 'search_request_rejected'], [500, 'search_unavailable'], [502, 'search_unavailable'], [503, 'search_unavailable']]) {
        const c = await code(searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning({ error: secret }, status) }));
        assert.equal(c, expected, String(status));
    }
    assert.equal(await code(searchWeb({ apiKey: '', query: 'q', fetchImpl: fetchReturning(okBody([])) })), 'search_not_configured');
    assert.equal(await code(searchWeb({ apiKey: 'k', query: 'q', fetchImpl: fetchReturning('<html>nope</html>') })), 'search_unavailable', 'a body that is not JSON');
    assert.equal(await code(searchWeb({ apiKey: 'k', query: 'q', fetchImpl: async () => { throw new Error(secret); } })), 'search_unavailable', 'a network failure');
});

test('a slow provider times out, and a caller that aborts is not turned into a vendor error', async () => {
    const slow = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason), { once: true }));
    assert.equal(await code(searchWeb({ apiKey: 'k', query: 'q', timeoutMs: 20, fetchImpl: slow })), 'search_timeout');
    const ac = new AbortController();
    const p = searchWeb({ apiKey: 'k', query: 'q', signal: ac.signal, timeoutMs: 5000, fetchImpl: slow });
    ac.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError' || e.name === 'TimeoutError' || !(e instanceof SearchError) || e.code === 'search_aborted');
});
