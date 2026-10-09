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
// Auto Short is our own pipeline: its provider entry wants every runtime key and R2.
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_KEY: 'test-fal', KIE_API_KEY: 'test-kie', OPENROUTER_API_KEY: 'test-or', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'veyrnox-test',
});
const { POST } = await import('../app/api/v1/generations/route.js');

// An Auto Short is written about whatever is in the Topic box. The box started
// with the video starter prompt, so Generate there bought a 110-Credit short
// about a tracking shot (follow-up to #735 and #739, which did this for speech,
// music and sound effects: tests/speechPrompt.test.mjs, tests/audioPrompt.test.mjs).
const ROW = { id: 'auto-short-32s', provider: 'veyrnox', provider_endpoint: 'auto-short:v1', modality: 'text-to-video', credits_5s: 110, gated_flag: false, active: true };
const TOPIC_PLACEHOLDER = 'A topic for a 32-second short, e.g. 3 facts about octopuses';

// The shape app/veyrnox/_lib/useCatalog.js hands the page for the live row.
const capabilities = publicCapabilities(capabilityFor(ROW.provider_endpoint));
const short = { id: ROW.id, kind: kindOf(ROW.modality), isSpeech: capabilities.kind === 'speech', takesTopic: !!capabilities.inputs?.topic };

const video = { id: 'wan-2.5-kie', kind: 'video', isSpeech: false, takesTopic: false };
const image = { id: 'nano-banana', kind: 'image', isSpeech: false, takesTopic: false };

test('an Auto Short starts with an empty Topic box; pictures and clips keep the starter', () => {
    assert.deepEqual(short, { id: 'auto-short-32s', kind: 'video', isSpeech: false, takesTopic: true });
    assert.equal(promptText(null, short), '');
    for (const model of [video, image, null]) assert.equal(promptText(null, model), STARTER_PROMPT);
});

test('a typed topic is never cleared or replaced', () => {
    assert.equal(promptText('3 facts about octopuses', short), '3 facts about octopuses');
    // A box the person emptied stays empty.
    assert.equal(promptText('', short), '');
    // The starter's own words, typed or handed over, are the person's.
    assert.equal(promptText(STARTER_PROMPT, short), STARTER_PROMPT);
    // Text typed on another model is still there on Auto Short, and the other way round.
    assert.equal(promptText('A lighthouse at dusk, slow pan', short), promptText('A lighthouse at dusk, slow pan', video));
});

test('a draft handed to Auto Short is what the Topic box shows', () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
    assert.equal(writeStudioDraft(storage, { prompt: 'Why cats purr', model: ROW.id }), true);
    // What the create page does on mount: `if (draft) setPrompt(draft.prompt)`.
    const typed = takeStudioDraft(storage, ROW.id)?.prompt ?? null;
    assert.equal(promptText(typed, short), 'Why cats purr');
    assert.equal(promptIsMissing(short, promptText(typed, short)), false);
});

test('Generate waits for a topic on an Auto Short; pictures and clips are left to the gateway', () => {
    for (const empty of ['', '   ', '\n\t ', null, undefined]) {
        assert.equal(promptIsMissing(short, empty), true, JSON.stringify(empty));
        for (const model of [video, image, null]) assert.equal(promptIsMissing(model, empty), false);
    }
    assert.equal(promptIsMissing(short, '3 facts about octopuses'), false);
    // The untouched box is the empty one, so Generate is off until a topic is typed.
    assert.equal(promptIsMissing(short, promptText(null, short)), true);
    assert.equal(promptIsMissing(video, promptText(null, video)), false);
});

test('the Topic box keeps its own placeholder', () => {
    assert.equal(promptPlaceholder(short), TOPIC_PLACEHOLDER);
    for (const model of [video, image, null]) assert.equal(promptPlaceholder(model), 'Describe the shot…');
});

// The page's rule is the gateway's: every record that takes a topic requires
// it, so an empty box is a request the page knows will be refused.
test('every capability record that takes a topic refuses an empty one', () => {
    const records = Object.entries(REGISTRY).filter(([, r]) => r.inputs.topic);
    assert.deepEqual(records.map(([endpoint]) => endpoint), ['auto-short:v1'], 'Auto Short is the one topic record');
    for (const [endpoint, record] of records) {
        assert.equal(record.inputs.topic.required, true, endpoint);
        assert.equal(record.inputs.prompt, undefined, `${endpoint} takes no prompt beside its topic`);
        for (const topic of ['', '   ']) {
            assert.deepEqual(checkInputs(record, { topic }), { ok: false, error: 'inputs_invalid:topic' }, endpoint);
        }
        assert.deepEqual(checkInputs(record, { topic: '3 facts about octopuses' }), { ok: true }, endpoint);
    }
});

test('the gateway refuses an empty topic before any debit', async (t) => {
    const calls = [];
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (url) => {
        const u = new URL(String(url));
        calls.push(u.pathname);
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([ROW]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: '11111111-1111-4111-8111-111111111111' }]);
        if (u.pathname.includes('/rpc/') && !u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    });
    for (const topic of ['', '   ']) {
        // What the create page sent for an emptied Topic box: the topic and nothing else.
        const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
            method: 'POST', headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'content-type': 'application/json' },
            body: JSON.stringify({ model_id: ROW.id, idempotency_key: 'short-empty-topic', inputs: { topic } }),
        }));
        assert.deepEqual([response.status, await response.json()], [400, { error: 'inputs_invalid:topic' }], JSON.stringify(topic));
    }
    assert.ok(calls.includes('/rest/v1/model_catalog'), 'the request reached the catalog read');
    assert.equal(calls.some((p) => p.endsWith('/rpc/ledger_debit')), false, 'no debit');
});

// JSX page and a React hook, so these read the source, like speechPrompt.test.mjs.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('an Auto Short is known by its capability from the catalog row, and the fallback list has none', () => {
    const helper = read('../app/veyrnox/_lib/promptBox.js');
    assert.match(helper, /model\?\.takesTopic/);
    assert.doesNotMatch(helper, /auto-short/);
    assert.match(read('../app/veyrnox/_lib/useCatalog.js'), /takesTopic: !!m\.capabilities\?\.inputs\?\.topic,/);
    // With /api/catalog unreachable the picker is tokens.js, which lists no Auto Short: no mark is needed there.
    assert.deepEqual(MODELS.filter((m) => m.takesTopic || /short/i.test(`${m.id} ${m.name}`)), []);
    // The catalog row is the one the migrations insert.
    assert.match(read('../packages/db/schema/supabase/0093_auto_short_catalog_row.sql'), /\('auto-short-32s', 'Auto Short \(32s\)', 'veyrnox', 'auto-short:v1', 'text-to-video', 110,/);
});

test('the create page sends the Topic box as the topic, and waits for one', () => {
    const page = read('../app/veyrnox/app/create/page.js');
    assert.match(page, /const prompt = promptText\(typed, model\);/);
    assert.match(page, /const missingPrompt = promptIsMissing\(model, prompt\);/);
    assert.match(page, /const inputs = isShort \? \{ topic: prompt\.trim\(\) \} :/);
    assert.match(page, /disabled=\{[^\n]*\|\| missingPrompt[^\n]*\}/);
    assert.doesNotMatch(page, /neon-lit/);
});
