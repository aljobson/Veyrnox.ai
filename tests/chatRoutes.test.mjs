// ADR-0067: the chat routes end to end through the real route files and the real database client,
// with only the network stubbed.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getModels } from '../app/api/v1/chat/models/route.js';
import { GET as listThreads, POST as createThread } from '../app/api/v1/chat/threads/route.js';
import { GET as getThread, PATCH as patchThread, DELETE as deleteThread } from '../app/api/v1/chat/threads/[id]/route.js';
import { POST as sendMessage } from '../app/api/v1/chat/threads/[id]/messages/route.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const JOB = '22222222-2222-4222-8222-222222222222';
const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_ENABLED', 'OPENROUTER_API_KEY'];
const realFetch = globalThis.fetch;
let calls; let rpcReplies; let catalogRows; let openrouter;

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://db.example.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.CHAT_ENABLED = 'true'; process.env.OPENROUTER_API_KEY = 'sk-test';
    calls = []; catalogRows = []; openrouter = null;
    rpcReplies = { consume_account_read_request: { ok: true } };
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
        calls.push({ url: url.href, body: init.body ? JSON.parse(init.body) : undefined });
        if (url.hostname === 'openrouter.ai') return openrouter();
        const rpcName = /\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname)?.[1];
        if (rpcName) {
            const r = rpcReplies[rpcName];
            if (r instanceof Error) throw r;
            // A name with no scripted reply succeeds; a scripted null is a real null.
            return Response.json(rpcName in rpcReplies ? (typeof r === 'function' ? r(JSON.parse(init.body)) : r) : { ok: true });
        }
        if (url.pathname.endsWith('/model_catalog')) return Response.json(catalogRows);
        throw new Error(`unexpected request ${url.href}`);
    };
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of KEYS) delete process.env[k]; });

const req = (method = 'GET', body, headers = {}) => new Request('https://veyrnox.ai/api/v1/chat/x', {
    method, headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (id = THREAD) => ({ params: Promise.resolve({ id }) });
const rpcCalls = (name) => calls.filter((c) => c.url.endsWith(`/rpc/${name}`));
const ROUTES = [
    ['models', () => getModels(req())], ['list', () => listThreads(req())], ['create', () => createThread(req('POST', { model_id: 'chat-fast' }))],
    ['get', () => getThread(req(), params())], ['patch', () => patchThread(req('PATCH', { title: 'x' }), params())],
    ['delete', () => deleteThread(req('DELETE'), params())], ['send', () => sendMessage(req('POST', { text: 'hi', idempotency_key: 'key-0123456789' }), params())],
];

test('Chat is dark by default: every route says not open and nothing else happens', async () => {
    for (const v of [undefined, 'false', 'TRUE', '1']) {
        if (v === undefined) delete process.env.CHAT_ENABLED; else process.env.CHAT_ENABLED = v;
        for (const [name, go] of ROUTES) {
            const res = await go();
            assert.equal(res.status, 503, `${name} with CHAT_ENABLED=${v}`);
            assert.equal((await res.json()).error, 'chat_not_open');
        }
    }
    assert.equal(calls.length, 0, 'no database or provider call was made');
});

test('every route needs the verified identity header', async () => {
    for (const bad of [undefined, '', 'not-a-uuid', 'DROP TABLE users']) {
        const headers = bad === undefined ? { 'x-veyrnox-auth-id': '' } : { 'x-veyrnox-auth-id': bad };
        assert.equal((await getModels(req('GET', undefined, headers))).status, 401, String(bad));
        assert.equal((await sendMessage(req('POST', { text: 'hi', idempotency_key: 'key-0123456789' }, headers), params())).status, 401);
    }
    assert.equal(calls.length, 0);
});

test('the shared read limit: 429 with a capped Retry-After, and it fails closed', async () => {
    rpcReplies.consume_account_read_request = { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 9999 };
    let res = await listThreads(req());
    assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), '60');
    assert.equal(rpcCalls('chat_list_threads').length, 0);
    rpcReplies.consume_account_read_request = { ok: false, code: 'NOT_FOUND' };
    assert.equal((await listThreads(req())).status, 409);
    rpcReplies.consume_account_read_request = null;
    assert.equal((await listThreads(req())).status, 503);
    rpcReplies.consume_account_read_request = new Error('db down');
    assert.equal((await listThreads(req())).status, 503);
});

