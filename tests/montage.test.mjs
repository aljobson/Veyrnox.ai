import test from 'node:test';
import assert from 'node:assert/strict';

import { start, onStepOutcome, parentRef, runRef, outputKey, failParent } from '../lib/montage.js';
import { parseEvent, handleRunnerEvent, isTimedOut } from '../lib/montageWebhook.js';
import { signRunnerBody, verifyRunnerBody } from '../lib/montageSigning.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(64);

/** In-memory stand-in for the parent job, its one montage step (0227 rules), the runner and R2. */
function world({ runnerOk = true, runError = 'runner_503', cancel = null, refundOk = true, recordOk = true, claimRaced = false, head = { ok: true, size: 5000 } } = {}) {
    const job = { id: JOB, user_id: 'u-1', credits: 90, state: 'DEBITED', provider_job_id: null };
    const step = { job_id: JOB, step: 'montage', ordinal: 0, provider: 'montage', provider_endpoint: 'video-agent:v1', provider_job_id: null, state: 'SUBMITTED', attempts: 1 };
    let claimed = false;
    const calls = { runs: [], cancels: [], refunds: [], stored: null, stepFailed: [], order: [], runIdAtRun: undefined };
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
                calls.order.push('refund');
                if (!refundOk) return { ok: false, code: 'REFUND_REJECTED' };
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
            run: async (req) => { calls.runs.push(req); calls.runIdAtRun = step.provider_job_id; return runnerOk ? { ok: true } : { ok: false, error: runError }; },
            cancel: async (id) => { calls.order.push('cancel'); calls.cancels.push(id); return cancel ? cancel(calls) : { ok: true }; },
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
    assert.equal(w.calls.cancels.length, 0);
});

test('a lost claim race never calls the runner', async () => {
    const w = world({ claimRaced: true });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.raced, true);
    assert.equal(w.calls.runs.length, 0);
    assert.equal(w.calls.cancels.length, 0);
});

test('runner refusing the run refunds once and fails the step', async () => {
    const w = world({ runnerOk: false });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.error, 'runner_submit_failed');
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.calls.refunds, [JOB]);
    assert.deepEqual(w.calls.stepFailed, ['runner_submit_failed']);
});

const refundCalls = (w) => w.calls.order.filter((e) => e === 'refund').length;

// 'runner_transport' is a timeout or a network error and 5xx may come from a proxy: either way the runner may
// have accepted the run (its /run answers 202 and works in a thread). 4xx is the runner refusing before it starts.
for (const runError of ['runner_transport', 'runner_503', 'runner_429', 'runner_400', 'runner_401']) {
    test(`a start that failed with ${runError} is cancelled at the runner, then refunded once`, async () => {
        const w = world({ runnerOk: false, runError });
        const r = await start(BRIEF, w.deps);
        assert.equal(r.error, 'runner_submit_failed');
        assert.deepEqual(w.calls.cancels, [runRef(JOB)]);
        assert.equal(w.job.state, 'FAILED');
        assert.deepEqual(w.calls.stepFailed, ['runner_submit_failed']);
        assert.deepEqual(w.calls.refunds, [JOB]);
        assert.equal(refundCalls(w), 1);
        assert.deepEqual(w.calls.order, ['cancel', 'refund']);
    });
}

test('a cancel that throws does not skip the refund of a failed start', async () => {
    const w = world({ runnerOk: false, runError: 'runner_transport', cancel: async () => { throw new Error('runner down'); } });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.error, 'runner_submit_failed');
    assert.deepEqual(w.calls.cancels, [runRef(JOB)]);
    assert.equal(w.job.state, 'FAILED');
    assert.equal(refundCalls(w), 1);
});

