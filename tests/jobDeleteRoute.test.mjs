import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const route = await import('../app/api/v1/jobs/[id]/route.js');

const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const savedFetch = globalThis.fetch;
const savedErr = console.error;
let calls;
test.beforeEach(() => { calls = []; console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = savedFetch; console.error = savedErr; });

const del = (id = JOB, auth = AUTH) => route.DELETE(
    new Request(`https://veyrnox.test/api/v1/jobs/${id}`, { method: 'DELETE', headers: auth ? { 'x-veyrnox-auth-id': auth } : {} }),
    { params: Promise.resolve({ id }) },
);
function stub(answer, { fail = false } = {}) {
    globalThis.fetch = async (url, init) => {
        calls.push({ name: new URL(url).pathname.split('/').pop(), body: JSON.parse(init.body) });
        if (fail) throw new Error('backend down');
        return Response.json(answer);
    };
}

test('no identity is a 401 before any outbound call; a bad id is a 400', async () => {
    stub({ ok: true });
    assert.equal((await del(JOB, null)).status, 401);
    assert.equal((await del('not-a-uuid')).status, 400);
    assert.deepEqual(calls, []);
});

test('the caller is the verified header and nothing else; the rpc gets the id from the path', async () => {
    stub({ ok: true, replayed: false });
    await del();
    assert.deepEqual(calls, [{ name: 'delete_user_job', body: { p_auth_id: AUTH, p_job_id: JOB } }]);
});

test('a deletion answers 200 and a repeat says replayed', async () => {
    stub({ ok: true, replayed: false });
    const first = await del();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await first.json(), { deleted: true, replayed: false });
    stub({ ok: true, replayed: true });
    assert.deepEqual(await (await del()).json(), { deleted: true, replayed: true });
});

test('every refusal has its status and a kebab_case code, with nothing else in the body', async () => {
    const cases = {
        ACCOUNT_FROZEN: [403, 'account_frozen'], IN_PROGRESS: [409, 'job_in_progress'], ON_HOLD: [409, 'job_on_hold'],
        USED_BY_POST: [409, 'used_by_post'], USED_BY_CINEMA: [409, 'used_by_cinema'], USED_BY_LIBRARY: [409, 'used_by_library'],
        NOT_FOUND: [404, 'not_found'],
    };
    for (const [code, [status, error]] of Object.entries(cases)) {
        stub({ ok: false, code });
        const res = await del();
        assert.equal(res.status, status, code);
        assert.deepEqual(await res.json(), { error }, code);
    }
});

test('the shared read quota answers 429 with Retry-After', async () => {
    stub({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 });
    const res = await del();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '12');
    assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: 12 });
});

test('a backend failure or an answer nobody expected is a 502 that leaks nothing', async () => {
    stub({}, { fail: true });
    const down = await del();
    assert.equal(down.status, 502);
    assert.deepEqual(await down.json(), { error: 'internal' });
    stub({ ok: false, code: 'SOMETHING_NEW', detail: 'select * from jobs' });
    const odd = await del();
    assert.equal(odd.status, 502);
    assert.deepEqual(await odd.json(), { error: 'internal' });
});