test('models: only what a user needs, never cost, endpoint or provider', async () => {
    catalogRows = [{ id: 'chat-fast', name: 'Fast', credits_5s: 2, gated_flag: false, provider_cost_per_unit: 0.0004, provider_endpoint: 'vendor/fast', provider: 'openrouter-chat' }];
    const res = await getModels(req());
    const j = await res.json();
    assert.deepEqual(j, { models: [{ id: 'chat-fast', name: 'Fast', credits_per_reply: 2, gated: false }], max_reply_tokens: 1024 });
    const q = new URL(calls.find((c) => c.url.includes('model_catalog')).url).searchParams;
    assert.equal(q.get('modality'), 'eq.text'); assert.equal(q.get('provider'), 'eq.openrouter-chat'); assert.equal(q.get('active'), 'eq.true');
    assert.ok(!q.get('select').includes('provider_cost') && !q.get('select').includes('endpoint'));
});

test('threads: create validates, maps refusals, and passes the verified auth id', async () => {
    assert.equal((await createThread(req('POST', {}))).status, 400);
    assert.equal((await createThread(req('POST', { model_id: 'Bad Model!' }))).status, 400);
    assert.equal((await createThread(req('POST', [1]))).status, 400);
    assert.equal(rpcCalls('chat_create_thread').length, 0);
    for (const [reply, status, error] of [
        [{ ok: false, code: 'MODEL_NOT_FOUND' }, 404, 'model_not_found'], [{ ok: false, code: 'THREAD_LIMIT' }, 409, 'thread_limit'],
        [{ ok: false, code: 'USER_NOT_FOUND' }, 409, 'user_not_provisioned'], [{ ok: false }, 400, 'request_failed'],
    ]) {
        rpcReplies.chat_create_thread = reply;
        const res = await createThread(req('POST', { model_id: 'chat-fast' }));
        assert.deepEqual([res.status, (await res.json()).error], [status, error]);
    }
    rpcReplies.chat_create_thread = { ok: true, thread: { id: THREAD, title: 'New chat' } };
    const ok = await createThread(req('POST', { model_id: 'chat-fast', user_id: 'someone-else', p_auth_id: 'someone-else' }));
    assert.equal(ok.status, 201);
    assert.deepEqual(rpcCalls('chat_create_thread').at(-1).body, { p_auth_id: AUTH, p_model_id: 'chat-fast' }, 'the owner is the verified header, never the body');
});

test('threads: list, get, patch and delete', async () => {
    rpcReplies.chat_list_threads = { ok: true, threads: [{ id: THREAD }] };
    assert.deepEqual(await (await listThreads(req())).json(), { threads: [{ id: THREAD }] });
    rpcReplies.chat_get_thread = { ok: true, thread: { id: THREAD }, messages: [{ id: 'm' }] };
    assert.deepEqual(await (await getThread(req(), params())).json(), { thread: { id: THREAD }, messages: [{ id: 'm' }] });
    rpcReplies.chat_update_thread = { ok: true, thread: { id: THREAD, title: 'Renamed' } };
    const patched = await patchThread(req('PATCH', { title: ' Renamed ', pinned: true }), params());
    assert.equal(patched.status, 200);
    assert.deepEqual(rpcCalls('chat_update_thread').at(-1).body, { p_auth_id: AUTH, p_thread_id: THREAD, p_title: 'Renamed', p_pinned: true, p_system_prompt: null, p_model_id: null });
    rpcReplies.chat_delete_thread = { ok: true };
    assert.deepEqual(await (await deleteThread(req('DELETE'), params())).json(), { ok: true });
    rpcReplies.chat_get_thread = { ok: false, code: 'THREAD_NOT_FOUND' };
    assert.equal((await getThread(req(), params())).status, 404);
    rpcReplies.chat_delete_thread = { ok: false, code: 'THREAD_NOT_FOUND' };
    assert.equal((await deleteThread(req('DELETE'), params())).status, 404);
});

