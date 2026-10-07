import test from 'node:test';
import assert from 'node:assert/strict';

import { start, onStepOutcome, parentRef, runRef, outputKey, failParent } from '../lib/montage.js';
import { parseEvent, handleRunnerEvent, isTimedOut } from '../lib/montageWebhook.js';
import { signRunnerBody, verifyRunnerBody } from '../lib/montageSigning.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(64);

/** In-memory stand-in for the parent job, its one montage step (0224 rules), the runner and R2. */
function world({ runnerOk = true, recordOk = true, claimRaced = false, head = { ok: true, size: 5000 } } = {}) {
    const job = { id: JOB, user_id: 'u-1', credits: 90, state: 'DEBITED', provider_job_id: null };
    const step = { job_id: JOB, step: 'montage', ordinal: 0, provider: 'montage', provider_endpoint: 'video-agent:v1', provider_job_id: null, state: 'SUBMITTED', attempts: 1 };
    let claimed = false;
    const calls = { runs: [], cancels: [], refunds: [], stored: null, stepFailed: [] };
    const rpc = async (name, a) => {
        switch (name) {
            case 'job_submitted':
                if (job.state !== 'DEBITED') return { ok: false };
                Object.assign(job, { state: 'SUBMITTED', provider_job_id: a.p_provider_job_id });
                return { ok: true };
            case 'job_step_claim':
                if (claimed || claimRaced) return { ok: true, claimed: false };
                claimed = true;
                return { ok: true, claimed: true };
            case 'job_step_submitted':
                if (!recordOk) return { ok: false, code: 'STEP_FINISHED' };
                step.provider_job_id = a.p_provider_job_id;
                return { ok: true };
            case 'job_step_failed': if (step.state === 'SUBMITTED') step.state = 'FAILED'; calls.stepFailed.push(a.p_error_code); return { ok: true };
            case 'job_step_stored': step.state = 'STORED'; return { ok: true };
            case 'job_failed':
                if (a.p_provider_job_id !== job.provider_job_id || job.state !== 'SUBMITTED') return { ok: false };
                job.state = 'FAILED'; job.error_code = a.p_error_code;
                return { ok: true, user_id: job.user_id, credits: job.credits };
            case 'ledger_refund':
                assert.equal(a.p_credits, 90);
                if (!calls.refunds.includes(a.p_job_id)) calls.refunds.push(a.p_job_id);
                return { ok: true };
            case 'job_stored':
                assert.equal(a.p_provider_job_id, parentRef(JOB));
                job.state = 'STORED'; calls.stored = a;
                return { ok: true };
            default: throw new Error('unexpected rpc ' + name);
        }
    };
    const deps = {
        rpc,
        job: async () => ({ ...job }),
        runner: {
            run: async (req) => { calls.runs.push(req); return runnerOk ? { ok: true } : { ok: false, error: 'runner_503' }; },
            cancel: async (id) => { calls.cancels.push(id); },
        },
        head: async () => head,
        presignPut: async (key) => 'https://r2.example/' + key + '?sig=x',
    };
    return { job, step, calls, deps };
}

const BRIEF = { jobId: JOB, brief: 'a calm ocean timelapse', planId: 'plan-1', aspect: '9:16' };
const submitted = (w) => { w.step.provider_job_id = runRef(JOB); };

test('start debits nothing itself: submits the parent, claims the step and calls the runner once', async () => {
    const w = world();
    const r = await start(BRIEF, w.deps);
    assert.deepEqual(r, { ok: true });
    assert.equal(w.job.state, 'SUBMITTED');
    assert.equal(w.calls.runs.length, 1);
    assert.equal(w.calls.runs[0].run_id, runRef(JOB));
    assert.equal(w.step.provider_job_id, runRef(JOB));
    assert.equal(w.calls.refunds.length, 0);
});

test('a lost claim race never calls the runner', async () => {
    const w = world({ claimRaced: true });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.raced, true);
    assert.equal(w.calls.runs.length, 0);
});

test('runner refusing the run refunds once and fails the step', async () => {
    const w = world({ runnerOk: false });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.error, 'runner_submit_failed');
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.calls.refunds, [JOB]);
    assert.deepEqual(w.calls.stepFailed, ['runner_submit_failed']);
});

test('a run that cannot be recorded is cancelled at the runner, then refunded once', async () => {
    const w = world({ recordOk: false });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.error, 'step_not_recorded');
    assert.deepEqual(w.calls.cancels, [runRef(JOB)]);
    assert.deepEqual(w.calls.refunds, [JOB]);
});

test('a completed run with the object present stores the step and the parent with the right key', async () => {
    const w = world(); await start(BRIEF, w.deps);
    const r = await onStepOutcome({ step: w.step, outcome: { state: 'success', bytes: 5000, sha256: SHA } }, w.deps);
    assert.deepEqual(r, { ok: true, stored: true });
    assert.equal(w.job.state, 'STORED');
    assert.equal(w.calls.stored.p_r2_key, outputKey(JOB));
    assert.equal(w.calls.stored.p_size_bytes, 5000);
    assert.equal(w.calls.refunds.length, 0);
});

