import test from 'node:test';
import assert from 'node:assert/strict';

import { sweepMontage, ORPHAN_GRACE_MINUTES, LIVENESS_GRACE_MINUTES } from '../lib/montageSweep.js';
import { sweepSteps } from '../lib/autoShortSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'srk' };
const NOW = new Date('2026-10-08T18:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const JOB = '1a9401a7-c5a1-449f-a7a6-92f71993dffe';
const row = (over) => ({ job_id: JOB, step: 'montage', ordinal: 0, provider: 'montage', provider_endpoint: 'video-agent:v1',
    provider_job_id: `mr_${JOB}`, state: 'SUBMITTED', attempts: 1, updated_at: ago(60), ...over });

function stubDb(rows) {
    const urls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('/rest/v1/job_steps')) return Response.json(rows);
        if (u.includes('/rest/v1/webhook_events?on_conflict')) return new Response('[{"id":"e"}]', { status: 201 });
        if (u.includes('/rest/v1/webhook_events')) return new Response(null, { status: 204 });
        throw new Error(`unexpected fetch ${u}`);
    };
    return urls;
}

/** Parent job as the ledger holds it: one debit, refunded at most once. */
function world() {
    const job = { id: JOB, user_id: 'u-1', credits: 165, state: 'SUBMITTED', provider_job_id: `va_${JOB}` };
    const refunds = [];
    const cancels = [];
    const rpc = async (name, a) => {
        if (name === 'job_step_failed') return { ok: true };
        if (name === 'job_failed') {
            if (a.p_provider_job_id !== job.provider_job_id || job.state !== 'SUBMITTED') return { ok: false };
            job.state = 'FAILED';
            return { ok: true, user_id: job.user_id, credits: job.credits };
        }
        if (name === 'ledger_refund') { if (!refunds.includes(a.p_job_id)) refunds.push(a.p_job_id); return { ok: true }; }
        throw new Error('unexpected rpc ' + name);
    };
    return { job, refunds, cancels, deps: { rpc, job: async () => ({ ...job }), runner: { cancel: async (id) => { cancels.push(id); } } } };
}

test('the montage sweep selects only montage steps that are SUBMITTED or FAILED under a SUBMITTED parent', async () => {
    const urls = stubDb([]);
    await sweepMontage({ cfg, deps: world().deps, now: NOW });
    const q = decodeURIComponent(urls.find((u) => u.includes('job_steps')));
    assert.match(q, /provider=eq\.montage/);
    assert.match(q, /state=in\.\(SUBMITTED,FAILED\)/);
    assert.match(q, /jobs\.state=eq\.SUBMITTED/);
});

test('the Auto Short sweep never touches montage steps (it failed one on staging and left the credits held)', async () => {
    const urls = stubDb([]);
    await sweepSteps({ cfg, deps: {}, now: NOW, poll: {} });
    assert.match(decodeURIComponent(urls.find((u) => u.includes('job_steps'))), /provider=neq\.montage/);
});

test('a run past its timeout is cancelled at the runner, failed and refunded once', async () => {
    stubDb([row({ updated_at: ago(60) })]);
    const w = world();
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW });
    assert.equal(out.timedOut, 1);
    assert.deepEqual(w.cancels, [`mr_${JOB}`]);
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.refunds, [JOB]);
});

test('a fresh run is left alone', async () => {
    stubDb([row({ updated_at: ago(3) })]);
    const w = world();
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW });
    assert.deepEqual([out.timedOut, out.healed, w.refunds.length], [0, 0, 0]);
    assert.equal(w.job.state, 'SUBMITTED');
});

test('a FAILED step under a SUBMITTED parent is healed: parent failed, credits refunded once', async () => {
    stubDb([row({ state: 'FAILED', updated_at: ago(ORPHAN_GRACE_MINUTES + 1) })]);
    const w = world();
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW });
    assert.equal(out.healed, 1);
    assert.equal(w.job.state, 'FAILED');
    assert.deepEqual(w.refunds, [JOB]);
});

test('healing is idempotent: a second pass over the same orphan refunds nothing more', async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) {
        stubDb([row({ state: 'FAILED', updated_at: ago(30) })]);
        await sweepMontage({ cfg, deps: w.deps, now: NOW });
    }
    assert.deepEqual(w.refunds, [JOB]);
});

