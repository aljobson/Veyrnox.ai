import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepGrsai, BATCH, TIMEOUT_MINUTES } from '../lib/grsaiSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const r2cfg = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const now = new Date('2026-09-24T12:00:00Z');
const job = (id, state = 'SUBMITTED', age = 1) => ({ id, user_id: 'owner', credits: 2, state,
    provider_job_id: `task-${id}`, created_at: new Date(+now - age * 60000).toISOString() });
const args = { cfg, r2cfg, apiKey: 'test-key', now };
async function withRows(rows, run, models = [{ id: 'nano-banana-pro-grsai' }]) {
    const real = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json(new URL(url).pathname.endsWith('/model_catalog') ? models : rows); };
    try { await run(urls); } finally { globalThis.fetch = real; }
}

test('polling requires DB, provider and explicit R2 configuration before any reads', async () => {
    await withRows([], async (urls) => {
        for (const over of [{ apiKey: '' }, { cfg: {} }, { r2cfg: {} }]) {
            assert.deepEqual(await sweepGrsai({ ...args, ...over }), { skipped: 'not_configured' });
        }
        assert.equal(urls.length, 0);
    });
});

test('queries only unfinished GrsAI jobs whose catalog endpoint matches', async () => {
    await withRows([], async (urls) => {
        await sweepGrsai(args);
        const catalog = urls[0].searchParams;
        assert.equal(catalog.get('provider'), 'eq.grsai');
        assert.equal(catalog.get('provider_endpoint'), 'eq.grsai:nano-banana-pro');
        const q = urls[1].searchParams;
        assert.equal(q.get('provider'), 'eq.grsai');
        assert.equal(q.get('provider_job_id'), 'not.is.null');
        assert.equal(q.get('model_id'), 'eq.nano-banana-pro-grsai');
        assert.equal(q.get('state'), 'in.(SUBMITTED,SUCCEEDED,FAILED)');
        assert.equal(q.get('limit'), String(BATCH));
        assert.equal(q.get('order'), 'created_at.asc');
    });
});

test('success and failure use the same completion path and explicit cron credentials', async () => {
    const calls = [];
    await withRows([job('ok'), job('bad')], async () => {
        const out = await sweepGrsai({ ...args,
            read: async (id, options) => {
                assert.equal(options.apiKey, args.apiKey);
                return id === 'task-ok' ? { ok: true, state: 'success', outputUrl: 'https://file6.aitohumanize.com/a.png' }
                    : { ok: true, state: 'fail', errorCode: 'provider_moderation' };
            },
            complete: async (call) => { calls.push(call); return { status: 200, body: { ok: true } }; },
        });
        assert.deepEqual(out, { checked: 2, applied: 2, pending: 0, errors: 0 });
        for (const c of calls) {
            assert.equal(c.source, 'grsai');
            assert.equal(c.job.user_id, 'owner');
            assert.equal(c.job.credits, 2);
            assert.equal(c.r2cfg, r2cfg);
            assert.equal(c.cfg, cfg);
        }
    });
});

test('pending waits, old running tasks time out, read errors do not become failures', async () => {
    const completed = [];
    await withRows([job('young'), job('old', 'SUBMITTED', TIMEOUT_MINUTES + 1), job('outage', 'SUBMITTED', 60)], async () => {
        const out = await sweepGrsai({ ...args,
            read: async (id) => id === 'task-outage' ? { ok: false, error: 'provider_unavailable' } : { ok: true, state: 'pending' },
            complete: async (c) => { completed.push(c); return { status: 200 }; },
        });
        assert.deepEqual(out, { checked: 3, applied: 1, pending: 1, errors: 1 });
        assert.equal(completed[0].job.id, 'old');
        assert.deepEqual(completed[0].outcome, { state: 'fail', errorCode: 'provider_timeout' });
    });
});

test('FAILED refunds retry without polling; SUCCEEDED storage retries without submission', async () => {
    const reads = [], completions = [];
    await withRows([job('failed', 'FAILED'), job('copy', 'SUCCEEDED')], async () => {
        const out = await sweepGrsai({ ...args,
            read: async (id) => { reads.push(id); return { ok: true, state: 'success', outputUrl: 'https://file6.aitohumanize.com/a.png' }; },
            complete: async (c) => { completions.push(c); return { status: c.job.id === 'copy' ? 500 : 200 }; },
        });
        assert.deepEqual(reads, ['task-copy']);
        assert.equal(completions.find((c) => c.job.id === 'failed').outcome.state, 'fail');
        assert.equal(out.errors, 1);
        assert.equal(out.applied, 1);
    });
});

test('one thrown read cannot prevent other jobs completing; concurrency and batch bounded', async () => {
    let active = 0, peak = 0, count = 0;
    await withRows(Array.from({ length: BATCH + 5 }, (_, i) => job(String(i))), async () => {
        const out = await sweepGrsai({ ...args,
            read: async (id) => {
                count += 1; active += 1; peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, 1));
                active -= 1;
                if (id === 'task-0') throw new Error('unavailable');
                return { ok: true, state: 'pending' };
            },
            complete: async () => { throw new Error('must not complete pending'); },
        });
        assert.equal(count, BATCH);
        assert.ok(peak <= 5);
        assert.equal(out.errors, 1);
        assert.equal(out.pending, BATCH - 1);
    });
});

test('missing or changed catalog row is not polled', async () => {
    await withRows([job('1')], async (urls) => {
        assert.deepEqual(await sweepGrsai(args), { skipped: 'catalog_not_configured' });
        assert.equal(urls.length, 1);
    }, []);
});
