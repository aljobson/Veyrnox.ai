import test from 'node:test';
import assert from 'node:assert/strict';

import { start, onStepOutcome, parentRef } from '../lib/autoShort.js';
import { parseScript, captionsVtt, buildScriptRequest } from '../lib/autoShortScript.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';

const NARRATION = Array.from({ length: 78 }, (_, i) => (i === 77 ? 'end.' : `word${i}`)).join(' ');
const SCRIPT = { title: 'Octopus facts', narration: NARRATION, scenes: ['a reef shot, vertical framing', 'skin macro, vertical framing', 'arm on a shell, vertical framing', 'open water, vertical framing'] };

/** In-memory stand-in for the parent job, job_steps (0091 rules) and the providers. */
function world({ chat = { ok: true, content: JSON.stringify(SCRIPT) }, submitFails = () => false } = {}) {
    const job = { id: 'job-1', user_id: 'u-1', credits: 110, state: 'DEBITED', provider_job_id: null };
    const steps = [];
    const calls = { refunds: [], submits: [], puts: [], presigned: [], stored: null };
    let n = 0;
    const find = (a) => steps.find((s) => s.step === a.p_step && s.ordinal === a.p_ordinal);
    const rpc = async (name, a) => {
        switch (name) {
            case 'job_submitted':
                if (job.state !== 'DEBITED') return { ok: false };
                Object.assign(job, { state: 'SUBMITTED', provider: a.p_provider, provider_job_id: a.p_provider_job_id });
                return { ok: true };
            // 0101: UNIQUE (job_id, step, ordinal) decides who submits.
            case 'job_step_claim': {
                if (find(a)) return { ok: true, claimed: false };
                steps.push({ job_id: job.id, step: a.p_step, ordinal: a.p_ordinal, provider: a.p_provider, provider_endpoint: a.p_provider_endpoint, provider_job_id: null, state: 'SUBMITTED', attempts: 1 });
                return { ok: true, claimed: true };
            }
            case 'job_step_submitted': {
                const s = find(a);
                if (!s) { steps.push({ job_id: job.id, step: a.p_step, ordinal: a.p_ordinal, provider: a.p_provider, provider_endpoint: a.p_provider_endpoint, provider_job_id: a.p_provider_job_id, state: 'SUBMITTED', attempts: 1 }); return { ok: true }; }
                if (s.state !== 'SUBMITTED') return { ok: false, code: 'STEP_FINISHED' };
                // A claimed row takes the id without spending an attempt.
                if (s.provider_job_id == null) { s.provider_job_id = a.p_provider_job_id; return { ok: true }; }
                if (s.attempts >= 2) return { ok: false, code: 'ATTEMPTS_EXHAUSTED' };
                Object.assign(s, { provider_job_id: a.p_provider_job_id, attempts: s.attempts + 1 });
                return { ok: true };
            }
            case 'job_step_stored': {
                const s = find(a);
                if (!s) { steps.push({ job_id: job.id, step: a.p_step, ordinal: a.p_ordinal, provider: a.p_provider, state: 'STORED', attempts: 1, output_text: a.p_output_text, output_r2_key: a.p_output_r2_key }); return { ok: true }; }
                if (s.state === 'STORED') return { ok: true, replay: true };
                Object.assign(s, { state: 'STORED', output_r2_key: a.p_output_r2_key, output_text: a.p_output_text });
                return { ok: true };
            }
            case 'job_step_failed': { const s = find(a); if (s && s.state === 'SUBMITTED') s.state = 'FAILED'; return { ok: true }; }
            case 'job_failed':
                if (a.p_provider_job_id !== job.provider_job_id || job.state !== 'SUBMITTED') return { ok: false };
                job.state = 'FAILED';
                job.error_code = a.p_error_code;
                return { ok: true, user_id: job.user_id, credits: job.credits };
            case 'ledger_refund':
                if (!calls.refunds.includes(a.p_job_id)) calls.refunds.push(a.p_job_id);
                assert.equal(a.p_credits, 110);
                return { ok: true };
            case 'job_stored':
                assert.equal(a.p_provider_job_id, parentRef(job.id));
                job.state = 'STORED';
                calls.stored = a;
                return { ok: true };
            default: throw new Error(`unexpected rpc ${name}`);
        }
    };
    const deps = {
        rpc,
        steps: async () => steps.map((s) => ({ ...s })),
        job: async () => ({ ...job }),
        chat: async () => chat,
        submit: async (provider, endpoint, inputs) => {
            calls.submits.push({ provider, endpoint, inputs });
            return submitFails(provider, inputs) ? { ok: false, error: 'boom' } : { ok: true, providerJobId: `p${(n += 1)}` };
        },
        copy: async (url, key, provider, opts) => ({ ok: true, r2Key: key, size: 10, mimeType: opts.expectMp4 ? 'video/mp4' : 'audio/mpeg', sha256: 'ab'.repeat(32) }),
        put: async (key, text, type) => { calls.puts.push({ key, text, type }); return { ok: true }; },
        presign: async (key) => { calls.presigned.push(key); return `https://r2.example/${key}`; },
    };
    const step = (name, ordinal = 0) => ({ ...steps.find((s) => s.step === name && s.ordinal === ordinal) });
    return { job, steps, calls, deps, step };
}