test('every failure stage refunds exactly once', async () => {
    const cases = {
        'runner reports failure': [{}, { state: 'fail', errorCode: 'spend_ceiling' }],
        'object missing': [{ head: { ok: false, error: 'missing' } }, { state: 'success', bytes: 5000, sha256: SHA }],
        'size mismatch': [{ head: { ok: true, size: 4999 } }, { state: 'success', bytes: 5000, sha256: SHA }],
        'bad sha': [{}, { state: 'success', bytes: 5000, sha256: 'xyz' }],
        'zero bytes': [{}, { state: 'success', bytes: 0, sha256: SHA }],
        'oversized': [{}, { state: 'success', bytes: 600 * 1024 * 1024, sha256: SHA }],
    };
    for (const [name, [opts, outcome]] of Object.entries(cases)) {
        const w = world(opts); await start(BRIEF, w.deps);
        await onStepOutcome({ step: w.step, outcome }, w.deps);
        assert.equal(w.job.state, 'FAILED', name);
        assert.deepEqual(w.calls.refunds, [JOB], name);
    }
});

test('a replayed failure callback does not refund twice', async () => {
    const w = world(); await start(BRIEF, w.deps);
    const stepAtCallback = { ...w.step };
    await onStepOutcome({ step: stepAtCallback, outcome: { state: 'fail', errorCode: 'runner_failed' } }, w.deps);
    const again = await onStepOutcome({ step: w.step, outcome: { state: 'fail', errorCode: 'runner_failed' } }, w.deps);
    assert.equal(again.replay, true);
    assert.deepEqual(w.calls.refunds, [JOB]);
});

test('a failure after the parent already failed takes no more action', async () => {
    const w = world(); await start(BRIEF, w.deps);
    await failParent(JOB, 'manual', w.deps);
    const r = await onStepOutcome({ step: { ...w.step, state: 'SUBMITTED' }, outcome: { state: 'success', bytes: 5000, sha256: SHA } }, w.deps);
    assert.equal(r.parentDone, true);
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.calls.refunds, [JOB]);
});

test('an R2 transport error is retryable: no refund, redelivery allowed', async () => {
    const w = world({ head: { ok: false, error: 'r2_unavailable' } }); await start(BRIEF, w.deps);
    const r = await onStepOutcome({ step: w.step, outcome: { state: 'success', bytes: 5000, sha256: SHA } }, w.deps);
    assert.equal(r.ok, false);
    assert.equal(w.job.state, 'SUBMITTED');
    assert.equal(w.calls.refunds.length, 0);
});

test('upload_url hands out a PUT URL for our own key only while the run is live', async () => {
    const w = world(); await start(BRIEF, w.deps);
    const live = await handleRunnerEvent({ event: { type: 'upload_url' }, step: w.step, deps: w.deps, cfg: {} });
    assert.equal(live.status, 200);
    assert.match(live.body.upload_url, new RegExp('video-agent/' + JOB + '/final.mp4'));
    assert.equal(live.body.expires_seconds, 900);
    await failParent(JOB, 'x', w.deps);
    const dead = await handleRunnerEvent({ event: { type: 'upload_url' }, step: w.step, deps: w.deps, cfg: {} });
    assert.equal(dead.status, 409);
});

test('parseEvent accepts the four events and rejects the rest, sanitising error codes', () => {
    assert.deepEqual(parseEvent({ event: 'completed', bytes: 1, sha256: SHA }), { type: 'completed', bytes: 1, sha256: SHA });
    assert.deepEqual(parseEvent({ event: 'failed', error_code: 'spend_ceiling' }), { type: 'failed', errorCode: 'spend_ceiling' });
    assert.equal(parseEvent({ event: 'failed', error_code: '<script>' }).errorCode, 'runner_failed');
    assert.equal(parseEvent({ event: 'upload_url' }).type, 'upload_url');
    assert.equal(parseEvent({ event: 'progress' }).type, 'progress');
    assert.equal(parseEvent({ event: 'delete_everything' }), null);
    assert.equal(parseEvent(null), null);
});

test('a step older than the timeout is timed out, a fresh one is not', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    assert.equal(isTimedOut({ updated_at: '2026-10-07T11:00:00Z' }, now), true);
    assert.equal(isTimedOut({ updated_at: '2026-10-07T11:30:00Z' }, now), false);
});

test('signing matches the runner (Python) byte for byte, and rejects stale, tampered and malformed input', async () => {
    const sig = '1698a50bc74d1ff1db85c4e0a5297c2ad9fdba245d5737cdb789e4cc6e098940';
    assert.equal(await signRunnerBody('s3cret', '{"a":1}', 1700000000), sig);
    assert.equal(await verifyRunnerBody('s3cret', '{"a":1}', '1700000000', sig, 1700000100), true);
    assert.equal(await verifyRunnerBody('s3cret', '{"a":1}', '1700000000', sig, 1700000301), false);
    assert.equal(await verifyRunnerBody('s3cret', '{"a":2}', '1700000000', sig, 1700000100), false);
    assert.equal(await verifyRunnerBody('s3cret', '{"a":1}', 'abc', sig, 1700000100), false);
    assert.equal(await verifyRunnerBody('', '{"a":1}', '1700000000', sig, 1700000100), false);
    assert.equal(await verifyRunnerBody('s3cret', '{"a":1}', '1700000000', sig.slice(1), 1700000100), false);
});
