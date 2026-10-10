// /api/v1/reports (ADR-0083): a user's content report. The reporter is the
// middleware's identity; the body names only the subject and the category.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/reports/route.js', import.meta.url);
const SUB = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const USER_HEADERS = { 'x-veyrnox-auth-id': SUB };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (headers, body) => new Request('https://veyrnox.test/api/v1/reports', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        const body = init && init.body ? JSON.parse(init.body) : null;
        if (u.includes('/rpc/consume_account_read_request')) return Response.json({ ok: true });
        calls.push({ url: u, body });
        return handler(u, body);
    };
    return calls;
}
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('a caller without a verified identity is refused before any RPC; so is a bad body', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const headers of [{}, { 'x-veyrnox-auth-id': 'not-a-uuid' }]) {
            assert.equal((await POST(request(headers, { subject_kind: 'job', subject_id: JOB, category: 'csam' }))).status, 401);
        }
        for (const [body, error] of [
            [{ subject_kind: 'post', subject_id: JOB, category: 'csam' }, 'subject_invalid'],
            [{ subject_kind: 'job', category: 'csam' }, 'subject_invalid'],
            [{ subject_kind: 'other', subject_id: JOB, category: 'csam' }, 'subject_invalid'],
            [{ subject_kind: 'job', subject_id: JOB, category: 'spam' }, 'category_invalid'],
            [{ subject_kind: 'other', category: 'other', details: 'short' }, 'details_invalid'],
            [{ subject_kind: 'job', subject_id: JOB, category: 'other', details: 'x'.repeat(2001) }, 'details_invalid'],
            [[1], 'body_invalid'],
        ]) {
            const res = await POST(request(USER_HEADERS, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ POST }) => {
        assert.equal((await POST(request(USER_HEADERS, { subject_kind: 'job', subject_id: JOB, category: 'csam' }))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('a report goes through submit_content_report with the auth id; a repeat for the same subject is 200 replayed', async () => {
    let replayed = false;
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/submit_content_report$/);
        return Response.json({ ok: true, report_id: 'rp1', replayed });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        const res = await POST(request(USER_HEADERS, { subject_kind: 'job', subject_id: JOB, category: 'real_person', details: '  My neighbour, no consent  ' }));
        assert.equal(res.status, 201);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { report_id: 'rp1', replayed: false });
        replayed = true;
        assert.equal((await POST(request(USER_HEADERS, { subject_kind: 'job', subject_id: JOB, category: 'real_person' }))).status, 200);
    });
    assert.deepEqual(calls[0].body, { p_auth_id: SUB, p_subject_kind: 'job', p_subject_id: JOB, p_category: 'real_person', p_details: 'My neighbour, no consent' });
    assert.deepEqual(calls[1].body.p_details, '');
});

test('too many open reports is 429; an outage is 502', async () => {
    await withEnv(CONFIGURED, async ({ POST }) => {
        stubRpc(() => Response.json({ ok: false, code: 'TOO_MANY_OPEN_REPORTS' }));
        const res = await POST(request(USER_HEADERS, { subject_kind: 'other', category: 'other', details: 'Something on the landing page' }));
        assert.deepEqual([res.status, (await res.json()).error], [429, 'too_many_open_reports']);
        stubRpc(() => { throw new Error('network'); });
        assert.equal((await POST(request(USER_HEADERS, { subject_kind: 'other', category: 'other', details: 'Something on the landing page' }))).status, 502);
    });
});