test('thread routes refuse a bad id, an unknown patch key and a bad body without asking the database', async () => {
    const before = rpcCalls('chat_get_thread').length;
    for (const id of ['not-a-uuid', "x' or 1=1", '../etc']) {
        assert.equal((await getThread(req(), params(id))).status, 404);
        assert.equal((await deleteThread(req('DELETE'), params(id))).status, 404);
    }
    assert.equal(rpcCalls('chat_get_thread').length, before);
    for (const body of [{ user_id: 'x' }, {}, { title: '' }, { pinned: 'yes' }, { model_id: '../x' }, [1]]) {
        assert.equal((await patchThread(req('PATCH', body), params())).status, 400, JSON.stringify(body));
    }
    assert.equal(rpcCalls('chat_update_thread').length, 0);
    const garbage = new Request('https://veyrnox.ai/x', { method: 'PATCH', headers: { 'x-veyrnox-auth-id': AUTH }, body: '{nope' });
    assert.equal((await patchThread(garbage, params())).status, 400);
});

test('a request body over the repo-wide limit is refused before it is parsed', async () => {
    const huge = { text: 'x'.repeat(70 * 1024), idempotency_key: 'key-0123456789' };
    const res = await sendMessage(req('POST', huge, { 'content-length': String(JSON.stringify(huge).length) }), params());
    assert.equal(res.status, 413);
    assert.equal(rpcCalls('ledger_debit').length, 0);
});

test('send: a full streamed turn through the route, debited from the catalog and saved once', async () => {
    catalogRows = [{ id: 'chat-fast', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', modality: 'text', credits_5s: 3, gated_flag: false, active: true }];
    rpcReplies.check_generation_rate_limit = { ok: true };
    rpcReplies.chat_turn_context = { ok: true, user_id: 'user-1', model_id: 'chat-fast', system_prompt: '', history: [] };
    rpcReplies.ledger_debit = { ok: true, job_id: JOB, balance_after: 7 };
    rpcReplies.job_submitted = { ok: true };
    rpcReplies.chat_complete_turn = { ok: true, message_id: 'msg-1', refund: false };
    rpcReplies.read_user_credits = { balance: 7 };
    const frame = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
    openrouter = () => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(frame('Hel'))); c.enqueue(e.encode(frame('lo'))); c.enqueue(e.encode('data: [DONE]\n\n')); c.close(); } }));

    const res = await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789', credits: 0 }), params());
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await res.text();
    assert.deepEqual([...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]), ['start', 'delta', 'delta', 'done']);
    assert.ok(text.includes('"credits_charged":3'));
    assert.equal(rpcCalls('ledger_debit')[0].body.p_credits, 3);
    assert.deepEqual(rpcCalls('chat_complete_turn')[0].body, { p_job_id: JOB, p_thread_id: THREAD, p_user_text: 'Hi', p_reply: 'Hello', p_status: 'complete' });
    assert.equal(rpcCalls('ledger_refund').length, 0);
    const or = calls.find((c) => c.url.includes('openrouter.ai'));
    assert.equal(or.url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(or.body.model, 'vendor/fast'); assert.equal(or.body.max_tokens, 1024);
});

test('send: a refusal before the stream is plain JSON with the right status', async () => {
    rpcReplies.check_generation_rate_limit = { ok: true };
    rpcReplies.chat_turn_context = { ok: false, code: 'THREAD_NOT_FOUND' };
    assert.equal((await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789' }), params())).status, 404);
    assert.equal((await sendMessage(req('POST', { text: '', idempotency_key: 'key-0123456789' }), params())).status, 400);
    assert.equal((await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789' }), params('bad'))).status, 404);
    assert.equal(rpcCalls('ledger_debit').length, 0);
});
