import test from 'node:test';
import assert from 'node:assert/strict';

import { sweepSteps, pollFal, falAppId, STALE_MINUTES, TIMEOUT_MINUTES } from '../lib/autoShortSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'srk' };
const NOW = new Date('2026-09-22T12:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const JOB = '11111111-2222-4333-8444-555555555555';
const step = (over) => ({ job_id: JOB, step: 'scene', ordinal: 1, provider: 'kie', provider_endpoint: 'veo:veo3_lite',
    provider_job_id: 'task-1', state: 'SUBMITTED', attempts: 1, output_r2_key: null, output_text: null, updated_at: ago(15), ...over });

/** Stub the Supabase REST calls the sweep and the callback path make. */
function stubDb(rows) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, method: init.method });
        if (u.includes('/rest/v1/job_steps')) return Response.json(rows);
        if (u.includes('/rest/v1/webhook_events?on_conflict')) return new Response('[{"id":"e"}]', { status: 201 });
        if (u.includes('/rest/v1/webhook_events')) return new Response(null, { status: 204 });
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

function fakeDeps() {
    const rpcs = [];
    return {
        rpcs,
        deps: {
            rpc: async (name, args) => { rpcs.push({ name, args }); return { ok: true, attempts: 2 }; },
            steps: async () => [{ step: 'script', state: 'STORED', output_text: { narration: 'n', scenes: ['a', 'b', 'c', 'd'] } }],
            job: async () => ({ id: JOB, user_id: 'u', credits: 110, state: 'SUBMITTED' }),
            submit: async () => ({ ok: true, providerJobId: 'task-2' }),
            copy: async (url, key) => ({ ok: true, r2Key: key, size: 1, mimeType: 'video/mp4', sha256: 'a'.repeat(64) }),
            put: async () => ({ ok: true }),
            presign: async (k) => `https://r2/${k}`,
        },
    };
}

test('asks only for stale steps under a running parent', async () => {
    const calls = stubDb([]);
    const { deps } = fakeDeps();
    await sweepSteps({ cfg, deps, now: NOW, poll: {} });
    const q = decodeURIComponent(calls[0].url);
    assert.match(q, /state=eq\.SUBMITTED/);
    assert.match(q, /jobs\.state=eq\.SUBMITTED/);
    assert.match(q, /jobs!inner\(state\)/);
    assert.ok(q.includes(`updated_at=lt.${ago(STALE_MINUTES)}`), q);
});

test('a finished result is applied as if its callback had arrived', async () => {
    const calls = stubDb([step()]);
    const { deps, rpcs } = fakeDeps();
    const out = await sweepSteps({ cfg, deps, now: NOW, poll: { kie: async () => ({ state: 'success', outputUrl: 'https://x.aiquickdraw.com/1.mp4' }) } });
    assert.deepEqual(out, { checked: 1, applied: 1, timedOut: 0, errors: 0 });
    assert.equal(rpcs.find((r) => r.name === 'job_step_stored').args.p_output_r2_key, `auto-short/${JOB}/scene-1.mp4`);
    assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
});

test('a step still pending is left alone until the timeout, then fails and is retried', async () => {
    stubDb([step({ updated_at: ago(20) })]);
    let { deps, rpcs } = fakeDeps();
    let out = await sweepSteps({ cfg, deps, now: NOW, poll: { kie: async () => ({ state: 'pending' }) } });
    assert.deepEqual(out, { checked: 1, applied: 0, timedOut: 0, errors: 0 });
    assert.equal(rpcs.length, 0);

    stubDb([step({ updated_at: ago(TIMEOUT_MINUTES + 1) })]);
    ({ deps, rpcs } = fakeDeps());
    out = await sweepSteps({ cfg, deps, now: NOW, poll: { kie: async () => ({ state: 'pending' }) } });
    assert.equal(out.timedOut, 1);
    assert.equal(rpcs.find((r) => r.name === 'job_step_submitted').args.p_provider_job_id, 'task-2', 're-submitted once');
});

test('fal requests are read from the app queue: pending, completed, and failed results', async () => {
    assert.equal(falAppId('fal-ai/ffmpeg-api/compose'), 'fal-ai/ffmpeg-api');
    assert.equal(falAppId('fal-ai/elevenlabs/tts/turbo-v2.5'), 'fal-ai/elevenlabs');
    assert.equal(falAppId('nope'), null);
    const voice = step({ step: 'voice', ordinal: 0, provider: 'fal', provider_endpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5', provider_job_id: 'req-v' });
    const seen = [];
    const reply = (status, result, resultStatus = 200) => async (url) => {
        seen.push(url);
        return url.endsWith('/status') ? Response.json({ status }) : Response.json(result, { status: resultStatus });
    };
    assert.deepEqual(await pollFal(voice, 'k', reply('IN_PROGRESS')), { state: 'pending' });
    assert.equal(seen[0], 'https://queue.fal.run/fal-ai/elevenlabs/requests/req-v/status');
    assert.deepEqual(await pollFal(voice, 'k', reply('COMPLETED', { audio: { url: 'https://v3b.fal.media/a.mp3' }, timestamps: [] })),
        { state: 'success', outputUrl: 'https://v3b.fal.media/a.mp3', timestamps: [] });
    assert.equal((await pollFal(voice, 'k', reply('COMPLETED', { detail: 'bad input' }, 422))).state, 'fail');
    assert.deepEqual(await pollFal(voice, 'k', reply('COMPLETED', {}, 503)), { state: 'pending' });
});
