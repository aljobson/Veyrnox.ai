import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepByteplus, BATCH, TIMEOUT_MINUTES } from '../lib/byteplusSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const r2cfg = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const now = new Date('2026-09-26T12:00:00Z');
const job = (id, state = 'SUBMITTED', age = 1) => ({ id, user_id: 'owner', credits: 20, state,
    provider_job_id: `cgt-${id}`, created_at: new Date(+now - age * 60000).toISOString() });
const args = { cfg, r2cfg, apiKey: 'test-key', now };
const MODELS = [
    { id: 'seedance-2.0-fast-byteplus', provider_endpoint: 'byteplus:seedance-2.0-fast' },
    { id: 'seedance-2.0-mini-byteplus', provider_endpoint: 'byteplus:seedance-2.0-mini' },
    // A byteplus row pointing somewhere this adapter does not own is never swept.
    { id: 'stray-row', provider_endpoint: 'fal-ai/veo3.1' },
];
async function withRows(rows, run, models = MODELS) {
    const real = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json(new URL(url).pathname.endsWith('/model_catalog') ? models : rows); };
    try { await run(urls); } finally { globalThis.fetch = real; }
}

test('polling requires DB, provider and explicit R2 configuration before any reads', async () => {
    await withRows([], async (urls) => {
        for (const over of [{ apiKey: '' }, { cfg: {} }, { r2cfg: {} }]) {
            assert.deepEqual(await sweepByteplus({ ...args, ...over }), { skipped: 'not_configured' });
        }
        assert.equal(urls.length, 0);
    });
});

test('without a byteplus catalog row nothing is queried from jobs', async () => {
    await withRows([job('x')], async (urls) => {
        assert.deepEqual(await sweepByteplus(args), { skipped: 'catalog_not_configured' });
        assert.equal(urls.length, 1);
    }, []);
    await withRows([job('x')], async () => {
        assert.deepEqual(await sweepByteplus(args), { skipped: 'catalog_not_configured' });
    }, [{ id: 'stray-row', provider_endpoint: 'fal-ai/veo3.1' }]);
});

test('queries only unfinished byteplus jobs on rows whose endpoint this adapter owns', async () => {
    await withRows([], async (urls) => {
        await sweepByteplus(args);
        assert.equal(urls[0].searchParams.get('provider'), 'eq.byteplus');
        const q = urls[1].searchParams;
        assert.equal(q.get('provider'), 'eq.byteplus');
        assert.equal(q.get('provider_job_id'), 'not.is.null');
        assert.equal(q.get('model_id'), 'in.(seedance-2.0-fast-byteplus,seedance-2.0-mini-byteplus)');
        assert.equal(q.get('state'), 'in.(SUBMITTED,SUCCEEDED,FAILED)');
        assert.equal(q.get('limit'), String(BATCH));
        assert.equal(q.get('order'), 'created_at.asc');
    });
});

test('success and failure share the completion path, as MP4, with explicit cron credentials', async () => {
    const calls = [];
    await withRows([job('ok'), job('bad')], async () => {
        const out = await sweepByteplus({ ...args,
            read: async (id, options) => {
                assert.equal(options.apiKey, args.apiKey);
                return id === 'cgt-ok' ? { ok: true, state: 'success', outputUrl: 'https://ark-content.example/v.mp4', completionTokens: 108000 }
                    : { ok: true, state: 'fail', errorCode: 'provider_moderation' };
            },
            complete: async (call) => { calls.push(call); return { status: 200, body: { ok: true } }; },
        });
        assert.deepEqual(out, { checked: 2, applied: 2, pending: 0, errors: 0 });
        for (const c of calls) {
            assert.equal(c.source, 'byteplus');
            assert.equal(c.ext, '.mp4');
            assert.equal(c.copyOptions.expectMp4, true);
            assert.equal(c.job.user_id, 'owner');
            assert.equal(c.job.credits, 20);
            assert.equal(c.r2cfg, r2cfg);
            assert.equal(c.cfg, cfg);
        }
        assert.deepEqual(calls.map((c) => c.outcome.state), ['success', 'fail']);
    });
});

test('pending waits, old running tasks time out, read errors do not become failures', async () => {
    const completed = [];
    await withRows([job('young'), job('old', 'SUBMITTED', TIMEOUT_MINUTES + 1), job('outage', 'SUBMITTED', 60)], async () => {
        const out = await sweepByteplus({ ...args,
            read: async (id) => id === 'cgt-outage' ? { ok: false, error: 'provider_unavailable' } : { ok: true, state: 'pending' },
            complete: async (c) => { completed.push(c); return { status: 200 }; },
        });
        assert.deepEqual(out, { checked: 3, applied: 1, pending: 1, errors: 1 });
        assert.equal(completed.length, 1);
        assert.equal(completed[0].job.id, 'old');
        assert.deepEqual(completed[0].outcome, { state: 'fail', errorCode: 'provider_timeout' });
    });
});

test('a job already FAILED is refunded without a provider read', async () => {
    let reads = 0;
    const completed = [];
    await withRows([job('gone', 'FAILED')], async () => {
        const out = await sweepByteplus({ ...args,
            read: async () => { reads += 1; return { ok: true, state: 'pending' }; },
            complete: async (c) => { completed.push(c); return { status: 200, body: { ok: true } }; },
        });
        assert.equal(reads, 0);
        assert.deepEqual(out, { checked: 1, applied: 1, pending: 0, errors: 0 });
        assert.deepEqual(completed[0].outcome, { ok: true, state: 'fail', errorCode: 'provider_error' });
    });
});