const TIMESTAMPS = [{ characters: [...'Hi there.'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 25.263] }];

test('happy path: script, voice + four scenes, stitch, parent stored, no refund', async () => {
    const w = world();
    assert.deepEqual(await start({ jobId: 'job-1', topic: 'octopuses' }, w.deps), { ok: true });
    assert.equal(w.job.state, 'SUBMITTED');
    assert.equal(w.job.provider, 'veyrnox');
    assert.deepEqual(w.calls.submits.map((s) => s.endpoint).sort(),
        ['fal-ai/elevenlabs/tts/turbo-v2.5', 'veo:veo3_lite', 'veo:veo3_lite', 'veo:veo3_lite', 'veo:veo3_lite']);
    assert.equal(w.calls.submits.find((s) => s.provider === 'fal').inputs.text, NARRATION);
    assert.ok(w.calls.submits.filter((s) => s.provider === 'kie').every((s) => s.inputs.aspect_ratio === '9:16'));

    await onStepOutcome({ step: w.step('voice'), outcome: { state: 'success', outputUrl: 'https://v3b.fal.media/v.mp3', timestamps: TIMESTAMPS } }, w.deps);
    assert.equal(w.step('voice').output_text.voice_ms, 25263);
    assert.match(w.calls.puts[0].text, /^WEBVTT\n\n00:00:00\.000 --> 00:00:25\.263\nHi there\.\n$/);
    for (let i = 0; i < 3; i += 1) {
        await onStepOutcome({ step: w.step('scene', i), outcome: { state: 'success', outputUrl: `https://x.aiquickdraw.com/${i}.mp4` } }, w.deps);
    }
    assert.equal(w.steps.some((s) => s.step === 'stitch'), false, 'stitch waits for the last scene');
    await onStepOutcome({ step: w.step('scene', 3), outcome: { state: 'success', outputUrl: 'https://x.aiquickdraw.com/3.mp4' } }, w.deps);

    const stitch = w.calls.submits.find((s) => s.endpoint === 'fal-ai/ffmpeg-api/compose');
    assert.deepEqual(stitch.inputs.tracks[0].keyframes.map((k) => k.url),
        [0, 1, 2, 3].map((i) => `https://r2.example/auto-short/job-1/scene-${i}.mp4`));
    assert.equal(stitch.inputs.tracks[1].keyframes[0].duration, 25263);

    const done = await onStepOutcome({ step: w.step('stitch'), outcome: { state: 'success', outputUrl: 'https://v3b.fal.media/out.mp4' } }, w.deps);
    assert.deepEqual(done, { ok: true, stored: true });
    assert.equal(w.job.state, 'STORED');
    assert.equal(w.calls.stored.p_r2_key, 'auto-short/job-1/stitch-0.mp4');
    assert.equal(w.calls.stored.p_mime_type, 'video/mp4');
    assert.deepEqual(w.calls.refunds, []);
});

