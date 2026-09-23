import test from 'node:test';
import assert from 'node:assert/strict';

import { validateEdit, planEdit, editUnits, start, onStepOutcome, parentRef } from '../lib/clipEdit.js';
import { handleStepCallback } from '../lib/autoShortWebhook.js';

const JOB = '11111111-2222-4333-8444-555555555555';
const clip = (key, in_s, out_s, duration_s = 10) => ({ key, in_s, out_s, duration_s, aspect: '9:16' });

/** Parent job, job_steps (0091/0092 rules) and fal, in memory. */
function world(edit) {
    const job = { id: JOB, user_id: 'u-1', credits: 3, state: 'DEBITED', inputs: { edit } };
    const steps = [];
    const calls = { refunds: 0, submits: [], stored: null };
    const find = (a) => steps.find((s) => s.step === a.p_step && s.ordinal === a.p_ordinal);
    const rpc = async (name, a) => {
        switch (name) {
            case 'job_submitted': job.state = 'SUBMITTED'; job.ref = a.p_provider_job_id; return { ok: true };
            case 'job_step_submitted': {
                const s = find(a);
                if (!s) { steps.push({ job_id: JOB, step: a.p_step, ordinal: a.p_ordinal, provider: 'fal', provider_endpoint: a.p_provider_endpoint, state: 'SUBMITTED', attempts: 1 }); return { ok: true }; }
                if (s.attempts >= 2) return { ok: false };
                s.attempts += 1;
                return { ok: true };
            }
            case 'job_step_stored': Object.assign(find(a), { state: 'STORED', output_r2_key: a.p_output_r2_key }); return { ok: true };
            case 'job_step_failed': find(a).state = 'FAILED'; return { ok: true };
            case 'job_failed': if (job.state !== 'SUBMITTED') return { ok: false }; job.state = 'FAILED'; return { ok: true };
            case 'ledger_refund': assert.equal(a.p_credits, 3); calls.refunds += 1; return { ok: true };
            case 'job_stored': assert.equal(a.p_provider_job_id, parentRef(JOB)); job.state = 'STORED'; calls.stored = a; return { ok: true };
            default: throw new Error(`unexpected rpc ${name}`);
        }
    };
    const deps = {
        rpc,
        steps: async () => steps.map((s) => ({ ...s })),
        job: async () => ({ ...job }),
        presign: async (key) => { assert.ok(key, 'presign needs a key'); return `https://r2.example/${key}`; },
        submit: async (_p, endpoint, inputs) => { calls.submits.push({ endpoint, inputs }); return { ok: true, providerJobId: `req${calls.submits.length}` }; },
        copy: async (_url, key) => ({ ok: true, r2Key: key, mimeType: 'video/mp4', size: 10, sha256: 'a'.repeat(64) }),
    };
    // Deliver the callback for whichever step is in flight.
    const deliver = async (state = 'success') => {
        const live = steps.find((s) => s.state === 'SUBMITTED');
        const outcome = state === 'success' ? { state, outputUrl: 'https://fal.media/out.mp4' } : { state, errorCode: 'provider_failed' };
        return onStepOutcome({ step: { ...live }, outcome }, deps);
    };
    return { job, steps, calls, deps, deliver };
}

test('validateEdit refuses bad ranges, mixed aspect, over-long output and no-op edits', () => {
    assert.equal(validateEdit({ clips: [] }).error, 'clips_count');
    assert.equal(validateEdit({ clips: Array(11).fill(clip('k', 0, 1)) }).error, 'clips_count');
    assert.equal(validateEdit({ clips: [clip('k', 3, 2)] }).error, 'clip_range');
    assert.equal(validateEdit({ clips: [clip('k', 0, 11)] }).error, 'clip_range');
    assert.equal(validateEdit({ clips: [clip('a', 0, 5), { ...clip('b', 0, 5), aspect: '16:9' }] }).error, 'mixed_aspect');
    assert.equal(validateEdit({ clips: Array(7).fill(clip('k', 0, 10)) }).error, 'too_long');
    assert.equal(validateEdit({ clips: [clip('k', 0, 10)] }).error, 'nothing_to_do');
    assert.equal(validateEdit({ clips: [clip('k', 0, 4)], audio: { key: 'a', offset_s: 4 } }).error, 'audio_invalid');
    const ok = validateEdit({ clips: [clip('a', 1, 4), clip('b', 0, 10)], audio: { key: 'm', offset_s: 0 } });
    assert.equal(ok.ok, true);
    assert.equal(ok.output_s, 13);
});

