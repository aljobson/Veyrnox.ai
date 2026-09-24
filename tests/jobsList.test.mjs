import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' });
const list = await import('../app/api/v1/jobs/route.js');

const JOB = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
const row = (n, state = 'STORED') => ({
    job_id: JOB(n), state, credits: 4, model_id: 'm1', error_code: null,
    created_at: `2026-09-2${n}T10:00:00Z`, label: `prompt ${n}`, has_asset: state === 'STORED',
});

let seen = null;
function stub(jobs) {
    globalThis.fetch = async (url, init = {}) => {
        seen = JSON.parse(init.body);
        return Response.json({ ok: true, jobs });
    };
}
const get = (qs = '') => list.GET(new Request(`https://veyrnox.test/api/v1/jobs${qs}`, {
    headers: { 'x-veyrnox-auth-id': 'auth-user-1' },
}));

test('returns the caller\'s jobs with client states, and a cursor only when the page is full', async () => {
    stub([row(1), row(2, 'FAILED')]);
    const body = await (await get('?limit=2')).json();
    assert.deepEqual(body.jobs.map((j) => [j.state, j.refunded, j.label]), [
        ['succeeded', false, 'prompt 1'], ['failed', false, 'prompt 2'],
    ]);
    assert.deepEqual(body.next, { before: '2026-09-22T10:00:00Z', before_id: JOB(2) }, 'a full page offers more');
    assert.equal(seen.p_auth_id, 'auth-user-1', 'ownership is the verified auth id, never a request field');

    stub([row(1)]);
    assert.equal((await (await get('?limit=2')).json()).next, null, 'a short page ends the list');
});

test('a REFUNDED job is failed AND refunded; an unauthenticated caller gets 401', async () => {
    stub([row(3, 'REFUNDED')]);
    const body = await (await get()).json();
    assert.deepEqual([body.jobs[0].state, body.jobs[0].refunded], ['failed', true]);

    const res = await list.GET(new Request('https://veyrnox.test/api/v1/jobs'));
    assert.equal(res.status, 401);
});

test('refuses a limit or cursor it did not issue', async () => {
    stub([]);
    for (const qs of ['?limit=0', '?limit=51', '?limit=abc', '?before=2026-09-21T10:00:00Z', '?before_id=' + JOB(1),
        '?before=not-a-date&before_id=' + JOB(1), '?before=2026-09-21T10:00:00Z&before_id=nope']) {
        const res = await get(qs);
        assert.equal(res.status, 400, qs);
    }
});

test('the Library reads the account list and keeps localStorage as a cache', () => {
    const page = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
    assert.match(page, /gatewayFetch\(`\/jobs\?limit=\$\{PAGE \* 2\}`\)/);
    assert.match(page, /setListLive\(false\)/, 'an unreachable list is admitted, not silently shown as empty');
    assert.match(page, /before: nextCursor\.before, before_id: nextCursor\.before_id/);
});

test('exposes authoritative expiry and tolerates a pre-migration RPC', async () => {
    stub([{ ...row(1), asset_expires_at: '2026-12-23T10:00:00Z' }, row(2)]);
    const response = await get();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.jobs[0].asset_expires_at, '2026-12-23T10:00:00Z');
    assert.equal(body.jobs[1].asset_expires_at, null);
});

test('signed links carry retention separately from the 15-minute signing lifetime', async () => {
    Object.assign(process.env, {
        R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access',
        R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
    });
    const assetRoute = await import('../app/api/v1/jobs/[id]/asset/route.js');
    for (const deadline of ['2026-12-23T10:00:00Z', undefined]) {
        globalThis.fetch = async (_url, init) => {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: 'auth-user-1', p_job_id: JOB(1) });
            return Response.json({ ok: true, r2_key: 'private/output.png', mime_type: 'image/png',
                size_bytes: 42, asset_expires_at: deadline });
        };
        const response = await assetRoute.GET(new Request(`https://veyrnox.test/api/v1/jobs/${JOB(1)}/asset`, {
            headers: { 'x-veyrnox-auth-id': 'auth-user-1' },
        }), { params: Promise.resolve({ id: JOB(1) }) });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.asset_expires_at, deadline ?? null);
        assert.equal(body.expires_in, 900);
        assert.equal(new URL(body.url).searchParams.get('X-Amz-Expires'), '900');
    }
});
