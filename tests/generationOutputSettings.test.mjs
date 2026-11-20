import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DEFAULT_TTS_SETTINGS, ttsGenerationInputs } from '../app/veyrnox/_lib/textToSpeech.js';
import { dialogueCastInputs } from '../app/veyrnox/_lib/dialogueCastMap.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', OPENROUTER_API_KEY: 'test-key',
    PUBLIC_HOST: 'https://veyrnox.test', FREE_ALLOWANCE_ENABLED: 'false',
    FAL_KEY: 'test-fal', FAL_DURABLE_DISPATCH_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const model = { id: 'seedance-2.0-fast', provider: 'openrouter', provider_endpoint: 'bytedance/seedance-2.0-fast',
    modality: 'text-to-video', credits_5s: 28, active: true, gated_flag: false };

function network(t, row = model, { submit = () => Response.json({ id: 'provider-job' }, { status: 202 }), submitted = { ok: true } } = {}) {
    const calls = []; let debited = false;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const u = new URL(String(url));
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ path: u.pathname, body });
        if (u.pathname.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([row]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname.endsWith('/rpc/ledger_debit')) {
            const replay = debited; debited = true;
            return Response.json({ ok: true, job_id: JOB, idempotent: replay, balance_after: 100 });
        }
        if (u.pathname.endsWith('/rpc/job_submitted')) {
            if (submitted instanceof Error) throw submitted;
            return Response.json(submitted);
        }
        if (u.pathname === '/api/v1/videos') return submit();
        if (u.hostname === 'queue.fal.run') return Response.json({ request_id: 'provider-job' });
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        assert.fail(`Unexpected request: ${u.pathname}`);
    });
    return calls;
}

function request(inputs, modelId = model.id) {
    return new Request('https://veyrnox.test/api/v1/generations', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
        body: JSON.stringify({ model_id: modelId, idempotency_key: 'output-settings-test', inputs: { prompt: 'Waves on the beach', ...inputs } }),
    });
}

test('resolution and audio choices are stored, charged at catalog price, and submitted exactly', async (t) => {
    const calls = network(t);
    const response = await POST(request({ duration_seconds: 10, output_resolution: '480p', audio_enabled: false }));
    assert.equal(response.status, 200);
    const debit = calls.find((call) => call.path.endsWith('/rpc/ledger_debit')).body;
    assert.equal(debit.p_credits, 56);
    assert.equal(debit.p_inputs.output_resolution, '480p');
    assert.equal(debit.p_inputs.audio_enabled, false);
    const submitted = calls.find((call) => call.path === '/api/v1/videos').body;
    assert.equal(submitted.resolution, '480p');
    assert.equal(submitted.generate_audio, false);
    assert.equal(submitted.duration, 10);
});

test('ambiguous OpenRouter video submit keeps the debit and a replay never resubmits', async (t) => {
    t.mock.method(console, 'error', () => {});
    const calls = network(t, model, { submit: () => { throw new Error('connection reset'); } });
    const response = await POST(request({ duration_seconds: 5 }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'outcome_unknown', job_id: JOB });
    assert.equal(calls.filter((call) => call.path.endsWith('/rpc/ledger_refund')).length, 0);
    assert.equal(calls.find((call) => call.path.endsWith('/rpc/job_submit_rejected')).body.p_error_code, 'provider_outcome_unknown');
    assert.equal((await POST(request({ duration_seconds: 5 }))).status, 200);
    assert.equal(calls.filter((call) => call.path === '/api/v1/videos').length, 1);
});

test('a paused generation permits recovery of an owned job but creates no new job', async t => {
    t.mock.method(globalThis[Symbol.for('veyrnox.runtimeSwitchCache.v1')],'cachedKilled',()=>true);
    const calls=[];
    let existing=true;
    t.mock.method(globalThis,'fetch',async(url,init={})=>{
        const path=new URL(String(url)).pathname;calls.push(path);
        if(path.endsWith('/users'))return Response.json([{id:AUTH}]);
        if(path.endsWith('/jobs'))return Response.json(existing?[{id:JOB}]:[]);
        if(path.endsWith('/model_catalog'))return Response.json([model]);
        if(path.endsWith('/rpc/ledger_debit')){
            assert.equal(JSON.parse(init.body).p_idempotency_key,'output-settings-test');
            return Response.json({ok:true,job_id:JOB,idempotent:true,balance_after:100});
        }
        if(path.endsWith('/rpc/check_generation_rate_limit'))return Response.json({ok:true});
        assert.fail('Unexpected provider or mutation call: '+path);
    });
    const replay=await POST(request({duration_seconds:5}));
    assert.equal(replay.status,200);assert.equal((await replay.json()).job_id,JOB);
    assert.equal(calls.filter(p=>p.endsWith('/rpc/ledger_debit')).length,1,'normal idempotent recovery RPC');
    existing=false;calls.length=0;
    const fresh=await POST(request({duration_seconds:5}));
    assert.equal(fresh.status,503);assert.equal((await fresh.json()).error,'feature_paused');
    assert.deepEqual(calls,['/rest/v1/users','/rest/v1/jobs']);
});