test('planEdit trims only cut clips, then merges, then lays audio', () => {
    const edit = validateEdit({ clips: [clip('a', 1, 4), clip('b', 0, 10), clip('c', 2, 3)], audio: { key: 'm', offset_s: 1 } });
    assert.deepEqual(planEdit(edit), [
        { step: 'trim', ordinal: 0 }, { step: 'trim', ordinal: 2 }, { step: 'merge', ordinal: 0 }, { step: 'audio', ordinal: 0 },
    ]);
});

test('runs the chain one step at a time and stores the parent from the last output', async () => {
    const edit = validateEdit({ clips: [clip('a', 1, 4), clip('b', 0, 10)], audio: { key: 'm', offset_s: 2 } });
    const w = world(edit);
    assert.deepEqual(await start({ jobId: JOB, edit }, w.deps), { ok: true });
    assert.equal(w.steps.length, 1);
    assert.deepEqual(w.calls.submits[0].inputs, { video_url: 'https://r2.example/a', start_time: 1, end_time: 4 });

    assert.equal((await w.deliver()).advanced, 'merge');
    assert.equal(w.steps.filter((s) => s.state === 'SUBMITTED').length, 1, 'never two steps in flight');
    assert.deepEqual(w.calls.submits[1].inputs.video_urls, [`https://r2.example/edits/${JOB}/trim-0.mp4`, 'https://r2.example/b']);

    assert.equal((await w.deliver()).advanced, 'audio');
    assert.deepEqual(w.calls.submits[2].inputs, { video_url: `https://r2.example/edits/${JOB}/merge-0.mp4`, audio_url: 'https://r2.example/m', start_offset: 2 });

    assert.equal((await w.deliver()).stored, true);
    assert.equal(w.job.state, 'STORED');
    assert.equal(w.calls.stored.p_r2_key, `edits/${JOB}/audio-0.mp4`);
    assert.equal(w.calls.refunds, 0);
});

test('a failed step retries once, then fails the parent and refunds exactly once', async () => {
    const edit = validateEdit({ clips: [clip('a', 1, 4)] });
    const w = world(edit);
    await start({ jobId: JOB, edit }, w.deps);
    assert.equal((await w.deliver('fail')).retried, true);
    const r = await w.deliver('fail');
    assert.equal(r.refunded, true);
    assert.equal(w.job.state, 'FAILED');
    assert.equal(w.calls.refunds, 1);
    // A late redelivery of the same failure is a replay: no second refund.
    await onStepOutcome({ step: { ...w.steps[0] }, outcome: { state: 'fail' } }, w.deps);
    assert.equal(w.calls.refunds, 1);
});

test('a single trimmed clip with no audio stores after one step', async () => {
    const edit = validateEdit({ clips: [clip('a', 2, 5)] });
    const w = world(edit);
    await start({ jobId: JOB, edit }, w.deps);
    assert.equal((await w.deliver()).stored, true);
});

test('webhook dispatch sends editor steps to the Clip Editor, not Auto Short', async () => {
    const edit = validateEdit({ clips: [clip('a', 2, 5)] });
    const w = world(edit);
    await start({ jobId: JOB, edit }, w.deps);
    const cfg = { supabaseUrl: 'https://db.example', serviceRoleKey: 'k' };
    const realFetch = globalThis.fetch;
    // dedup + markProcessed hit webhook_events; accept them.
    globalThis.fetch = async () => new Response('[{"id":1}]', { status: 201, headers: { 'content-type': 'application/json' } });
    try {
        const r = await handleStepCallback({ source: 'fal', providerJobId: 'req1', step: { ...w.steps[0] }, outcome: { state: 'success', outputUrl: 'https://fal.media/o.mp4' }, deps: w.deps, cfg });
        assert.equal(r.status, 200);
        assert.equal(w.job.state, 'STORED');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('an edit is billed by the greater of its length and its step count', () => {
    // 10 clips of 0.3 s: 3 s of output, but ten trims + a merge = 11 calls.
    const many = validateEdit({ clips: Array.from({ length: 10 }, (_, i) => clip(`c${i}`, 0.1, 0.4)) });
    assert.equal(many.output_s, 3);
    assert.equal(planEdit(many).length, 11);
    assert.equal(editUnits(many), 11, 'the short edit pays for the work it causes');

    // A long two-clip edit is still priced on its length.
    const long = validateEdit({ clips: [clip('a', 0, 30, 30), clip('b', 1, 26, 30)] });
    assert.equal(long.output_s, 55);
    assert.equal(editUnits(long), 11, '55 s = 11 started units, above its 3 steps');

    // One trimmed clip: one step, one unit — unchanged.
    assert.equal(editUnits(validateEdit({ clips: [clip('a', 0, 4)] })), 1);
});
