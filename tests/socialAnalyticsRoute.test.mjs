import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/v1/social/analytics/route.js');
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const auth = '11111111-1111-4111-8111-111111111111';
const accountId = '33333333-3333-4333-8333-333333333333';
const okResult = {
    ok: true,
    account: { id: accountId, network: 'instagram', display_name: '@creator', status: 'active' },
    sync: { last_ok_at: '2026-10-03T12:00:00Z', failing: false },
    evolution: [{ date: '2026-10-03', metrics: { followers: 10 } }],
    posts: [],
};

const request = (search, headers = {}) => new Request(`https://veyrnox.test/api/v1/social/analytics${search}`, {
    headers: { 'x-veyrnox-auth-id': auth, ...headers },
});
const valid = `?accountId=${accountId}&from=2026-09-04&to=2026-10-03`;

let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        const result = results[name] ?? ({
            consume_account_read_request: { ok: true },
            get_social_analytics: okResult,
        })[name];
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}

test('missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await GET(request(valid, { 'x-veyrnox-auth-id': identity }))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('rejects a bad account id or date range before any database call', async () => {
    stub();
    const bad = [
        ['?from=2026-09-04&to=2026-10-03', 'invalid_account_id'],
        ['?accountId=nope&from=2026-09-04&to=2026-10-03', 'invalid_account_id'],
        [`?accountId=${accountId}`, 'invalid_range'],
        [`?accountId=${accountId}&from=2026-10-03&to=2026-09-04`, 'invalid_range'],
        [`?accountId=${accountId}&from=2026-02-31&to=2026-03-05`, 'invalid_range'],
        [`?accountId=${accountId}&from=2025-01-01&to=2026-10-03`, 'invalid_range'],
        [`?accountId=${accountId}&from=2026-09-04T00:00:00Z&to=2026-10-03`, 'invalid_range'],
    ];
    for (const [search, error] of bad) {
        const res = await GET(request(search));
        assert.equal(res.status, 400, search);
        assert.deepEqual(await res.json(), { error }, search);
    }
    assert.deepEqual(calls, []);
});

test('returns the caller\'s analytics, uncached, without the ok flag', async () => {
    stub();
    const res = await GET(request(valid));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { ok: _ok, ...expected } = okResult;
    assert.deepEqual(await res.json(), expected);
    assert.deepEqual(calls[1], {
        name: 'get_social_analytics',
        args: { p_auth_id: auth, p_account_id: accountId, p_from: '2026-09-04', p_to: '2026-10-03' },
    });
});

test('maps database refusals to typed errors and never leaks a database message', async () => {
    for (const [code, status, error] of [
        ['USER_NOT_FOUND', 401, 'not_authenticated'],
        ['ACCOUNT_NOT_FOUND', 404, 'account_not_found'],
        ['INVALID_RANGE', 400, 'invalid_range'],
        ['SOMETHING_ELSE', 502, 'internal'],
    ]) {
        stub({ get_social_analytics: { ok: false, code } });
        const res = await GET(request(valid));
        assert.equal(res.status, status, code);
        assert.deepEqual(await res.json(), { error }, code);
    }
    stub({ get_social_analytics: new Error('relation "secret_table" does not exist') });
    const res = await GET(request(valid));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});

test('a rate-limited caller is refused before the analytics read', async () => {
    stub({ consume_account_read_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 } });
    const res = await GET(request(valid));
    assert.equal(res.status, 429);
    assert.deepEqual(calls.map((c) => c.name), ['consume_account_read_request']);
});


test('advertises posting insights only when its own switch is exactly true', async () => {
    try {
        for (const value of ['false', 'TRUE', 'true']) {
            process.env.PUBLISH_POSTING_INSIGHTS_ENABLED = value;
            stub();
            const body = await (await GET(request(valid))).json();
            assert.equal(body.postingInsightsEnabled, value === 'true' ? true : undefined);
        }
    } finally { delete process.env.PUBLISH_POSTING_INSIGHTS_ENABLED; }
});
