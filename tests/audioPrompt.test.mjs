import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { STARTER_PROMPT, promptText, promptIsMissing, promptPlaceholder } from '../app/veyrnox/_lib/promptBox.js';
import { MODELS, kindOf } from '../app/veyrnox/_lib/tokens.js';
import { takeStudioDraft, writeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { REGISTRY, capabilityFor, checkInputs, publicCapabilities } from '../lib/modelCapabilities.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test',
});
const { POST } = await import('../app/api/v1/generations/route.js');

// A music or sound-effect model makes audio about whatever is in the prompt
// box. The box started with a video prompt for every model, so Generate there
// bought 1 to 3 Credits of audio about a tracking shot (follow-up to #735,
// which did the same for speech: tests/speechPrompt.test.mjs).
const LIVE_SOUND = {
    'ace-step': 'fal-ai/ace-step',
    'ace-step-1.5': 'fal-ai/ace-step-1.5',
    'elevenlabs-sfx-v2': 'fal-ai/elevenlabs/sound-effects/v2',
    'mmaudio-v2': 'fal-ai/mmaudio-v2/text-to-audio',
};
const SOUND_PLACEHOLDER = 'Describe the sound or music…';

// The two shapes app/veyrnox/_lib/useCatalog.js hands the page: from
// /api/catalog (modality and capability record) and from tokens.js.
const live = (id) => ({ id, kind: kindOf('text-to-audio'), isSpeech: publicCapabilities(capabilityFor(LIVE_SOUND[id])).kind === 'speech' });
const fallback = (id) => {
    const m = MODELS.find((row) => row.id === id);
    return { id, kind: m.kind, isSpeech: !!m.speech };
};
const sounds = Object.keys(LIVE_SOUND).flatMap((id) => [live(id), fallback(id)]);

const video = { id: 'wan-2.5-kie', kind: 'video', isSpeech: false };
const image = { id: 'nano-banana', kind: 'image', isSpeech: false };
const autoShort = { id: 'auto-short', kind: 'video', isSpeech: false, takesTopic: true };
const speech = { id: 'inworld-tts', kind: 'audio', isSpeech: true };
const dialogue = { id: 'elevenlabs-dialogue', kind: 'audio', isSpeech: true };

test('a music or sound-effect model starts with an empty box; pictures and clips keep the starter', () => {
    assert.equal(sounds.length, 8);
    for (const model of sounds) assert.equal(promptText(null, model), '', model.id);
    for (const model of [video, image, autoShort, null]) assert.equal(promptText(null, model), STARTER_PROMPT);
});

test('what the person typed is never cleared or replaced on a sound model', () => {
    for (const model of sounds) {
        assert.equal(promptText('Rain on a tin roof', model), 'Rain on a tin roof');
        // A box the person emptied stays empty.
        assert.equal(promptText('', model), '');
        // The starter's own words, typed or handed over, are the person's.
        assert.equal(promptText(STARTER_PROMPT, model), STARTER_PROMPT);
    }
});

test('a draft handed to a sound model is what the box shows', () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
    for (const id of Object.keys(LIVE_SOUND)) {
        assert.equal(writeStudioDraft(storage, { prompt: 'Slow lo-fi piano, vinyl crackle', model: id }), true);
        // What the create page does on mount: `if (draft) setPrompt(draft.prompt)`.
        const typed = takeStudioDraft(storage, id)?.prompt ?? null;
        for (const model of [live(id), fallback(id)]) {
            assert.equal(promptText(typed, model), 'Slow lo-fi piano, vinyl crackle');
            assert.equal(promptIsMissing(model, promptText(typed, model)), false);
        }
    }
});

test('Generate waits for a description on a sound model; pictures and clips are left to the gateway', () => {
    for (const empty of ['', '   ', '\n\t ', null, undefined]) {
        for (const model of sounds) assert.equal(promptIsMissing(model, empty), true, `${model.id} ${JSON.stringify(empty)}`);
        for (const model of [video, image, autoShort, null]) assert.equal(promptIsMissing(model, empty), false);
    }
    for (const model of sounds) {
        assert.equal(promptIsMissing(model, 'Rain on a tin roof'), false);
        // The untouched box is the empty one, so Generate is off until a description is typed.
        assert.equal(promptIsMissing(model, promptText(null, model)), true);
    }
    assert.equal(promptIsMissing(video, promptText(null, video)), false);
});

