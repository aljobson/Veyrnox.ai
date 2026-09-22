import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, registerPipeline, pipelineFor } from '../lib/compositeJobs.js';

// The database owns the guards (0091, packages/db/job-steps.acceptance.test.ts).
// These pin what the app does with each answer: which provider call, which
// R2 key, and that a failed parent is refunded exactly once.

const JOB = 'job-1';
const cfg = {};
const env = { falKey: 'k', publicHost: 'https://veyrnox.ai' };

function fakes({ rpcs = {}, steps = [], outputs = [], submit, copy, seen = 'new', pipeline } = {}) {
    const calls = [];
    const rpcQueue = Object.fromEntries(Object.entries(rpcs).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
    const deps = {
        rpc: async (fn, args) => {
            calls.push([fn, args]);
            const q = rpcQueue[fn];
            if (!q || !q.length) return { ok: true };
            return q.length > 1 ? q.shift() : q[0];
        },
        select: async (table) => {
            if (table === 'jobs') return [{ id: JOB, user_id: 'u1', model_id: 'test-edit', inputs: {} }];
            if (table === 'job_steps') return deps._stepLookup ? steps : outputs;
            return [];
        },
        presign: async (key) => `https://r2.example/${key}?sig`,
        copy: copy || (async (url, key) => ({ ok: true, r2Key: key, mimeType: 'video/mp4', size: 10, sha256: 'ab' })),
        dedup: async () => seen,
        markProcessed: async (...a) => calls.push(['markProcessed', a]),
        submitters: { fal: submit || (async (step) => { calls.push(['submit', step.id]); return { ok: true, providerJobId: `req-${step.id}` }; }) },
        pipelineFor: () => pipeline === undefined ? { plan: () => [], request: async (step, ctx) => ({ step: step.step, n: ctx.outputs.length }) } : pipeline,
    };
    return { deps, calls, names: () => calls.map((c) => c[0]) };
}

test('a callback that matches no step returns null so the webhook keeps its 409', async () => {
    const f = fakes();
    f.deps._stepLookup = true;
    const out = await makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: 'req-x', isFail: false, outputUrl: 'https://v3b.fal.media/x.mp4', ext: '.mp4' }, cfg, env);
    assert.equal(out, null);
    assert.equal(f.calls.length, 0);
});

test('a malformed provider id is rejected before any lookup', async () => {
    const f = fakes();
    assert.equal(await makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: '../x', isFail: false }, cfg, env), null);
});

test('success stores under a deterministic key, then submits the next ready step', async () => {
    const f = fakes({
        steps: [{ id: 's1', job_id: JOB, state: 'SUBMITTED', attempts: 1 }],
        rpcs: { job_steps_claim_ready: { ok: true, claimed: [{ id: 's2', step: 'merge', provider: 'fal', provider_endpoint: 'fal-ai/ffmpeg-api/merge-videos' }], failed: false, complete: false } },
    });
    f.deps._stepLookup = true;
    const keys = [];
    f.deps.copy = async (url, key) => { keys.push(key); return { ok: true, r2Key: key, mimeType: 'video/mp4', size: 10, sha256: 'ab' }; };
    const eng = makeEngine({ ...f.deps, select: async (t) => (t === 'jobs' ? [{ id: JOB, model_id: 'test-edit' }] : t === 'job_steps' && !keys.length ? [{ id: 's1', job_id: JOB, state: 'SUBMITTED', attempts: 1 }] : []) });
    const out = await eng.onStepCallback({ source: 'fal', providerJobId: 'req-s1', isFail: false, outputUrl: 'https://v3b.fal.media/a.mp4', ext: '.mp4' }, cfg, env);
    assert.equal(out.status, 200);
    assert.deepEqual(keys, [`steps/${JOB}/s1-1.mp4`]);
    const n = f.names();
    assert.ok(n.indexOf('job_step_stored') < n.indexOf('job_steps_claim_ready'), 'store before advancing');
    assert.ok(n.includes('submit') && n.includes('job_step_submitted'));
    assert.equal(n.at(-1), 'markProcessed', 'marked processed only after the work is done');
});

test('a duplicate delivery does nothing', async () => {
    const f = fakes({ steps: [{ id: 's1', job_id: JOB, state: 'STORED', attempts: 1 }], seen: 'duplicate' });
    f.deps._stepLookup = true;
    const out = await makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: 'req-s1', isFail: false, outputUrl: 'https://v3b.fal.media/a.mp4', ext: '.mp4' }, cfg, env);
    assert.deepEqual(out.body, { ok: true, duplicate: true });
    assert.equal(f.calls.length, 0);
});