test('a refused script fails the parent and refunds once, with no provider spend', async () => {
    const w = world({ chat: { ok: true, content: '{"refused": true}' } });
    const r = await start({ jobId: 'job-1', topic: 'a famous person' }, w.deps);
    assert.equal(r.error, 'script_refused');
    assert.equal(w.job.state, 'FAILED');
    assert.equal(w.job.error_code, 'script_refused');
    assert.deepEqual(w.calls.refunds, ['job-1']);
    assert.equal(w.calls.submits.length, 0);
});

test('a submit failure at start refunds once', async () => {
    const w = world({ submitFails: (provider) => provider === 'kie' });
    const r = await start({ jobId: 'job-1', topic: 'octopuses' }, w.deps);
    assert.equal(r.failed, true);
    assert.deepEqual(w.calls.refunds, ['job-1']);
});

test('a failed scene is re-submitted once, then fails the parent and refunds once', async () => {
    const w = world();
    await start({ jobId: 'job-1', topic: 'octopuses' }, w.deps);
    const first = await onStepOutcome({ step: w.step('scene', 2), outcome: { state: 'fail', errorCode: 'kie_timeout' } }, w.deps);
    assert.equal(first.retried, true);
    assert.equal(w.step('scene', 2).attempts, 2);
    assert.equal(w.calls.submits.at(-1).inputs.prompt, SCRIPT.scenes[2]);
    await onStepOutcome({ step: w.step('scene', 2), outcome: { state: 'fail', errorCode: 'Vendor <said> no' } }, w.deps);
    assert.equal(w.step('scene', 2).state, 'FAILED');
    assert.equal(w.job.state, 'FAILED');
    assert.equal(w.job.error_code, 'scene_failed');
    // Late results for other steps neither re-submit (spend) nor refund twice.
    const spent = w.calls.submits.length;
    assert.deepEqual(await onStepOutcome({ step: w.step('voice'), outcome: { state: 'fail' } }, w.deps), { ok: true, parentDone: true });
    assert.deepEqual(await onStepOutcome({ step: w.step('scene', 0), outcome: { state: 'success', outputUrl: 'https://x.aiquickdraw.com/0.mp4' } }, w.deps), { ok: true, parentDone: true });
    assert.equal(w.calls.submits.length, spent);
    assert.deepEqual(w.calls.refunds, ['job-1']);
});

test('a failed stitch is retried on freshly signed URLs', async () => {
    const w = world();
    await start({ jobId: 'job-1', topic: 'octopuses' }, w.deps);
    await onStepOutcome({ step: w.step('voice'), outcome: { state: 'success', outputUrl: 'https://v3b.fal.media/v.mp3', timestamps: TIMESTAMPS } }, w.deps);
    for (let i = 0; i < 4; i += 1) await onStepOutcome({ step: w.step('scene', i), outcome: { state: 'success', outputUrl: `https://x.aiquickdraw.com/${i}.mp4` } }, w.deps);
    const signedBefore = w.calls.presigned.length;
    const r = await onStepOutcome({ step: w.step('stitch'), outcome: { state: 'fail' } }, w.deps);
    assert.equal(r.retried, true);
    assert.equal(w.calls.presigned.length, signedBefore + 5);
    assert.equal(w.step('stitch').attempts, 2);
});

test('an outcome for a step that is no longer SUBMITTED is a no-op', async () => {
    const w = world();
    await start({ jobId: 'job-1', topic: 'octopuses' }, w.deps);
    await onStepOutcome({ step: w.step('scene', 0), outcome: { state: 'success', outputUrl: 'https://x.aiquickdraw.com/0.mp4' } }, w.deps);
    const replay = await onStepOutcome({ step: w.step('scene', 0), outcome: { state: 'fail' } }, w.deps);
    assert.deepEqual(replay, { ok: true, replay: true });
    assert.deepEqual(w.calls.refunds, []);
});

