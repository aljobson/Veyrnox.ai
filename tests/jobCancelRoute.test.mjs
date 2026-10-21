import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const route = await import('../app/api/v1/jobs/[id]/cancel/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const savedFetch = globalThis.fetch, savedError = console.error;
const savedEnv = { ...process.env };
let calls, logs;
test.beforeEach(() => {
    calls = []; logs = [];
    console.error = (...args) => logs.push(args);
    Object.assign(process.env, { JOB_CANCEL_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
});
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedError;
    for (const key of ['JOB_CANCEL_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
        if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
});
function stub(answer, fail = false) {
    globalThis.fetch = async (url, init) => {
        calls.push({ name: new URL(url).pathname.split('/').pop(), body: JSON.parse(init.body) });
        if (fail) throw new Error('private database detail');
        return Response.json(answer);
    };
}
async function request(method, id = JOB, auth = AUTH) {
    const res = await route[method](new Request(`https://example.test/api/v1/jobs/${id}/cancel`, {
        method, headers: auth ? { 'x-veyrnox-auth-id': auth } : {},
        ...(method === 'POST' ? { body: JSON.stringify({ user_id: 'someone-else', p_auth_id: 'spoof' }) } : {}),
    }), { params: Promise.resolve({ id }) });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    return res;
}
for (const method of ['GET', 'POST']) {
    test(`${method}: identity precedes flag, flag precedes validation, and no outbound calls on refusal`, async () => {
        stub({ ok: true });
        for (const flag of [undefined, 'TRUE', 'false', 'true']) {
            if (flag === undefined) delete process.env.JOB_CANCEL_ENABLED; else process.env.JOB_CANCEL_ENABLED = flag;
            assert.equal((await request(method, 'bad', null)).status, 401);
            if (flag !== 'true') assert.equal((await request(method, 'bad')).status, 404);
        }
        assert.equal((await request(method, 'bad')).status, 400);
        delete process.env.SUPABASE_URL;
        assert.equal((await request(method)).status, 503);
        process.env.SUPABASE_URL = 'https://db.test';
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        assert.equal((await request(method)).status, 503);
        assert.deepEqual(calls, []);
    });
    test(`${method}: exact RPC arguments ignore body and project success`, async () => {
        stub({ ok: true, replayed: false, cancellable: true, credits: 7 });
        const res = await request(method);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), method === 'POST' ? { cancelled: true, replayed: false, credits: 7 } : { cancellable: true, credits: 7 });
        assert.deepEqual(calls, [{ name: method === 'POST' ? 'cancel_user_job' : 'get_user_job_cancel', body: { p_auth_id: AUTH, p_job_id: JOB } }]);
        stub({ ok: true, replayed: true, cancellable: false, credits: 0 });
        assert.deepEqual(await (await request(method)).json(), method === 'POST' ? { cancelled: true, replayed: true, credits: 0 } : { cancellable: false, credits: 0 });
    });
    test(`${method}: typed refusals, quota and safe internal failures`, async () => {
        for (const [code, status, error] of [
            ['NOT_FOUND', 404, 'not_found'], ['ACCOUNT_FROZEN', 403, 'account_frozen'],
            ['JOB_STARTED', 409, 'job_started'], ['JOB_FINISHED', 409, 'job_finished'], ['NEW_CODE', 502, 'internal'],
        ]) {
            stub({ ok: false, code, detail: 'private database detail' });
            const res = await request(method);
            const known = method === 'POST' || code === 'NOT_FOUND';
            assert.equal(res.status, known ? status : 502);
            assert.deepEqual(await res.json(), { error: known ? error : 'internal' });
        }
        stub({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 });
        const limited = await request(method);
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get('retry-after'), '12');
        assert.deepEqual(await limited.json(), { error: 'rate_limited', retry_after_seconds: 12 });
        for (const answer of [null, {}, { ok: false }]) {
            stub(answer); assert.equal((await request(method)).status, 502);
        }
        stub({}, true);
        const failed = await request(method);
        assert.equal(failed.status, 502);
        assert.deepEqual(await failed.json(), { error: 'internal' });
        assert.ok(logs.every(args => args.length === 1 && /^JOB_CANCEL_[A-Z_]+$/.test(args[0])));
    });
}
