import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep } from '../lib/socialPublishSweep.js';
import { encryptToken } from '../lib/social/tokenCrypto.js';
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' };
const cryptoCfg = { raw: new Uint8Array(32).fill(5) };
const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
const ZERO = '00000000-0000-0000-0000-000000000000';
function presentProbe(name, init, calls) {
    if (name !== 'authorize_social_target_dispatch' || JSON.parse(init.body).p_target_id !== ZERO) return null;
    assert.deepEqual(JSON.parse(init.body), { p_target_id: ZERO, p_claim_key: ZERO });
    calls[calls.length - 1] = 'hold_probe';
    return Response.json({ ok: false, code: 'CLAIM_LOST' });
}
const deps = { env: { SOCIAL_HOLD_CHECKS_ENABLED: 'true' }, cfg, cryptoCfg, r2cfg, publicHost: 'https://app.test', mediaProxySecret: 's'.repeat(32) };
async function target(state = {}, network = 'threads') {
    return { target_id: '11111111-1111-4111-8111-111111111111', claim_key: '22222222-2222-4222-8222-222222222222',
        network, token_expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), r2_key: 'image.png', media_type: 'image', external_account_id: '123',
        access_token_enc: await encryptToken('token', cryptoCfg), provider_state: state };
}
for (const code of ['MEDIA_HELD', 'CLAIM_LOST']) test(`${code} defers before presign and consumes no attempt`, async () => {
    const row = await target(); const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        assert.equal(name, 'authorize_social_target_dispatch');
        assert.equal(JSON.parse(init.body).p_claim_key, row.claim_key);
        return Response.json({ ok: false, code });
    };
    // Invalid signing secret makes presign fail if authorization is ordered incorrectly.
    const out = await runPublishSweep({ ...deps, r2cfg: { ...r2cfg, secretAccessKey: {} } });
    assert.equal(out.deferred, 1); assert.equal(out.failed, 0);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'authorize_social_target_dispatch']);
});
test('hold after Threads container creation blocks threads_publish, while polling needs no authorization', async () => {
    let row = await target(), held = false, finished = false; const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        if (name === 'authorize_social_target_dispatch') return Response.json({ ok: !held, code: held ? 'MEDIA_HELD' : undefined });
        if (name === 'threads') return Response.json({ id: 'container' });
        if (name === 'container') return Response.json({ status: finished ? 'FINISHED' : 'IN_PROGRESS' });
        if (name === 'report_social_post_progress') { row.provider_state = JSON.parse(init.body).p_provider_state; return Response.json({ ok: true }); }
        assert.fail('unexpected provider or mutation: ' + name);
    };
    assert.equal((await runPublishSweep(deps)).failed, 0);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'authorize_social_target_dispatch', 'threads', 'report_social_post_progress']);
    held = true; calls.length = 0;
    await runPublishSweep(deps);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'container', 'report_social_post_progress']);
    finished = true; calls.length = 0;
    assert.equal((await runPublishSweep(deps)).deferred, 1);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'container', 'authorize_social_target_dispatch']);
});
test('Threads publishing authorizes before marker and provider call; permalink reconciliation does neither', async () => {
    const row = await target({ container_id: 'container', started_at: new Date().toISOString() }); const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        if (name === 'container') return Response.json({ status: 'FINISHED' });
        if (name === 'threads_publish') return Response.json({ id: 'post' });
        if (name === 'post') return Response.json({ permalink: 'https://threads.test/post' });
        if (name === 'report_social_post_progress') row.provider_state = JSON.parse(init.body).p_provider_state;
        return Response.json({ ok: true });
    };
    await runPublishSweep(deps);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets','container','authorize_social_target_dispatch','mark_social_provider_submission','threads_publish','report_social_post_progress']);
    calls.length = 0; await runPublishSweep(deps);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets','post','complete_social_post_target']);
});

test('hold checks call the RPC only when the server gate is exactly true', async () => {
    for (const flag of [undefined, 'false', 'TRUE', 'true']) {
        const row = await target(); const calls = [];
        globalThis.fetch = async (url, init) => {
            const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
            if (name === 'claim_due_social_post_targets') return Response.json([row]);
            if (name === 'threads') return Response.json({ id: 'container' });
            if (name === 'authorize_social_target_dispatch') {
                assert.equal(flag, 'true', 'disabled deployment must not need migration 0286');
            } else assert.equal(name, 'report_social_post_progress');
            return Response.json({ ok: true });
        };
        const out = await runPublishSweep({ ...deps, env: { SOCIAL_HOLD_CHECKS_ENABLED: flag } });
        assert.equal(out.failed, 0); assert.equal(out.deferred || 0, 0);
        assert.deepEqual(calls, [...(flag === 'true' ? ['hold_probe'] : []), 'claim_due_social_post_targets',
            ...(flag === 'true' ? ['authorize_social_target_dispatch'] : []), 'threads', 'report_social_post_progress']);
    }
});

