import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, sendExpoBatch, runPushSweep, pushEnabled, EXPO_PUSH_URL } from '../lib/pushNotifications.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-role' };
const ON = { PUSH_NOTIFICATIONS_ENABLED: 'true' };
const savedFetch = globalThis.fetch;
const savedErr = console.error;
test.afterEach(() => { globalThis.fetch = savedFetch; console.error = savedErr; });

const item = (over = {}) => ({
    id: 'o1', kind: 'job_done', job_id: 'j1', job_state: 'STORED', modality: 'text-to-video', attempts: 1,
    tokens: [{ id: 't1', token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]' }], ...over,
});

test('the flag is off unless it is exactly "true"', () => {
    assert.equal(pushEnabled({}), false);
    assert.equal(pushEnabled({ PUSH_NOTIFICATIONS_ENABLED: '1' }), false);
    assert.equal(pushEnabled(ON), true);
});

test('messages carry no prompt, model or credits; only a job id for the app to route', () => {
    const m = buildMessage(item({ inputs: { prompt: 'a private prompt' }, model_id: 'secret-model' }), 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]');
    assert.equal(m.title, 'Your video is ready');
    assert.deepEqual(m.data, { type: 'job', job_id: 'j1', state: 'succeeded' });
    assert.ok(!JSON.stringify(m).includes('private'));
    assert.ok(!JSON.stringify(m).includes('secret-model'));
    assert.equal(buildMessage(item({ modality: 'text-to-image' }), 'x').title, 'Your image is ready');
    assert.equal(buildMessage(item({ modality: null }), 'x').title, 'Your generation is ready');
});

test('a failure says "refunded" only when the ledger says REFUNDED', () => {
    assert.match(buildMessage(item({ kind: 'job_failed', job_state: 'REFUNDED' }), 'x').body, /refunded/i);
    assert.doesNotMatch(buildMessage(item({ kind: 'job_failed', job_state: 'FAILED' }), 'x').body, /refund/i);
});

test('Expo tickets: ok, permanent DeviceNotRegistered, and every transport failure retryable', async () => {
    const ok = (data) => async () => Response.json({ data });
    assert.deepEqual(await sendExpoBatch([{}, {}], { fetcher: ok([{ status: 'ok', id: 'a' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]) }),
        [{ status: 'ok' }, { status: 'error', error: 'DeviceNotRegistered', permanent: true }]);
    assert.equal((await sendExpoBatch([{}], { fetcher: ok([{ status: 'error', details: { error: 'MessageRateExceeded' } }]) }))[0].permanent, false);
    assert.equal((await sendExpoBatch([{}], { fetcher: async () => { throw new Error('down'); } }))[0].error, 'expo_unreachable');
    assert.equal((await sendExpoBatch([{}], { fetcher: async () => new Response('x', { status: 503 }) }))[0].error, 'expo_http_503');
    assert.equal((await sendExpoBatch([{}, {}], { fetcher: ok([{ status: 'ok' }]) }))[0].error, 'expo_bad_response');
});

test('the send goes to the one fixed Expo URL, with the access token only when set', async () => {
    const seen = [];
    const fetcher = async (url, init) => { seen.push({ url, auth: init.headers.Authorization }); return Response.json({ data: [{ status: 'ok' }] }); };
    await sendExpoBatch([{}], { fetcher });
    await sendExpoBatch([{}], { fetcher, accessToken: 'secret' });
    assert.deepEqual(seen, [{ url: EXPO_PUSH_URL, auth: undefined }, { url: EXPO_PUSH_URL, auth: 'Bearer secret' }]);
});

function db({ batch = [], failRpc } = {}) {
    const rpcs = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        if (u.host === 'exp.host') {
            rpcs.push({ name: 'expo', n: JSON.parse(init.body).length });
            return Response.json({ data: JSON.parse(init.body).map((_, i) => (db.tickets?.[i] || { status: 'ok' })) });
        }
        const name = u.pathname.split('/').pop();
        rpcs.push({ name, args: JSON.parse(init.body) });
        if (failRpc === name) throw new Error('db down');
        if (name === 'push_claim_batch') return Response.json(batch);
        return Response.json(name === 'push_enqueue_job_events' ? 0 : { ok: true });
    };
    return rpcs;
}

test('flag off: no database call, no send', async () => {
    const rpcs = db();
    assert.deepEqual(await runPushSweep({ env: {}, cfg }), { ok: true, skipped: true });
    assert.deepEqual(rpcs, []);
});

test('a sweep enqueues, claims, sends and settles each item as sent', async () => {
    db.tickets = undefined;
    const rpcs = db({ batch: [item()] });
    const out = await runPushSweep({ env: ON, cfg });
    assert.deepEqual(out, { ok: true, queued: 0, claimed: 1, sent: 1, failed: 0 });
    assert.deepEqual(rpcs.map((r) => r.name), ['push_enqueue_job_events', 'push_claim_batch', 'expo', 'push_settle', 'push_prune']);
    assert.deepEqual(rpcs[3].args, { p_id: 'o1', p_outcome: 'sent', p_error: null, p_dead_token_ids: [] });
});

test('a device Expo calls unregistered is switched off; a transient failure is retried', async () => {
    db.tickets = [{ status: 'error', details: { error: 'DeviceNotRegistered' } }];
    let rpcs = db({ batch: [item()] });
    await runPushSweep({ env: ON, cfg });
    assert.deepEqual(rpcs.find((r) => r.name === 'push_settle').args, { p_id: 'o1', p_outcome: 'dead', p_error: 'DeviceNotRegistered', p_dead_token_ids: ['t1'] });
    db.tickets = [{ status: 'error', details: { error: 'MessageRateExceeded' } }];
    rpcs = db({ batch: [item()] });
    await runPushSweep({ env: ON, cfg });
    assert.deepEqual(rpcs.find((r) => r.name === 'push_settle').args, { p_id: 'o1', p_outcome: 'retry', p_error: 'MessageRateExceeded', p_dead_token_ids: [] });
    db.tickets = undefined;
});

test('a failed push never touches a job or the ledger: only push_* functions are ever called', async () => {
    db.tickets = [{ status: 'error', details: { error: 'MessageRateExceeded' } }];
    const rpcs = db({ batch: [item(), item({ id: 'o2', kind: 'job_failed', job_state: 'REFUNDED' })] });
    await runPushSweep({ env: ON, cfg });
    const names = rpcs.map((r) => r.name).filter((n) => n !== 'expo');
    assert.ok(names.length > 0 && names.every((n) => /^push_/.test(n)), names.join(','));
    db.tickets = undefined;
});

test('the sweep never throws, whatever breaks', async () => {
    console.error = () => {};
    db({ failRpc: 'push_claim_batch' });
    assert.deepEqual(await runPushSweep({ env: ON, cfg }), { ok: false });
    db({ batch: [item()], failRpc: 'push_settle' });
    assert.deepEqual(await runPushSweep({ env: ON, cfg }), { ok: false });
    globalThis.fetch = async () => { throw new Error('everything down'); };
    assert.deepEqual(await runPushSweep({ env: ON, cfg }), { ok: false });
});
