import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test',
});
const { POST } = await import('../app/api/v1/generations/route.js');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../packages/db/schema/supabase/0235_qwen_voice_design_staged.sql');
const ENDPOINT = 'fal-ai/qwen-3-tts/voice-design/1.7b';
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const row = { id: 'qwen-3-tts-voice-design', provider: 'fal', provider_endpoint: ENDPOINT, modality: 'text-to-speech', credits_5s: 6, gated_flag: false };

test('0235 stages one row, inactive, and changes no other', () => {
    const rows = sql.split('\n').filter((l) => /^\s+\('/.test(l));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /^\s+\('qwen-3-tts-voice-design', '[^']+', 'fal', 'fal-ai\/qwen-3-tts\/voice-design\/1\.7b', 'text-to-speech', 6, 0\.0900, 'per_generation', NULL, false, false\)$/);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING;/);
    assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(UPDATE|DELETE)\b/);
});

test('6 credits is the least that clears both pricing rules at $0.09', () => {
    // ADR-0014: half of a $0.033 credit. ADR-0037: half the $129/3000 pack price after an 8% + $0.30 payment fee.
    assert.equal(Math.ceil(0.09 / 0.0165), 6);
    assert.equal(Math.ceil(0.09 / (0.043 * (1 - 0.08 - 0.50) - 0.30 / 3000)), 6);
});

// The real gateway and fal adapter; the network is simulated.
function network(t, { active = true, model = row } = {}) {
    const calls = [];
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const u = new URL(String(url));
        calls.push({ url: u.href, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        if (u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 94 });
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([{ ...model, active }]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'queue.fal.run') return Response.json({ request_id: 'fal-request-1' });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    });
    return calls;
}
const post = (inputs, modelId = row.id) => POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, idempotency_key: 'qwen-voice-test', inputs }),
}));
const debits = (calls) => calls.filter((c) => c.url.includes('/rpc/ledger_debit'));
const submits = (calls) => calls.filter((c) => c.url.startsWith('https://queue.fal.run/'));

test('once active: 6 credits buy one clip, and fal gets the words, the voice and the pins', async (t) => {
    const calls = network(t);
    // What the create page sends for every model, plus things a client must not control.
    const response = await post({ prompt: 'Welcome aboard.', voice_description: 'A warm, unhurried woman in her fifties', aspect_ratio: '16:9' });
    assert.equal(response.status, 200);
    assert.equal(debits(calls).length, 1);
    assert.equal(debits(calls)[0].body.p_credits, 6);
    assert.deepEqual(debits(calls)[0].body.p_inputs, { prompt: 'Welcome aboard.', voice_description: 'A warm, unhurried woman in her fifties' });
    assert.equal(submits(calls).length, 1);
    assert.equal(new URL(submits(calls)[0].url).pathname, `/${ENDPOINT}`);
    assert.deepEqual(submits(calls)[0].body, {
        text: 'Welcome aboard.', prompt: 'A warm, unhurried woman in her fifties',
        language: 'Auto', max_new_tokens: 8192, enable_safety_checker: true,
    });
});

test('a missing or over-long voice description is refused before any debit', async (t) => {
    const calls = network(t);
    for (const inputs of [
        { prompt: 'Welcome aboard.' },
        { prompt: 'Welcome aboard.', voice_description: '   ' },
        { prompt: 'Welcome aboard.', voice_description: 'v'.repeat(501) },
    ]) {
        const response = await post(inputs);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'inputs_invalid:voice_description' });
    }
    // A pin is not a client input, and nor is a recording to copy: the gateway has no such keys.
    assert.equal((await post({ prompt: 'p', voice_description: 'v', max_new_tokens: 1 })).status, 400);
    const recording = await post({ prompt: 'p', voice_description: 'v', audio_url: 'https://example.com/voice.mp3' });
    assert.deepEqual([recording.status, await recording.json()], [400, { error: 'inputs_key_not_allowed:audio_url' }]);
    assert.equal(debits(calls).length, 0);
    assert.equal(submits(calls).length, 0);
});

test('a voice description sent to a speech model that takes none goes no further than the gateway', async (t) => {
    const turbo = { id: 'elevenlabs-tts-turbo', provider: 'fal', provider_endpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5', modality: 'text-to-speech', credits_5s: 4, gated_flag: false };
    const calls = network(t, { model: turbo });
    assert.equal((await post({ prompt: 'Welcome aboard.', voice_description: 'A warm woman' }, turbo.id)).status, 200);
    assert.deepEqual(debits(calls)[0].body.p_inputs, { prompt: 'Welcome aboard.' });
    assert.deepEqual(submits(calls)[0].body, { text: 'Welcome aboard.', timestamps: false });
});

test('as staged (inactive) the model cannot be bought', async (t) => {
    const calls = network(t, { active: false });
    const response = await post({ prompt: 'Welcome aboard.', voice_description: 'A warm woman' });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'model_not_found' });
    assert.equal(debits(calls).length, 0);
    assert.equal(submits(calls).length, 0);
});

// JSX, so these read the source, like createAutoShort.test.mjs.
test('the create page asks for the voice when the catalog says the model takes one', () => {
    const page = read('../app/veyrnox/app/create/page.js');
    assert.match(read('../app/veyrnox/_lib/useCatalog.js'), /takesVoice: !!m\.capabilities\?\.inputs\?\.voice_description/);
    assert.match(page, /\{model\?\.takesVoice && <VoiceDescription value=\{voice\} onChange=\{setVoice\} \/>\}/);
    assert.match(page, /\.\.\.settingsInputs\(model, \{ seed, negative, voice \}\)/);
    // Generate stays off until the voice is described, as it does for a missing upload.
    assert.match(page, /const missingVoice = voiceIsMissing\(model, voice\);/);
    assert.match(page, /disabled=\{[^\n]*\|\| missingVoice[^\n]*\}/);
    assert.match(page, /if \(missingVoice\) \{ inFlight\.current = false; setError\(\{ code: 'inputs_invalid:voice_description' \}\); return; \}/);
    assert.match(read('../app/veyrnox/_components/VoiceDescription.js'), /maxLength=\{VOICE_MAX\}/);
    assert.match(read('../app/veyrnox/_lib/createErrors.js'), /'inputs_invalid:voice_description':/);
});