test('a sound model says what the box is for; every other placeholder is unchanged', () => {
    for (const model of sounds) assert.equal(promptPlaceholder(model), SOUND_PLACEHOLDER, model.id);
    for (const model of [video, image, null]) assert.equal(promptPlaceholder(model), 'Describe the shot…');
    assert.equal(promptPlaceholder(speech), 'Type the words to say…');
    assert.equal(promptPlaceholder(dialogue), 'One line per speaker, e.g.\nAna: Did you hear that?\nBen: [whispers] Stay quiet.');
    assert.equal(promptPlaceholder(autoShort), 'A topic for a 32-second short, e.g. 3 facts about octopuses');
});

// The page's rule is the gateway's: every audio record requires its prompt,
// so an empty box is a request the page knows will be refused.
test('every audio capability record refuses an empty prompt', () => {
    const records = Object.entries(REGISTRY).filter(([, r]) => r.kind === 'audio');
    assert.deepEqual(records.map(([endpoint]) => endpoint).sort(), Object.values(LIVE_SOUND).sort(), 'the audio records are the four sound models');
    for (const [endpoint, record] of records) {
        assert.equal(record.inputs.prompt?.required, true, endpoint);
        assert.equal(publicCapabilities(record).kind, 'audio', endpoint);
        for (const prompt of ['', '   ']) {
            assert.deepEqual(checkInputs(record, { prompt }), { ok: false, error: 'inputs_invalid:prompt' }, endpoint);
        }
        assert.deepEqual(checkInputs(record, { prompt: 'Rain on a tin roof' }), { ok: true }, endpoint);
    }
});

test('the gateway refuses an empty prompt on each live sound model before any debit', async (t) => {
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
    for (const [id, endpoint] of Object.entries(LIVE_SOUND)) {
        row = { id, provider: 'fal', provider_endpoint: endpoint, modality: 'text-to-audio', credits_5s: 1, gated_flag: false, active: true };
        for (const prompt of ['', '   ']) {
            // What the create page sent for an emptied box, aspect ratio and all.
            const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
                method: 'POST', headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'content-type': 'application/json' },
                body: JSON.stringify({ model_id: id, idempotency_key: 'sound-empty-prompt', inputs: { prompt, aspect_ratio: '16:9' } }),
            }));
            assert.deepEqual([response.status, await response.json()], [400, { error: 'inputs_invalid:prompt' }], id);
        }
    }
    assert.equal(calls.some((p) => p.endsWith('/rpc/ledger_debit')), false, 'no debit');
});

test('the tokens.js fallback gives a sound model the marks the live catalog does', () => {
    // With /api/catalog unreachable the picker is this list. A sound row needs
    // nothing beyond `kind: 'audio'` and no speech mark.
    for (const id of Object.keys(LIVE_SOUND)) {
        assert.deepEqual(fallback(id), { id, kind: 'audio', isSpeech: false });
        assert.deepEqual(fallback(id), live(id));
    }
    const fallbackSounds = MODELS.filter((m) => m.kind === 'audio' && !m.speech).map((m) => m.id);
    assert.deepEqual(fallbackSounds.sort(), Object.keys(LIVE_SOUND).sort(), 'every sound row in the fallback is checked');
    // No picture or clip row in the fallback loses its starter.
    for (const m of MODELS.filter((row) => row.kind !== 'audio')) {
        assert.equal(promptText(null, { id: m.id, kind: m.kind, isSpeech: !!m.speech }), STARTER_PROMPT, m.id);
    }
});

// JSX page and a React hook, so these read the source, like speechPrompt.test.mjs.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a sound model is known by its kind from the catalog row, not by a list of ids', () => {
    const helper = read('../app/veyrnox/_lib/promptBox.js');
    assert.match(helper, /model\?\.kind === 'audio'/);
    assert.doesNotMatch(helper, /ace-step|mmaudio|sfx|sound-effects/);
    // Both catalog paths set the kind the helper reads.
    const catalog = read('../app/veyrnox/_lib/useCatalog.js');
    assert.match(catalog, /id: m\.id, name: m\.name, kind: m\.kind,/);
    assert.match(catalog, /id: m\.id, name: m\.name, kind: kindOf\(m\.modality\),/);
    // The wording lives in the helper; the page only asks for it.
    const page = read('../app/veyrnox/app/create/page.js');
    assert.match(page, /placeholder=\{promptPlaceholder\(model\)\}/);
    assert.doesNotMatch(page, /Describe the sound/);
});
