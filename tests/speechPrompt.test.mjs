import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { STARTER_PROMPT, promptText, promptIsMissing, promptPlaceholder } from '../app/veyrnox/_lib/promptBox.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { REGISTRY, capabilityFor, checkInputs, publicCapabilities } from '../lib/modelCapabilities.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test',
});
const { POST } = await import('../app/api/v1/generations/route.js');

// A speech model reads the prompt box aloud and charges for it. The box used
// to start with a video prompt for every model, so Generate on a speech model
// bought audio of a shot description (review of #731, 2026-10-09).
const video = { id: 'wan-2.5-kie', kind: 'video' };
const music = { id: 'ace-step', kind: 'audio' };
const speech = { id: 'inworld-tts', kind: 'audio', isSpeech: true };
const dialogue = { id: 'elevenlabs-dialogue', kind: 'audio', isSpeech: true };

test('the starter prompt is offered to picture and clip models, never to an audio model', () => {
    assert.equal(STARTER_PROMPT, 'A neon-lit Tokyo alley at 3am, low anamorphic tracking shot');
    assert.equal(promptText(null, video), STARTER_PROMPT);
    assert.equal(promptText(null, null), STARTER_PROMPT, 'first paint, before a model is known');
    assert.equal(promptText(null, speech), '');
    assert.equal(promptText(null, dialogue), '');
    // Music and sound effects make audio about the box: no starter there either (tests/audioPrompt.test.mjs).
    assert.equal(promptText(null, music), '');
});

test('what the user typed, or a restored draft, is kept on every model', () => {
    for (const model of [video, music, speech, dialogue, null]) {
        assert.equal(promptText('Welcome aboard.', model), 'Welcome aboard.');
        // A box the user emptied stays empty: nothing is put back over it.
        assert.equal(promptText('', model), '');
        // The same words as the starter, typed or handed over, are the user's own.
        assert.equal(promptText(STARTER_PROMPT, model), STARTER_PROMPT);
    }
});

test('Generate waits for words on a speech model; picture and clip models are left to the gateway', () => {
    for (const empty of ['', '   ', '\n\t ', null, undefined]) {
        assert.equal(promptIsMissing(speech, empty), true, JSON.stringify(empty));
        assert.equal(promptIsMissing(dialogue, empty), true);
        assert.equal(promptIsMissing(video, empty), false);
        assert.equal(promptIsMissing(music, empty), true);
        assert.equal(promptIsMissing(null, empty), false);
    }
    assert.equal(promptIsMissing(speech, 'Welcome aboard.'), false);
});

test('a speech model says what the box is for; dialogue and Auto Short keep their own lines', () => {
    assert.equal(promptPlaceholder(speech), 'Type the words to say…');
    assert.equal(promptPlaceholder(dialogue), 'One line per speaker, e.g.\nAna: Did you hear that?\nBen: [whispers] Stay quiet.');
    assert.equal(promptPlaceholder({ id: 'auto-short', kind: 'video', takesTopic: true }), 'A topic for a 32-second short, e.g. 3 facts about octopuses');
    for (const model of [video, null]) assert.equal(promptPlaceholder(model), 'Describe the shot…');
    assert.equal(promptPlaceholder(music), 'Describe the sound or music…');
});

// The page's rule is the gateway's: every speech record requires its prompt,
// so an empty box is a request the page knows will be refused.
test('every speech capability record refuses an empty prompt', () => {
    const records = Object.entries(REGISTRY).filter(([, r]) => r.kind === 'speech');
    assert.ok(records.length >= 4, 'speech records found');
    for (const [endpoint, record] of records) {
        assert.equal(record.inputs.prompt?.required, true, endpoint);
        assert.equal(publicCapabilities(record).kind, 'speech', endpoint);
        const others = Object.fromEntries(Object.entries(record.inputs)
            .filter(([key, rule]) => key !== 'prompt' && rule.required).map(([key]) => [key, 'x']));
        for (const prompt of ['', '   ']) {
            assert.deepEqual(checkInputs(record, { ...others, prompt }), { ok: false, error: 'inputs_invalid:prompt' }, endpoint);
        }
    }
});

const LIVE_SPEECH = {
    'inworld-tts': 'fal-ai/inworld-tts',
    'elevenlabs-tts-turbo': 'fal-ai/elevenlabs/tts/turbo-v2.5',
    'minimax-speech-2.6-hd': 'fal-ai/minimax/speech-2.6-hd',
    'elevenlabs-dialogue': 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3',
};