test('Threads publishes after a hold longer than the poll bound is released', async () => {
    const row = await target(); let held = false, published = 0; const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        if (name === 'authorize_social_target_dispatch') return Response.json({ ok: !held, code: held ? 'MEDIA_HELD' : undefined });
        if (name === 'threads') return Response.json({ id: 'container' });
        if (name === 'container') return Response.json({ status: 'FINISHED' });
        if (name === 'threads_publish') { published++; return Response.json({ id: 'post' }); }
        if (name === 'post') return Response.json({ permalink: 'https://threads.test/post' });
        if (name === 'report_social_post_progress') row.provider_state = JSON.parse(init.body).p_provider_state;
        else assert.ok(['mark_social_provider_submission', 'complete_social_post_target'].includes(name), name);
        return Response.json({ ok: true });
    };
    await runPublishSweep(deps);
    held = true; row.provider_state.started_at = new Date(Date.now() - 3 * 3600000).toISOString();
    calls.length = 0;
    assert.equal((await runPublishSweep(deps)).deferred, 1); assert.equal(published, 0);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'container', 'authorize_social_target_dispatch']);
    held = false; calls.length = 0;
    assert.equal((await runPublishSweep(deps)).failed, 0); assert.equal(published, 1);
    assert.deepEqual(calls, ['hold_probe', 'claim_due_social_post_targets', 'container', 'authorize_social_target_dispatch',
        'mark_social_provider_submission', 'threads_publish', 'report_social_post_progress']);
    assert.equal((await runPublishSweep(deps)).published, 1); assert.equal(published, 1);
});

test('missing authorization RPC defers every target without completion and logs once per sweep', async () => {
    const rows = [await target(), await target()]; const calls = [], logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        const probe = presentProbe(name, init, calls); if (probe) return probe;
        if (name === 'claim_due_social_post_targets') return Response.json(rows);
        assert.equal(name, 'authorize_social_target_dispatch', 'no provider or completion may run');
        return Response.json({ code: 'PGRST202', message: 'missing RPC' }, { status: 404 });
    };
    try {
        for (let sweep = 0; sweep < 2; sweep++) {
            const out = await runPublishSweep(deps);
            assert.equal(out.deferred, 2); assert.equal(out.failed, 0); assert.equal(out.errors, 0);
        }
        assert.equal(logs.length, 2); assert.ok(logs.every(line => line.includes('authorize_social_target_dispatch')));
        assert.equal(calls.filter(name => name === 'authorize_social_target_dispatch').length, 4);
    } finally { console.error = originalError; }
});

test('missing pre-claim probe consumes no attempt and logs once per sweep', async () => {
    const calls = [], logs = []; const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        assert.equal(name, 'authorize_social_target_dispatch', 'claim RPC must never run');
        assert.deepEqual(JSON.parse(init.body), { p_target_id: ZERO, p_claim_key: ZERO });
        return Response.json({ code: 'PGRST202' }, { status: 404 });
    };
    try {
        assert.deepEqual(await runPublishSweep(deps), { ok: false, error: 'hold_checks_unavailable', claimed: 0 });
        assert.deepEqual(calls, ['authorize_social_target_dispatch']);
        assert.equal(logs.length, 1); assert.match(logs[0], /authorize_social_target_dispatch/);
    } finally { console.error = originalError; }
});

test('a coded probe refusal proves presence and precedes the claim', async () => {
    for (const code of ['CLAIM_LOST', 'CLAIM_KEY_REQUIRED']) {
        const calls = [];
        globalThis.fetch = async (url, init) => {
            const name = new URL(url).pathname.split('/').pop(); calls.push(name);
            if (name === 'authorize_social_target_dispatch') {
                assert.deepEqual(JSON.parse(init.body), { p_target_id: ZERO, p_claim_key: ZERO });
                return Response.json({ ok: false, code });
            }
            assert.equal(name, 'claim_due_social_post_targets'); return Response.json([]);
        };
        assert.equal((await runPublishSweep(deps)).claimed, 0);
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets']);
    }
});

test('other probe failures use the existing claim-failure response without claiming', async () => {
    const originalError = console.error; console.error = () => {};
    try {
        for (const status of [403, 500, 'transport']) {
            let calls = 0;
            globalThis.fetch = async url => {
                calls++; assert.ok(String(url).endsWith('/authorize_social_target_dispatch'));
                if (status === 'transport') throw Error('offline');
                return Response.json({ code: 'unrelated_error' }, { status });
            };
            assert.deepEqual(await runPublishSweep(deps), { ok: false, error: 'claim_failed' });
            assert.equal(calls, 1);
        }
    } finally { console.error = originalError; }
});
