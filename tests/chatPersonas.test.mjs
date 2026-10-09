import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personasEnabled, validatePersona, MAX_SYSTEM_PROMPT } from '../lib/chat.js';
import { GET as listPersonas, POST as createPersona } from '../app/api/v1/chat/personas/route.js';
import { PATCH as patchPersona, DELETE as deletePersona } from '../app/api/v1/chat/personas/[id]/route.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const PID = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const realFetch = globalThis.fetch;
let calls; let replies;
beforeEach(() => {
    process.env.SUPABASE_URL = 'https://db.example.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.CHAT_ENABLED = 'true';
    calls = []; replies = { consume_account_read_request: { ok: true } };
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
        const name = /\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname)?.[1];
        if (!name) throw new Error(`unexpected request ${url.href}`);
        calls.push({ name, body: init.body ? JSON.parse(init.body) : undefined });
        const r = replies[name];
        if (r instanceof Error) throw r;
        return Response.json(name in replies ? r : { ok: true });
    };
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_ENABLED', 'PERSONAS_ENABLED']) delete process.env[k]; });
const on = () => { process.env.PERSONAS_ENABLED = 'true'; };
const req = (method = 'GET', body, headers = {}) => new Request('https://veyrnox.ai/api/v1/chat/personas', {
    method, headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (id = PID) => ({ params: Promise.resolve({ id }) });
const dbCalls = (name) => calls.filter((c) => c.name === name);
const good = { name: 'Editor', instructions: 'Tighten my writing.', model_id: 'chat-fast', thinking: true, web: false };

test('the switch is off unless the flag is exactly "true"', () => {
    assert.equal(personasEnabled({ PERSONAS_ENABLED: 'true' }), true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', true]) assert.equal(personasEnabled({ PERSONAS_ENABLED: v }), false, String(v));
    assert.equal(personasEnabled(undefined), false);
});

test('validatePersona trims, defaults, and refuses what is wrong with a specific code', () => {
    assert.deepEqual(validatePersona({ name: '  Editor ', instructions: ' Be brief. ' }), { ok: true, persona: { name: 'Editor', instructions: 'Be brief.', model_id: null, thinking: false, web: false } });
    assert.deepEqual(validatePersona(good).persona, good);
    assert.equal(validatePersona({ name: 'x'.repeat(60), instructions: 'y'.repeat(MAX_SYSTEM_PROMPT) }).ok, true, 'the limits themselves are allowed');
    const bad = (b, error) => assert.deepEqual(validatePersona(b), { ok: false, error }, JSON.stringify(b).slice(0, 60));
    bad(null, 'invalid_body'); bad([], 'invalid_body'); bad('x', 'invalid_body');
    bad({ ...good, extra: 1 }, 'invalid_body');
    bad({ ...good, name: '' }, 'invalid_persona_name'); bad({ ...good, name: '   ' }, 'invalid_persona_name'); bad({ ...good, name: 'x'.repeat(61) }, 'invalid_persona_name'); bad({ ...good, name: 5 }, 'invalid_persona_name');
    bad({ ...good, instructions: '' }, 'invalid_instructions'); bad({ ...good, instructions: 'x'.repeat(MAX_SYSTEM_PROMPT + 1) }, 'invalid_instructions');
    bad({ ...good, model_id: 'Bad Model!' }, 'invalid_model'); bad({ ...good, model_id: 7 }, 'invalid_model'); bad({ ...good, model_id: '../x' }, 'invalid_model');
    bad({ ...good, thinking: 'yes' }, 'invalid_options'); bad({ ...good, web: 1 }, 'invalid_options');
});

test('flag off: the list is a normal "off" answer with no database work, and every change is not available', async () => {
    const list = await listPersonas(req());
    assert.deepEqual(await list.json(), { enabled: false, personas: [] });
    assert.equal(dbCalls('chat_list_personas').length, 0);
    for (const res of [await createPersona(req('POST', good)), await patchPersona(req('PATCH', good), params()), await deletePersona(req('DELETE'), params())]) {
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'personas_unavailable' });
    }
    assert.equal(calls.filter((c) => c.name.includes('persona')).length, 0);
});

test('signed out and chat closed are refused before anything else', async () => {
    on();
    assert.equal((await listPersonas(req('GET', undefined, { 'x-veyrnox-auth-id': 'nope' }))).status, 401);
    process.env.CHAT_ENABLED = 'false';
    assert.equal((await listPersonas(req())).status, 503);
});

test('flag on: list, create, change and delete go through the definer functions keyed by the verified id', async () => {
    on();
    replies.chat_list_personas = { ok: true, personas: [{ id: PID, name: 'Editor' }] };
    assert.deepEqual(await (await listPersonas(req())).json(), { enabled: true, personas: [{ id: PID, name: 'Editor' }] });
    assert.equal(dbCalls('chat_list_personas')[0].body.p_auth_id, AUTH);

    replies.chat_save_persona = { ok: true, persona: { id: PID, ...good } };
    const made = await createPersona(req('POST', good));
    assert.equal(made.status, 201);
    assert.deepEqual(dbCalls('chat_save_persona')[0].body, { p_auth_id: AUTH, p_persona_id: null, p_name: 'Editor', p_instructions: 'Tighten my writing.', p_model_id: 'chat-fast', p_thinking: true, p_web: false });

    const changed = await patchPersona(req('PATCH', { ...good, name: 'Editor 2' }), params());
    assert.equal(changed.status, 200);
    assert.equal(dbCalls('chat_save_persona')[1].body.p_persona_id, PID);
    assert.equal(dbCalls('chat_save_persona')[1].body.p_name, 'Editor 2');

    const gone = await deletePersona(req('DELETE'), params());
    assert.deepEqual(await gone.json(), { ok: true });
    assert.deepEqual(dbCalls('chat_delete_persona')[0].body, { p_auth_id: AUTH, p_persona_id: PID });
});

test('flag on: bad input never reaches the database, a bad id is not found, and refusals map to statuses', async () => {
    on();
    for (const body of [{ ...good, name: '' }, { ...good, extra: 1 }, { ...good, instructions: 'x'.repeat(5000) }, 'x']) {
        const res = await createPersona(req('POST', body));
        assert.equal(res.status, 400);
    }
    assert.equal(dbCalls('chat_save_persona').length, 0);
    assert.equal((await patchPersona(req('PATCH', good), params('not-a-uuid'))).status, 404);
    assert.equal((await deletePersona(req('DELETE'), params('not-a-uuid'))).status, 404);
    for (const [code, status, error] of [['PERSONA_LIMIT', 409, 'persona_limit'], ['PERSONA_EXISTS', 409, 'persona_exists'], ['PERSONA_NOT_FOUND', 404, 'persona_not_found'], ['MODEL_NOT_FOUND', 404, 'model_not_found']]) {
        replies.chat_save_persona = { ok: false, code };
        const res = await createPersona(req('POST', good));
        assert.equal(res.status, status, code);
        assert.deepEqual(await res.json(), { error }, code);
    }
    replies.chat_save_persona = new Error('db down');
    const errors = console.error; console.error = () => {};
    try { assert.equal((await createPersona(req('POST', good))).status, 503); } finally { console.error = errors; }
});

test('the screen: personas fill the draft of a new chat and never touch one that exists', () => {
    const ws = src('../app/veyrnox/_components/chat/ChatWorkspace.js');
    const panel = src('../app/veyrnox/_components/chat/SettingsPanel.js');
    // Selecting only fills local draft state; it never calls the API to change a thread.
    const pick = ws.slice(ws.indexOf('const pickPersona'), ws.indexOf('const changePersonas'));
    assert.match(pick, /setInstr\(p\.instructions\)/);
    assert.match(pick, /setOpts\(\{ thinking: p\.thinking, web: p\.web, research: false \}\)/);
    assert.doesNotMatch(pick, /chatApi\./, 'choosing a persona never calls the server');
    // The picker is off for an existing chat, and the section appears only when the feature answered "on".
    assert.match(panel, /disabled=\{busy \|\| hasThread\}/);
    assert.match(panel, /\{personasOn && \(/);
    assert.match(ws, /if \(r && r\.enabled\) \{ setPersonasOn\(true\)/);
    assert.match(ws, /setPersonaId\(''\); setActive\(r\.thread\)/);
});