test('the gateway refuses an empty prompt on each live speech model before any debit', async (t) => {
    const calls = [];
    let row = null;
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (url) => {
        const u = new URL(String(url));
        calls.push(u.pathname);
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([row]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: '11111111-1111-4111-8111-111111111111' }]);
        if (u.pathname.includes('/rpc/') && !u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    });
    for (const [id, endpoint] of Object.entries(LIVE_SPEECH)) {
        row = { id, provider: 'fal', provider_endpoint: endpoint, modality: 'text-to-speech', credits_5s: 2, gated_flag: false, active: true };
        for (const prompt of ['', '   ']) {
            // What the create page sent for an emptied box, aspect ratio and all.
            const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
                method: 'POST', headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'content-type': 'application/json' },
                body: JSON.stringify({ model_id: id, idempotency_key: 'speech-empty-prompt', inputs: { prompt, aspect_ratio: '16:9' } }),
            }));
            assert.deepEqual([response.status, await response.json()], [400, { error: 'inputs_invalid:prompt' }], id);
        }
    }
    assert.equal(calls.some((p) => p.endsWith('/rpc/ledger_debit')), false, 'no debit');
});

test('the tokens.js fallback marks the same models as speech that the capability registry does', () => {
    // With /api/catalog unreachable the picker is this list; a speech row
    // without the mark would get the starter prompt back.
    const endpointById = {
        ...LIVE_SPEECH,
        'ace-step': 'fal-ai/ace-step', 'ace-step-1.5': 'fal-ai/ace-step-1.5',
        'elevenlabs-sfx-v2': 'fal-ai/elevenlabs/sound-effects/v2', 'mmaudio-v2': 'fal-ai/mmaudio-v2/text-to-audio',
    };
    const audio = MODELS.filter((m) => m.kind === 'audio');
    assert.deepEqual(audio.map((m) => m.id).sort(), Object.keys(endpointById).sort(), 'every audio row in the fallback is checked');
    for (const m of audio) {
        const record = capabilityFor(endpointById[m.id]);
        assert.ok(record, `${m.id} has a capability record`);
        assert.equal(!!m.speech, record.kind === 'speech', `${m.id} fallback speech mark`);
        // A row with no speech mark is music or sound effects: the box starts empty there too.
        assert.equal(!m.speech, record.kind === 'audio', `${m.id} fallback kind`);
    }
    assert.deepEqual(MODELS.filter((m) => m.speech && m.kind !== 'audio'), []);
});

// JSX page and a React hook, so these read the source, like createAutoShort.test.mjs.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../app/veyrnox/app/create/page.js');
const catalog = read('../app/veyrnox/_lib/useCatalog.js');

test('the catalog marks speech by its capability record, not by a list of ids', () => {
    assert.match(catalog, /isSpeech: m\.capabilities\?\.kind === 'speech',/);
    assert.match(catalog, /isSpeech: !!m\.speech,/);
    assert.doesNotMatch(catalog, /inworld|elevenlabs|minimax|qwen/);
});

test('the create page keeps the starter out of state, so a speech model cannot send it', () => {
    // null until the user types or a draft arrives; the starter is derived per model.
    assert.match(page, /const \[typed, setPrompt\] = useState\(null\);/);
    assert.match(page, /const prompt = promptText\(typed, model\);/);
    assert.doesNotMatch(page, /neon-lit/);
    assert.equal((page.match(/\bsetPrompt\(/g) || []).length, 2, 'only typing and a restored draft set the text');
    assert.match(page, /if \(draft\) setPrompt\(draft\.prompt\);/);
    assert.match(page, /value=\{prompt\}\s*onChange=\{\(e\) => setPrompt\(e\.target\.value\)\}/);
    assert.match(page, /placeholder=\{promptPlaceholder\(model\)\}/);
});

test('the create page does not send a speech request with no words', () => {
    assert.match(page, /const missingPrompt = promptIsMissing\(model, prompt\);/);
    assert.match(page, /disabled=\{[^\n]*\|\| missingPrompt[^\n]*\}/);
    const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
    const guard = submit.indexOf("if (missingPrompt) { inFlight.current = false; setError({ code: 'inputs_invalid:prompt' }); return; }");
    assert.ok(guard > 0, 'guard found');
    assert.ok(guard < submit.indexOf('makeIdempotencyKey()'), 'before a key is minted');
    assert.ok(guard < submit.indexOf("gatewayFetch('/generations'"), 'before the request');
    assert.match(read('../app/veyrnox/_lib/createErrors.js'), /'inputs_invalid:prompt':/);
});