test('the refund of a failed start does not wait for a slow cancel', async () => {
    // An unreachable runner holds the cancel for its full timeout. This one settles only once the refund has
    // been asked for; if the refund waited on it, it would give up after 200 ms having seen none.
    let sawRefund = null;
    const cancel = async (calls) => {
        const until = Date.now() + 200;
        while (!calls.order.includes('refund') && Date.now() < until) await new Promise((r) => setTimeout(r, 2));
        sawRefund = calls.order.includes('refund');
    };
    const w = world({ runnerOk: false, runError: 'runner_transport', cancel });
    await start(BRIEF, w.deps);
    assert.equal(sawRefund, true);
    assert.equal(refundCalls(w), 1);
});

test('a failed start whose refund is rejected has still told the runner to stop', async () => {
    const w = world({ runnerOk: false, runError: 'runner_transport', refundOk: false });
    await assert.rejects(start(BRIEF, w.deps), /refund rejected/);
    assert.deepEqual(w.calls.cancels, [runRef(JOB)]);
});

test('a run whose id cannot be recorded never reaches the runner and is refunded once', async () => {
    const w = world({ recordOk: false });
    const r = await start(BRIEF, w.deps);
    assert.equal(r.error, 'step_not_recorded');
    assert.equal(w.calls.runs.length, 0);
    assert.equal(w.calls.cancels.length, 0);
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.calls.stepFailed, ['step_not_recorded']);
    assert.deepEqual(w.calls.refunds, [JOB]);
    assert.equal(refundCalls(w), 1);
});

test('the run id is on the step before the runner is asked, so its start check always finds the step', async () => {
    const w = world();
    await start(BRIEF, w.deps);
    assert.equal(w.calls.runIdAtRun, runRef(JOB));
});

test('a failed start leaves a step that carries its run id, so a late callback and the sweep can find it', async () => {
    const w = world({ runnerOk: false, runError: 'runner_transport' });
    await start(BRIEF, w.deps);
    assert.equal(w.step.provider_job_id, runRef(JOB));
    assert.equal(w.step.state, 'FAILED');
});

test('started is answered yes only while the step and the job are both live', async () => {
    const ask = (w) => handleRunnerEvent({ event: { type: 'started' }, step: w.step, deps: w.deps, cfg: {} });

    const live = world(); await start(BRIEF, live.deps);
    assert.deepEqual(await ask(live), { status: 200, body: { ok: true } });

    // The start the Worker gave up on: step failed, job refunded. A /run that reaches the runner late must be told no.
    const gaveUp = world({ runnerOk: false, runError: 'runner_transport' }); await start(BRIEF, gaveUp.deps);
    assert.equal((await ask(gaveUp)).status, 409);

    // The job failed some other way while the step still reads SUBMITTED (the sweep, a manual fail).
    const jobDead = world(); await start(BRIEF, jobDead.deps); await failParent(JOB, 'x', jobDead.deps);
    assert.equal(jobDead.step.state, 'SUBMITTED');
    assert.equal((await ask(jobDead)).status, 409);

    // Asking changes nothing: no refund, no state moved, and the live run can still be asked again.
    assert.deepEqual(await ask(live), { status: 200, body: { ok: true } });
    assert.equal(live.job.state, 'SUBMITTED');
    assert.equal(live.calls.refunds.length, 0);
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

test('parseEvent accepts the five events and rejects the rest, sanitising error codes', () => {
    assert.deepEqual(parseEvent({ event: 'completed', bytes: 1, sha256: SHA }), { type: 'completed', bytes: 1, sha256: SHA });
    assert.deepEqual(parseEvent({ event: 'failed', error_code: 'spend_ceiling' }), { type: 'failed', errorCode: 'spend_ceiling' });
    assert.equal(parseEvent({ event: 'failed', error_code: '<script>' }).errorCode, 'runner_failed');
    assert.equal(parseEvent({ event: 'upload_url' }).type, 'upload_url');
    assert.equal(parseEvent({ event: 'progress' }).type, 'progress');
    assert.deepEqual(parseEvent({ event: 'started' }), { type: 'started' });
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
