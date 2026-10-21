import test from 'node:test';
import assert from 'node:assert/strict';
import { completeJob, findJob, extFromUrl, dedup, markProcessed } from '../lib/providerCompletion.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'fixture' };
const r2cfg = { accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' };
const job = { id: 'job-fixture', user_id: 'user-fixture', credits: 19, state: 'SUBMITTED' };
const success = { state: 'success', outputUrl: 'https://tempfile.aiquickdraw.com/a.mp4' };
const failure = { state: 'fail', errorCode: 'fixture_failure' };
const terminal = ['STORED', 'REFUNDED', 'CANCELLED'];

// All transports are fixtures. An unexpected host/path fails closed.
function network({ state = 'SUBMITTED', processed = null, exists = false, row = {}, readStatus = 200,
    refused = false, copyStatus = 200, storeOk = true, refundOk = true, waitForCopy } = {}) {
    const calls = [];
    const previous = globalThis.fetch;
    let stored = 0, refunded = 0;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const name = u.pathname.split('/').pop();
        calls.push({ host: u.hostname, name, method: init.method || 'GET', url: u,
            args: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        if (u.hostname === 'db.test') {
            if (name === 'webhook_events') {
                if (init.method === 'POST') {
                    if (exists) return Response.json([], { status: 201 });
                    exists = true;
                    return Response.json([{ id: 'event-fixture' }], { status: 201 });
                }
                if (init.method === 'PATCH') { processed = 'done'; return new Response(null, { status: 204 }); }
                return Response.json([{ processed_at: processed }]);
            }
            if (name === 'jobs') return Response.json(state ? [{ ...job, state, ...row }] : [], { status: readStatus });
            if (name === 'job_succeeded') {
                if (!refused && ['SUBMITTED', 'FAILOVER'].includes(state)) { state = 'SUCCEEDED'; return Response.json({ ok: true }); }
                return Response.json({ ok: false, code: 'JOB_NOT_FOUND_OR_BAD_STATE' });
            }
            if (name === 'job_failed') {
                if (!refused && ['SUBMITTED', 'FAILOVER'].includes(state)) { state = 'FAILED'; return Response.json({ ok: true }); }
                return Response.json({ ok: false, code: 'JOB_NOT_FOUND_OR_BAD_STATE' });
            }
            if (name === 'job_stored') {
                if (storeOk) { state = 'STORED'; stored++; }
                return Response.json({ ok: storeOk });
            }
            if (name === 'ledger_refund') {
                if (refundOk) { state = 'REFUNDED'; refunded++; }
                return Response.json({ ok: refundOk });
            }
        }
        if (u.hostname === 'tempfile.aiquickdraw.com') {
            if (waitForCopy) return waitForCopy();
            return new Response('fixture-video', { status: copyStatus });
        }
        if (u.hostname === 'fixture.r2.cloudflarestorage.com' && init.method === 'PUT') return new Response(null, { status: 200 });
        throw new Error(`Unexpected mocked request: ${u.hostname}${u.pathname}`);
    };
    return { calls, snapshot: () => ({ state, processed, stored, refunded }), restore: () => { globalThis.fetch = previous; } };
}

function complete(outcome = success, extra = {}) {
    return completeJob({ source: 'kie', job, providerJobId: 'task-fixture', outcome, ext: '.mp4', cfg, r2cfg, ...extra });
}
const marked = (net) => net.calls.some((c) => c.name === 'webhook_events' && c.method === 'PATCH');

test('overlapping stale success cannot seal a failed copy out of recovery', async () => {
    let entered, release;
    const copyStarted = new Promise((resolve) => { entered = resolve; });
    const copyReleased = new Promise((resolve) => { release = resolve; });
    let downloads = 0;
    const net = network({ waitForCopy: async () => {
        if (++downloads === 1) { entered(); await copyReleased; }
        return new Response('fixture-unavailable', { status: downloads <= 2 ? 503 : 200 });
    } });
    try {
        const first = complete();
        await copyStarted;
        const overlap = await complete();
        const markedWhileCopying = marked(net);
        release();
        assert.equal((await first).status, 500);
        assert.equal(markedWhileCopying, false, 'in-flight SUCCEEDED is not processed');
        assert.equal(overlap.status, 500);
        assert.equal((await complete()).status, 200);
        assert.deepEqual(net.snapshot(), { state: 'STORED', processed: 'done', stored: 1, refunded: 0 });
    } finally { release(); net.restore(); }
});

for (const [outcome, state, effect] of [[success, 'SUCCEEDED', 'stored'], [failure, 'FAILED', 'refunded']]) {
    test(`refused transition rereads ${state}, not the stale SUBMITTED snapshot`, async () => {
        const net = network({ state });
        try {
            assert.equal((await complete(outcome)).status, 200);
            assert.equal(net.snapshot()[effect], 1);
            const q = net.calls.find((c) => c.name === 'jobs').url.searchParams;
            assert.equal(q.get('id'), 'eq.job-fixture');
            assert.equal(q.get('user_id'), 'eq.user-fixture');
            assert.equal(q.get('provider'), 'eq.kie');
            assert.equal(q.get('provider_job_id'), 'eq.task-fixture');
        } finally { net.restore(); }
    });
    test(`prematurely processed ${state} is recovered for any provider`, async () => {
        const net = network({ state, exists: true, processed: 'old' });
        try {
            assert.equal((await complete(outcome)).status, 200);
            assert.equal(net.snapshot()[effect], 1);
        } finally { net.restore(); }
    });
}

for (const state of terminal) for (const outcome of [success, failure]) {
    test(`processed ${state} is a terminal no-op for ${outcome.state}`, async () => {
        const net = network({ state, exists: true, processed: 'old' });
        try {
            assert.equal((await complete(outcome)).body.duplicate, true);
            assert.equal(net.calls.some((c) => c.name.startsWith('job_') || c.name === 'ledger_refund' || c.host !== 'db.test'), false);
            assert.equal(marked(net), false);
        } finally { net.restore(); }
    });
}

for (const [snapshot, state, outcome] of [['SUCCEEDED', 'FAILED', success], ['FAILED', 'SUCCEEDED', failure], ['SUBMITTED', 'SUBMITTED', success], ['SUBMITTED', null, failure]]) {
    test(`refused transition from ${snapshot} to current ${state} cannot be marked processed`, async () => {
        const net = network({ state, refused: true });
        try {
            assert.equal((await complete(outcome, { job: { ...job, state: snapshot } })).status, 500);
            assert.equal(marked(net), false);
            assert.equal(net.snapshot().refunded + net.snapshot().stored, 0);
        } finally { net.restore(); }
    });
}

for (const state of terminal) test(`new callback can seal only authoritative terminal ${state}`, async () => {
    const net = network({ state });
    try {
        assert.equal((await complete()).status, 200);
        assert.equal(marked(net), true);
        assert.equal(net.snapshot().refunded + net.snapshot().stored, 0);
    } finally { net.restore(); }
});

test('unrecoverable copy is acknowledged without a processed marker', async () => {
    const net = network({ copyStatus: 404 });
    try {
        assert.equal((await complete()).body.warn, 'asset_store_failed');
        assert.equal(marked(net), false);
        assert.equal(net.snapshot().state, 'SUCCEEDED');
    } finally { net.restore(); }
});

for (const row of [{ id: 'another-job' }, { user_id: 'another-user' }]) test(`recovery refuses mismatched identity ${JSON.stringify(row)}`, async () => {
    const net = network({ state: 'FAILED', row });
    try {
        assert.equal((await complete(failure)).status, 500);
        assert.equal(net.calls.some((c) => c.name === 'ledger_refund'), false);
        assert.equal(marked(net), false);
    } finally { net.restore(); }
});

test('current row read failure is retryable and never seals the event', async () => {
    const net = network({ state: 'SUCCEEDED', readStatus: 503 });
    try {
        await assert.rejects(complete(), /select\(jobs\) failed/);
        assert.equal(marked(net), false);
    } finally { net.restore(); }
});

for (const [outcome, options, error] of [[success, { storeOk: false }, 'job_stored_failed'], [failure, { refundOk: false }, 'refund_failed']]) {
    test(`${error} leaves the event recoverable`, async () => {
        const net = network(options);
        try {
            assert.equal((await complete(outcome)).body.error, error);
            assert.equal(marked(net), false);
        } finally { net.restore(); }
    });
}

test('job lookup uses the catalog provider and rejects unknown or mismatched rows', async () => {
    const previous = globalThis.fetch;
    const calls = [];
    let rows = [job], model = { provider: 'kie', provider_endpoint: 'fixture/endpoint' };
    globalThis.fetch = async (url) => {
        const u = new URL(String(url));
        assert.equal(u.hostname, 'db.test');
        calls.push(u);
        if (u.pathname === '/rest/v1/jobs') return Response.json(rows);
        if (u.pathname === '/rest/v1/model_catalog') return Response.json(model ? [model] : []);
        throw new Error(`Unexpected mocked request: ${u.pathname}`);
    };
    try {
        assert.equal(await findJob(cfg, 'kie', ''), null);
        assert.equal(await findJob(cfg, 'kie', 'bad&task'), null);
        assert.equal(calls.length, 0);
        rows = [];
        assert.equal(await findJob(cfg, 'kie', 'task-fixture'), null);
        rows = [{ ...job, model_id: 'model-fixture' }];
        model = null;
        assert.equal(await findJob(cfg, 'kie', 'task-fixture'), null);
        model = { provider: 'openrouter', provider_endpoint: 'other' };
        assert.equal(await findJob(cfg, 'kie', 'task-fixture'), null);
        model = { provider: 'kie', provider_endpoint: 'fixture/endpoint' };
        assert.equal((await findJob(cfg, 'kie', 'task-fixture')).provider_endpoint, 'fixture/endpoint');
        assert.equal(calls[0].searchParams.get('provider_job_id'), 'eq.task-fixture');
    } finally { globalThis.fetch = previous; }
});

test('URL extension derives only a final path extension and falls back safely', () => {
    assert.equal(extFromUrl('https://cdn.test/a.MP4?token=fixture', '.bin'), '.mp4');
    assert.equal(extFromUrl('https://cdn.test/?name=a.mp4', '.bin'), '.bin');
    assert.equal(extFromUrl('not a url', '.bin'), '.bin');
});

test('dedup transport errors remain retryable; processed-patch transport failure is contained', async () => {
    const previous = globalThis.fetch;
    let mode = 'insert-failed';
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        assert.equal(u.hostname, 'db.test');
        assert.equal(u.pathname, '/rest/v1/webhook_events');
        if (init.method === 'PATCH') throw new Error('fixture patch failure');
        if (init.method === 'POST') return mode === 'insert-failed' ? new Response(null, { status: 503 }) : Response.json([], { status: 201 });
        if (mode === 'read-failed') return new Response(null, { status: 503 });
        return Response.json([{ processed_at: null }]);
    };
    try {
        await assert.rejects(dedup(cfg, 'kie', 'fixture', {}), /insert 503/);
        mode = 'read-failed';
        await assert.rejects(dedup(cfg, 'kie', 'fixture', {}), /read 503/);
        mode = 'retry';
        assert.equal(await dedup(cfg, 'kie', 'fixture', {}), 'retry');
        await markProcessed(cfg, 'kie', 'fixture');
    } finally { globalThis.fetch = previous; }
});