test('parseScript accepts a valid script and refuses bad ones', () => {
    assert.deepEqual(parseScript(JSON.stringify(SCRIPT)), { ok: true, script: SCRIPT });
    assert.equal(parseScript('```json\n' + JSON.stringify(SCRIPT) + '\n```').ok, true);
    assert.equal(parseScript('not json').error, 'script_invalid');
    assert.equal(parseScript(JSON.stringify({ ...SCRIPT, scenes: SCRIPT.scenes.slice(0, 3) })).error, 'script_invalid');
    assert.equal(parseScript(JSON.stringify({ ...SCRIPT, narration: 'too short' })).error, 'script_invalid');
    assert.equal(parseScript(JSON.stringify({ refused: true })).error, 'script_refused');
    assert.equal(buildScriptRequest('x').model, 'anthropic/claude-haiku-4.5');
});

test('captions group words into cues of at most six, closing at sentence ends', () => {
    const chars = [...'One two three four five six seven. Eight'];
    const t = chars.map((_, i) => i / 10);
    const vtt = captionsVtt([{ characters: chars, character_start_times_seconds: t, character_end_times_seconds: t.map((x) => x + 0.1) }]);
    assert.deepEqual(vtt.split('\n\n').slice(1).map((c) => c.split('\n')[1].trim()),
        ['One two three four five six', 'seven.', 'Eight']);
});

test('copyUrlToR2 with expectMp4 refuses bytes that are not an MP4', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response(new TextEncoder().encode('<html>not a video</html>'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    try {
        const r = await copyUrlToR2('https://v3b.fal.media/out.mp4', 'k', {}, { expectMp4: true });
        assert.deepEqual(r, { ok: false, error: 'source not mp4' });
    } finally {
        globalThis.fetch = real;
    }
});

test('fal results map to step outcomes: voice audio + timings, compose video_url, failures, pending', async () => {
    const { falOutcome } = await import('../lib/autoShortWebhook.js');
    const voice = { step: 'voice' };
    const stitch = { step: 'stitch' };
    assert.deepEqual(falOutcome(voice, { status: 'OK', payload: { audio: { url: 'https://v3b.fal.media/a.mp3' }, timestamps: [1] } }),
        { state: 'success', outputUrl: 'https://v3b.fal.media/a.mp3', timestamps: [1] });
    assert.deepEqual(falOutcome(stitch, { status: 'OK', payload: { video_url: 'https://v3b.fal.media/o.mp4', thumbnail_url: 'x' } }),
        { state: 'success', outputUrl: 'https://v3b.fal.media/o.mp4' });
    assert.equal(falOutcome(stitch, { status: 'OK', payload: {} }).errorCode, 'no_output');
    // Failure wins over a success status, as for normal jobs.
    assert.equal(falOutcome(voice, { status: 'OK', error: { code: 'x' } }).state, 'fail');
    assert.equal(falOutcome(voice, { status: 'IN_PROGRESS' }).state, 'pending');
});

test('the sellable Auto Short record takes only a topic', async () => {
    const { capabilityFor, publicCapabilities, checkInputs, declaredInputs } = await import('../lib/modelCapabilities.js');
    const record = capabilityFor('auto-short:v1');
    assert.equal(record.provider, 'veyrnox');
    assert.deepEqual(publicCapabilities(record), { kind: 'video', lengths: [5], inputs: { topic: { type: 'string' } }, media: {} });
    assert.deepEqual(declaredInputs(record, { topic: 'octopuses', prompt: 'x', aspect_ratio: '16:9' }), { topic: 'octopuses' });
    assert.equal(checkInputs(record, {}).ok, false);
});