test('a FAILED step inside the grace window is not touched (the handler may still be failing the parent)', async () => {
    stubDb([row({ state: 'FAILED', updated_at: ago(ORPHAN_GRACE_MINUTES - 2) })]);
    const w = world();
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW });
    assert.deepEqual([out.healed, w.refunds.length], [0, 0]);
    assert.equal(w.job.state, 'SUBMITTED');
});

// --- liveness: ask the runner which young runs it still has -------------------------------------------------------

/** world() with a runner that answers /runs. `answer` is the whole callRunner result, or a function that throws. */
function live(answer) {
    const w = world();
    w.asked = [];
    w.deps.runner.states = async (ids) => { w.asked.push(ids); return typeof answer === 'function' ? answer(ids) : answer; };
    return w;
}
const RUN = `mr_${JOB}`;
const says = (state) => ({ ok: true, data: { runs: { [RUN]: state } } });

for (const state of ['unknown', 'ended']) {
    test(`a young run the runner reports as ${state} is cancelled, failed as run_lost and refunded once`, async () => {
        stubDb([row({ updated_at: ago(10) })]);
        const w = live(says(state));
        const failedWith = [];
        const rpc = w.deps.rpc;
        w.deps.rpc = async (name, a) => { if (name === 'job_step_failed') failedWith.push(a.p_error_code); return rpc(name, a); };
        const out = await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
        assert.deepEqual([out.lost, out.timedOut, out.errors], [1, 0, 0]);
        assert.deepEqual(w.asked, [[RUN]]);
        assert.deepEqual(w.cancels, [RUN]);
        assert.deepEqual(failedWith, ['run_lost']);
        assert.equal(w.job.state, 'FAILED');
        assert.deepEqual(w.refunds, [JOB]);
    });
}

const LEFT_ALONE = {
    'running': says('running'),
    'a state we do not know': says('paused'),
    'no entry for the run': { ok: true, data: { runs: {} } },
    'an inherited key, not an own entry': { ok: true, data: { runs: Object.create({ [RUN]: 'unknown' }) } },
    'runs that is not an object': { ok: true, data: { runs: 'unknown' } },
    'no runs at all': { ok: true, data: {} },
    'a runner that cannot be reached': { ok: false, error: 'runner_transport' },
    'a runner call that throws': () => { throw new Error('down'); },
};
for (const [name, answer] of Object.entries(LEFT_ALONE)) {
    test(`liveness leaves a young run alone on ${name}`, async () => {
        stubDb([row({ updated_at: ago(10) })]);
        const w = live(answer);
        const out = await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
        assert.deepEqual([out.lost, out.timedOut, w.refunds.length, w.cancels.length], [0, 0, 0, 0]);
        assert.equal(w.job.state, 'SUBMITTED');
    });
}

test('with the flag off the runner is never asked, and a young run is left to the timeout', async () => {
    stubDb([row({ updated_at: ago(10) })]);
    const w = live(says('unknown'));
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW });
    assert.deepEqual([w.asked.length, out.lost, w.refunds.length], [0, 0, 0]);
    assert.equal(w.job.state, 'SUBMITTED');
});

test('a run inside the liveness grace is not asked about (its result may be in flight)', async () => {
    stubDb([row({ updated_at: ago(LIVENESS_GRACE_MINUTES - 1) })]);
    const w = live(says('unknown'));
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
    assert.deepEqual([w.asked.length, out.lost, w.refunds.length], [0, 0, 0]);
});

test('a run past the timeout is failed as step_timeout whatever the runner would say, and is not asked about', async () => {
    stubDb([row({ updated_at: ago(60) })]);
    const w = live(says('running'));
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
    assert.deepEqual([w.asked.length, out.timedOut, out.lost], [0, 1, 0]);
    assert.deepEqual(w.refunds, [JOB]);
});

test('a lost run seen on two passes is refunded once', async () => {
    const w = live(says('unknown'));
    for (let i = 0; i < 2; i += 1) {
        stubDb([row({ updated_at: ago(10) })]);
        await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
    }
    assert.deepEqual(w.refunds, [JOB]);
});

test('a FAILED orphan is never sent to the runner for a liveness answer', async () => {
    stubDb([row({ state: 'FAILED', updated_at: ago(30) })]);
    const w = live(says('unknown'));
    const out = await sweepMontage({ cfg, deps: w.deps, now: NOW, liveness: true });
    assert.deepEqual([w.asked.length, out.healed, out.lost], [0, 1, 0]);
});