test('a final failure refunds the parent once, with the parent facts from the database', async () => {
    const f = fakes({
        steps: [{ id: 's1', job_id: JOB, state: 'SUBMITTED', attempts: 2 }],
        rpcs: { job_step_failed: { ok: true, retry: false, job_id: JOB, user_id: 'u1', credits: 3 } },
    });
    f.deps._stepLookup = true;
    await makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: 'req-s1', isFail: true, ext: '.mp4' }, cfg, env);
    const refunds = f.calls.filter((c) => c[0] === 'ledger_refund');
    assert.equal(refunds.length, 1);
    assert.deepEqual(refunds[0][1], { p_job_id: JOB, p_user_id: 'u1', p_credits: 3, p_reason: 'refund:provider_failed' });
});

test('a retryable failure does not refund and re-drives the job', async () => {
    const f = fakes({
        steps: [{ id: 's1', job_id: JOB, state: 'SUBMITTED', attempts: 1 }],
        rpcs: { job_step_failed: { ok: true, retry: true, job_id: JOB } },
    });
    f.deps._stepLookup = true;
    await makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: 'req-s1', isFail: true, ext: '.mp4' }, cfg, env);
    assert.ok(!f.names().includes('ledger_refund'));
    assert.ok(f.names().includes('job_steps_claim_ready'));
});

test('a rejected refund throws, so the webhook answers 500 and the delivery is retried', async () => {
    const f = fakes({
        steps: [{ id: 's1', job_id: JOB, state: 'SUBMITTED', attempts: 2 }],
        rpcs: { job_step_failed: { ok: true, retry: false, job_id: JOB, user_id: 'u1', credits: 3 }, ledger_refund: { ok: false, code: 'X' } },
    });
    f.deps._stepLookup = true;
    await assert.rejects(makeEngine(f.deps).onStepCallback({ source: 'fal', providerJobId: 'req-s1', isFail: true, ext: '.mp4' }, cfg, env));
});

test('a plan that is complete is finalised, not resubmitted', async () => {
    const f = fakes({ rpcs: { job_steps_claim_ready: { ok: true, claimed: [], failed: false, complete: true } } });
    const out = await makeEngine(f.deps).advance(JOB, cfg, env);
    assert.equal(out.state, 'stored');
    assert.ok(f.names().includes('job_composite_stored'));
    assert.ok(!f.names().includes('submit'));
});

test('a parent that is no longer live gets no further submits', async () => {
    const f = fakes({ rpcs: { job_steps_claim_ready: { ok: false, code: 'JOB_NOT_LIVE' } } });
    assert.equal((await makeEngine(f.deps).advance(JOB, cfg, env)).state, 'not_live');
    assert.ok(!f.names().includes('submit'));
});

test('a step with no registered pipeline fails for good and refunds', async () => {
    const f = fakes({
        pipeline: null,
        rpcs: {
            job_steps_claim_ready: { ok: true, claimed: [{ id: 's1', provider: 'fal', provider_endpoint: 'x/y' }], failed: false, complete: false },
            job_step_failed: { ok: true, retry: false, job_id: JOB, user_id: 'u1', credits: 3 },
        },
    });
    await makeEngine(f.deps).advance(JOB, cfg, env);
    const failed = f.calls.find((c) => c[0] === 'job_step_failed');
    assert.equal(failed[1].p_retryable, false);
    assert.equal(f.calls.filter((c) => c[0] === 'ledger_refund').length, 1);
});

test('a retryable submit failure is resubmitted in the same pass, and the retry is bounded', async () => {
    let n = 0;
    const f = fakes({
        submit: async () => { n += 1; return { ok: false, error: 'fal 503', retryable: true }; },
        rpcs: {
            job_steps_claim_ready: { ok: true, claimed: [{ id: 's1', provider: 'fal', provider_endpoint: 'x/y' }], failed: false, complete: false },
            job_step_failed: { ok: true, retry: true, job_id: JOB },
        },
    });
    await makeEngine(f.deps).advance(JOB, cfg, env);
    assert.equal(n, 3, 'first pass plus at most two re-passes');
});

test('redriveDue retries stale steps and re-drives every affected parent once', async () => {
    const f = fakes({
        rpcs: {
            job_steps_due: { ok: true, released: 1, stale: [{ step_id: 's9', job_id: 'j2' }], redrive: [JOB, 'j2'] },
            job_step_failed: { ok: true, retry: true, job_id: 'j2' },
            job_steps_claim_ready: { ok: true, claimed: [], failed: false, complete: false },
        },
    });
    const out = await makeEngine(f.deps).redriveDue(cfg, env);
    assert.deepEqual(out, { ok: true, released: 1, retried: 1, redriven: 2 });
    const failed = f.calls.find((c) => c[0] === 'job_step_failed');
    assert.deepEqual(failed[1], { p_step_id: 's9', p_error_code: 'step_timeout', p_retryable: true });
});

test('registerPipeline refuses an incomplete definition', () => {
    assert.throws(() => registerPipeline('bad', { plan: () => [] }));
    registerPipeline('unit-test-pipeline', { plan: () => [], request: async () => ({}) });
    assert.ok(pipelineFor('unit-test-pipeline'));
    assert.equal(pipelineFor('nope'), null);
});
