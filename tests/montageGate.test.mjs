import test from 'node:test';
import assert from 'node:assert/strict';

import { checkPlan, checkCapacity, BUSY_RETRY_SECONDS } from '../lib/montageGate.js';
import { mintPlanToken, planIdempotencyKey } from '../lib/montagePlan.js';
import { onStepOutcome, start } from '../lib/montage.js';

const A = '22222222-2222-4222-8222-222222222222';
const BRIEF = 'a calm ocean timelapse at dusk';
const ENV = { MONTAGE_PLAN_SECRET: 'plan-secret', MONTAGE_RUNNER_BASE: 'https://runner.test', MONTAGE_SIGNING_SECRET: 's', PUBLIC_HOST: 'https://app.test' };
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'srk' };

async function ticket(over = {}) {
    const m = await mintPlanToken({ secret: ENV.MONTAGE_PLAN_SECRET, authId: A, brief: BRIEF, aspect: '9:16', credits: 165 });
    return { modelInputs: { brief: BRIEF, plan_id: m.token, aspect_ratio: '9:16' }, authId: A, idempotencyKey: planIdempotencyKey(m.nonce), credits: 165, env: ENV, ...over };
}

test('checkPlan passes a ticket used exactly as issued', async () => {
    assert.equal(await checkPlan(await ticket()), null);
});

test('checkPlan refuses a changed brief, a moved price and the wrong idempotency key, all before any debit', async () => {
    const t = await ticket();
    assert.deepEqual(await checkPlan({ ...t, modelInputs: { ...t.modelInputs, brief: BRIEF + '!' } }), { status: 400, body: { error: 'plan_mismatch' } });
    assert.deepEqual(await checkPlan({ ...t, credits: 166 }), { status: 409, body: { error: 'plan_price_changed' } });
    assert.deepEqual(await checkPlan({ ...t, idempotencyKey: 'plan_someone-elses-nonce' }), { status: 400, body: { error: 'plan_key_mismatch' } });
    assert.deepEqual(await checkPlan({ ...t, modelInputs: { ...t.modelInputs, plan_id: 'garbage' } }), { status: 400, body: { error: 'plan_invalid' } });
});

const capacity = (runner, jobs = []) => {
    const calls = [];
    const deps = {
        select: async (table, q) => { calls.push(['select', table, q.filter]); return jobs; },
        callRunner: async (path) => { calls.push(['runner', path]); return runner; },
    };
    return { calls, run: () => checkCapacity({ userId: 'u-1', idempotencyKey: 'plan_abc', cfg, env: ENV, deps }) };
};

test('a free runner lets the job through', async () => {
    const c = capacity({ ok: true, data: { busy: false, active: 0, max: 1 } });
    assert.equal(await c.run(), null);
    assert.deepEqual(c.calls.map((x) => x[0]), ['select', 'runner']);
    assert.equal(c.calls[1][1], '/status');
});

test('a busy runner is refused before the debit, with a retry hint', async () => {
    const r = await capacity({ ok: true, data: { busy: true, active: 1, max: 1 } }).run();
    assert.deepEqual(r, { status: 409, body: { error: 'video_agent_busy', retry_after_seconds: BUSY_RETRY_SECONDS }, retryAfter: BUSY_RETRY_SECONDS });
});

test('an unreachable runner, an odd answer or missing config is "offline", never a pass', async () => {
    for (const runner of [{ ok: false, error: 'runner_transport' }, { ok: true, data: {} }, { ok: true, data: { busy: 'no' } }, { ok: true }]) {
        assert.deepEqual(await capacity(runner).run(), { status: 503, body: { error: 'video_agent_offline' } }, JSON.stringify(runner));
    }
    const noConfig = await checkCapacity({ userId: 'u-1', idempotencyKey: 'plan_abc', cfg, env: {}, deps: { select: async () => [], callRunner: async () => ({ ok: true, data: { busy: false } }) } });
    assert.deepEqual(noConfig, { status: 503, body: { error: 'video_agent_offline' } });
});

test('a replay of a job the caller already started skips the busy check, so the ledger can answer it idempotently', async () => {
    const c = capacity({ ok: true, data: { busy: true, active: 1, max: 1 } }, [{ id: 'job-1' }]);
    assert.equal(await c.run(), null);
    assert.deepEqual(c.calls.map((x) => x[0]), ['select']); // the runner is never asked
    assert.match(decodeURIComponent(c.calls[0][2]), /user_id=eq\.u-1&idempotency_key=eq\.plan_abc/);
});

test('a failed replay lookup refuses instead of guessing', async () => {
    const r = await checkCapacity({ userId: 'u-1', idempotencyKey: 'k', cfg, env: ENV, deps: { select: async () => { throw new Error('db down'); }, callRunner: async () => ({ ok: true, data: { busy: false } }) } });
    assert.deepEqual(r, { status: 502, body: { error: 'video_agent_offline' } });
});

test('a brief the agent refused fails the job as brief_refused (refunded once), not as a generic failure', async () => {
    const JOB = '11111111-1111-4111-8111-111111111111';
    const job = { id: JOB, user_id: 'u-1', credits: 165, state: 'DEBITED', provider_job_id: null };
    const step = { job_id: JOB, step: 'montage', ordinal: 0, state: 'SUBMITTED', provider: 'montage', provider_job_id: null };
    const refunds = [];
    const deps = {
        rpc: async (name, a) => {
            if (name === 'job_submitted') { Object.assign(job, { state: 'SUBMITTED', provider_job_id: a.p_provider_job_id }); return { ok: true }; }
            if (name === 'job_step_claim') return { ok: true, claimed: true };
            if (name === 'job_step_submitted') { step.provider_job_id = a.p_provider_job_id; return { ok: true }; }
            if (name === 'job_step_failed') { step.state = 'FAILED'; step.error_code = a.p_error_code; return { ok: true }; }
            if (name === 'job_failed') { if (job.state !== 'SUBMITTED') return { ok: false }; job.state = 'FAILED'; job.error_code = a.p_error_code; return { ok: true, user_id: job.user_id, credits: job.credits }; }
            if (name === 'ledger_refund') { refunds.push(a.p_job_id); return { ok: true }; }
            throw new Error('unexpected rpc ' + name);
        },
        job: async () => ({ ...job }),
        runner: { run: async () => ({ ok: true }), cancel: async () => {} },
        head: async () => ({ ok: true, size: 1 }),
    };
    await start({ jobId: JOB, brief: 'x', planId: 'p', aspect: '9:16' }, deps);
    await onStepOutcome({ step, outcome: { state: 'fail', errorCode: 'brief_refused' } }, deps);
    assert.equal(job.error_code, 'brief_refused');
    assert.equal(step.error_code, 'brief_refused');
    assert.deepEqual(refunds, [JOB]);
});