test('1080p and malformed audio are refused before any lookup or charge', async (t) => {
    const calls = network(t);
    for (const inputs of [{ output_resolution: '1080p' }, { audio_enabled: 'false' }]) {
        assert.equal((await POST(request(inputs))).status, 400);
    }
    assert.equal(calls.length, 0);
});

test('models without output choices refuse them before signing sources or debiting', async (t) => {
    const calls = network(t, { ...model, provider_endpoint: 'fal-ai/veo3.1/fast', provider: 'fal' });
    for (const inputs of [{ output_resolution: '720p' }, { audio_enabled: false }]) {
        const response = await POST(request(inputs));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /^inputs_key_not_allowed:/);
    }
    assert.equal(calls.some((call) => call.path.endsWith('/rpc/ledger_debit')), false);
    assert.equal(calls.some((call) => call.path === '/api/v1/videos'), false);
});

const speechModel = { id: 'minimax-speech-2.6-hd', provider: 'fal', provider_endpoint: 'fal-ai/minimax/speech-2.6-hd',
    modality: 'text-to-speech', credits_5s: 6, active: true, gated_flag: false };
const dialogueModel = { ...speechModel, id: 'elevenlabs-dialogue', provider_endpoint: 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3' };

for (const row of [
    { ...speechModel, id: 'flux-2-pro', provider_endpoint: 'fal-ai/flux-2-pro', modality: 'text-to-image' },
    { ...speechModel, id: 'elevenlabs-turbo', provider_endpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5' },
    dialogueModel,
]) {
    test(`${row.id} refuses every TTS control before debit, free admission or provider submission`, async t => {
        const before = process.env.FREE_ALLOWANCE_ENABLED;
        process.env.FREE_ALLOWANCE_ENABLED = 'true';
        t.after(() => { process.env.FREE_ALLOWANCE_ENABLED = before; });
        const calls = network(t, { ...row, free_allowance_per_day: 3 });
        for (const [key, value] of Object.entries(ttsGenerationInputs(DEFAULT_TTS_SETTINGS))) {
            calls.length = 0;
            const response = await POST(request({ [key]: value }, row.id));
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: `inputs_key_not_allowed:${key}` });
            assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/check_generation_rate_limit', '/rest/v1/model_catalog']);
        }
    });
}

for (const row of [speechModel, { ...dialogueModel, provider: 'kie', provider_endpoint: 'market:elevenlabs/text-to-dialogue-v3' }]) {
    test(`${row.provider_endpoint} refuses all cast controls before any admission or submission`, async t => {
        const calls = network(t, row);
        for (let index = 1; index <= 4; index++) {
            calls.length = 0;
            const key = `dialogue_voice_${index}`;
            const response = await POST(request({ [key]: 'Sarah' }, row.id));
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: `inputs_key_not_allowed:${key}` });
            assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/check_generation_rate_limit', '/rest/v1/model_catalog']);
        }
    });
}

test('invalid TTS speed returns its typed error before any RPC or lookup', async t => {
    const calls = network(t, speechModel);
    const response = await POST(request({ tts_speed: 2.01 }, speechModel.id));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'inputs_invalid:tts_speed' });
    assert.deepEqual(calls, []);
});

test('the complete web TTS payload is stored, priced at six credits and forwarded to MiniMax', async t => {
    const calls = network(t, speechModel);
    const inputs = { prompt: 'Hello there', ...ttsGenerationInputs(DEFAULT_TTS_SETTINGS) };
    const response = await POST(request(inputs, speechModel.id));
    assert.equal(response.status, 200);
    const debit = calls.find(call => call.path.endsWith('/rpc/ledger_debit')).body;
    assert.equal(debit.p_credits, 6);
    assert.deepEqual(debit.p_inputs, inputs);
    assert.deepEqual(calls.find(call => call.path === `/${speechModel.provider_endpoint}`).body, {
        prompt: 'Hello there', output_format: 'url', language_boost: 'auto',
        voice_setting: { voice_id: 'Wise_Woman', speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
    });
});

test('the dialogue web cast reaches fal and invalid cast orders stop before debit', async t => {
    const calls = network(t, dialogueModel);
    for (const cast of [
        { dialogue_voice_1: 'George', dialogue_voice_2: 'George' },
        { dialogue_voice_2: 'Sarah' },
    ]) {
        calls.length = 0;
        const response = await POST(request({ prompt: 'Ana: Hi', ...cast }, dialogueModel.id));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'dialogue_invalid' });
        assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/check_generation_rate_limit', '/rest/v1/model_catalog']);
    }
    const inputs = { prompt: 'Ana: Hello\nBen: Hi', ...dialogueCastInputs([{ voice: 'Sarah' }, { voice: 'George' }]) };
    assert.equal((await POST(request(inputs, dialogueModel.id))).status, 200);
    assert.deepEqual(calls.find(call => call.path.endsWith('/rpc/ledger_debit')).body.p_inputs, inputs);
    assert.deepEqual(calls.find(call => call.path === `/${dialogueModel.provider_endpoint}`).body, {
        inputs: [{ text: 'Hello', voice: 'Sarah' }, { text: 'Hi', voice: 'George' }],
    });
});
