// ADR-0067: the chat routes end to end through the real route files and the real database client,
// with only the network stubbed.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getModels } from '../app/api/v1/chat/models/route.js';
import { GET as listThreads, POST as createThread } from '../app/api/v1/chat/threads/route.js';
import { GET as getThread, PATCH as patchThread, DELETE as deleteThread } from '../app/api/v1/chat/threads/[id]/route.js';
import { POST as sendMessage } from '../app/api/v1/chat/threads/[id]/messages/route.js';
import { GET as listFolders, POST as createFolder } from '../app/api/v1/chat/folders/route.js';
import { PATCH as patchFolder, DELETE as deleteFolder } from '../app/api/v1/chat/folders/[id]/route.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const JOB = '22222222-2222-4222-8222-222222222222';
const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_ENABLED', 'OPENROUTER_API_KEY', 'EXA_API_KEY'];
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
    ['delete', () => deleteThread(req('DELETE'), params())],
    ['folders', () => listFolders(req())], ['new folder', () => createFolder(req('POST', { name: 'Work' }))],
    ['rename folder', () => patchFolder(req('PATCH', { name: 'Work' }), params())], ['delete folder', () => deleteFolder(req('DELETE'), params())], ['send', () => sendMessage(req('POST', { text: 'hi', idempotency_key: 'key-0123456789' }), params())],
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
    assert.deepEqual(j, { models: [{ id: 'chat-fast', name: 'Fast', maker: 'other', maker_label: 'Other', credits_per_reply: 2, gated: false, max_reply_tokens: 1024, options: { thinking: null, web: null, images: null } }], max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048 });
    const q = new URL(calls.find((c) => c.url.includes('model_catalog')).url).searchParams;
    assert.equal(q.get('modality'), 'eq.text'); assert.equal(q.get('provider'), 'eq.openrouter-chat'); assert.equal(q.get('active'), 'eq.true');
    // The endpoint is read only to name the model family; it never reaches the response, and neither does the cost.
    assert.ok(!q.get('select').includes('provider_cost'));
    assert.ok(!JSON.stringify(j).includes('vendor/fast') && !JSON.stringify(j).includes('0.0004'));
});

test('models: a row with its own reply cap reports it; reasoning effort is never exposed', async () => {
    catalogRows = [{ id: 'chat-deep', name: 'Deep', credits_5s: 4, gated_flag: false, provider: 'openrouter-chat', chat_max_reply_tokens: 4096, chat_reasoning_effort: 'low' }];
    const j = await (await getModels(req())).json();
    assert.deepEqual(j.models, [{ id: 'chat-deep', name: 'Deep', maker: 'other', maker_label: 'Other', credits_per_reply: 4, gated: false, max_reply_tokens: 4096, options: { thinking: null, web: null, images: null } }]);
    assert.ok(!JSON.stringify(j).includes('reasoning'));
    const q = new URL(calls.find((c) => c.url.includes('model_catalog')).url).searchParams;
    assert.match(q.get('select'), /chat_max_reply_tokens/);
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

test('send: the turn is handed to the Worker, so it is saved and charged with nobody reading the reply', async (t) => {
    const symbol = Symbol.for('__cloudflare-context__'), before = globalThis[symbol], kept = [];
    globalThis[symbol] = { env: {}, ctx: { waitUntil(work) { kept.push(work); } } };
    t.after(() => { if (before === undefined) delete globalThis[symbol]; else globalThis[symbol] = before; });
    catalogRows = [{ id: 'chat-fast', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', modality: 'text', credits_5s: 3, gated_flag: false, active: true }];
    rpcReplies.check_generation_rate_limit = { ok: true };
    rpcReplies.chat_turn_context = { ok: true, user_id: 'user-1', model_id: 'chat-fast', system_prompt: '', history: [] };
    rpcReplies.ledger_debit = { ok: true, job_id: JOB, balance_after: 7 };
    rpcReplies.job_submitted = { ok: true };
    rpcReplies.chat_complete_turn = { ok: true, message_id: 'msg-1', refund: false };
    const frame = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    openrouter = () => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(frame('Hello'))); c.enqueue(e.encode('data: [DONE]\n\n')); c.close(); } }));

    const res = await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789' }), params());
    assert.equal(res.status, 200);
    assert.equal(kept.length, 1, 'the whole turn, once');
    await kept[0]; // the reply is never read
    assert.equal(rpcCalls('chat_complete_turn')[0].body.p_status, 'complete');
    assert.equal(rpcCalls('ledger_refund').length, 0);
});

test('send: a refusal before the stream is plain JSON with the right status', async () => {
    rpcReplies.check_generation_rate_limit = { ok: true };
    rpcReplies.chat_turn_context = { ok: false, code: 'THREAD_NOT_FOUND' };
    assert.equal((await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789' }), params())).status, 404);
    assert.equal((await sendMessage(req('POST', { text: '', idempotency_key: 'key-0123456789' }), params())).status, 400);
    assert.equal((await sendMessage(req('POST', { text: 'Hi', idempotency_key: 'key-0123456789' }), params('bad'))).status, 404);
    assert.equal(rpcCalls('ledger_debit').length, 0);
});

test('models: the options a row offers are reported with their extra Credits; effort and caps stay private', async () => {
    catalogRows = [{ id: 'chat-deep', name: 'Deep', credits_5s: 4, gated_flag: false, provider: 'openrouter-chat', chat_max_reply_tokens: 4096, chat_reasoning_effort: 'low',
        chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192, chat_thinking_extra_credits: 3, chat_web_extra_credits: 2, chat_images_extra_credits: 1 }];
    const j = await (await getModels(req())).json();
    assert.deepEqual(j.models[0].options, { thinking: { extra_credits: 3 }, web: { extra_credits: 2 }, images: { extra_credits: 1 } });
    assert.ok(!JSON.stringify(j).includes('effort') && !JSON.stringify(j).includes('8192'));
    const q = new URL(calls.find((c) => c.url.includes('model_catalog')).url).searchParams;
    assert.match(q.get('select'), /chat_thinking_extra_credits/); assert.match(q.get('select'), /chat_web_extra_credits/); assert.match(q.get('select'), /chat_images_extra_credits/);
});

test('folders: list, create, rename and delete go through the definer functions with the verified identity', async () => {
    const FOLDER = '4a3b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
    rpcReplies.chat_list_folders = { ok: true, folders: [{ id: FOLDER, name: 'Work', count: 2 }] };
    let res = await listFolders(req());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { folders: [{ id: FOLDER, name: 'Work', count: 2 }] });
    assert.deepEqual(rpcCalls('chat_list_folders')[0].body, { p_auth_id: AUTH });

    rpcReplies.chat_create_folder = { ok: true, folder: { id: FOLDER, name: 'Work', count: 0 } };
    res = await createFolder(req('POST', { name: '  Work ' }));
    assert.equal(res.status, 201);
    assert.deepEqual(rpcCalls('chat_create_folder')[0].body, { p_auth_id: AUTH, p_name: 'Work' }, 'trimmed before it is sent');

    rpcReplies.chat_rename_folder = { ok: true, folder: { id: FOLDER, name: 'Clients', count: 2 } };
    res = await patchFolder(req('PATCH', { name: 'Clients' }), params(FOLDER));
    assert.equal(res.status, 200);
    assert.deepEqual(rpcCalls('chat_rename_folder')[0].body, { p_auth_id: AUTH, p_folder_id: FOLDER, p_name: 'Clients' });

    res = await deleteFolder(req('DELETE'), params(FOLDER));
    assert.equal(res.status, 200);
    assert.deepEqual(rpcCalls('chat_delete_folder')[0].body, { p_auth_id: AUTH, p_folder_id: FOLDER });
});

test('folders: bad input never reaches the database', async () => {
    const FOLDER = '4a3b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
    for (const [body, error] of [
        [{}, 'invalid_name'], [{ name: '' }, 'invalid_name'], [{ name: '   ' }, 'invalid_name'], [{ name: 'x'.repeat(61) }, 'invalid_name'], [{ name: 5 }, 'invalid_name'],
        [{ name: 'ok', owner: 'x' }, 'invalid_body'], [null, 'invalid_body'], [[], 'invalid_body'], ['text', 'invalid_body'],
    ]) {
        const res = await createFolder(req('POST', body));
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(await res.json(), { error }, JSON.stringify(body));
    }
    assert.equal((await patchFolder(req('PATCH', { name: '' }), params(FOLDER))).status, 400);
    assert.equal((await patchFolder(req('PATCH', { name: 'ok' }), params('not-a-uuid'))).status, 404);
    assert.equal((await deleteFolder(req('DELETE'), params('not-a-uuid'))).status, 404);
    assert.equal(rpcCalls('chat_create_folder').length + rpcCalls('chat_rename_folder').length + rpcCalls('chat_delete_folder').length, 0);
});

test('folders: the database refusals read as clear errors and never leak detail', async () => {
    const FOLDER = '4a3b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
    for (const [code, status, error] of [['FOLDER_EXISTS', 409, 'folder_exists'], ['FOLDER_LIMIT', 409, 'folder_limit'], ['FOLDER_NOT_FOUND', 404, 'folder_not_found']]) {
        rpcReplies.chat_create_folder = { ok: false, code, detail: 'secret internals' };
        const res = await createFolder(req('POST', { name: 'Work' }));
        assert.equal(res.status, status, code);
        assert.deepEqual(await res.json(), { error }, code);
    }
    rpcReplies.chat_delete_folder = { ok: false, code: 'FOLDER_NOT_FOUND' };
    assert.equal((await deleteFolder(req('DELETE'), params(FOLDER))).status, 404);
    rpcReplies.chat_list_folders = new Error('db exploded: password=hunter2');
    const res = await listFolders(req());
    assert.equal(res.status, 503);
    assert.ok(!JSON.stringify(await res.json()).includes('hunter2'));
});

test('moving a chat: PATCH folder_id calls chat_move_thread, and nothing else is changed', async () => {
    const FOLDER = '4a3b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
    rpcReplies.chat_move_thread = { ok: true };
    let res = await patchThread(req('PATCH', { folder_id: FOLDER }), params());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, folder_id: FOLDER });
    assert.deepEqual(rpcCalls('chat_move_thread')[0].body, { p_auth_id: AUTH, p_thread_id: THREAD, p_folder_id: FOLDER });
    assert.equal(rpcCalls('chat_update_thread').length, 0, 'a move does not touch title, pin or instructions');

    res = await patchThread(req('PATCH', { folder_id: null }), params());
    assert.equal(res.status, 200);
    assert.deepEqual(rpcCalls('chat_move_thread')[1].body, { p_auth_id: AUTH, p_thread_id: THREAD, p_folder_id: null });

    rpcReplies.chat_move_thread = { ok: false, code: 'FOLDER_NOT_FOUND' };
    assert.equal((await patchThread(req('PATCH', { folder_id: FOLDER }), params())).status, 404);
    assert.equal((await patchThread(req('PATCH', { folder_id: 'nope' }), params())).status, 400);
    assert.equal((await patchThread(req('PATCH', { folder_id: FOLDER, title: 'x' }), params())).status, 400);
});

test('models: each row names its maker from the endpoint, and the endpoint itself never leaves the server', async () => {
    catalogRows = [
        { id: 'chat-a', name: 'Claude Sonnet 5.5', provider_endpoint: 'anthropic/claude-sonnet-5.5', credits_5s: 4, gated_flag: false },
        { id: 'chat-b', name: 'DeepSeek V4.1 Flash', provider_endpoint: 'deepseek/deepseek-v4.1-flash', credits_5s: 1, gated_flag: false },
        { id: 'chat-c', name: 'Mystery', provider_endpoint: 'newlab/model-1', credits_5s: 1, gated_flag: false },
    ];
    const res = await getModels(req());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.models.map((m) => [m.id, m.maker, m.maker_label]), [['chat-a', 'claude', 'Claude'], ['chat-b', 'deepseek', 'DeepSeek'], ['chat-c', 'other', 'Other']]);
    const text = JSON.stringify(body);
    for (const leak of ['anthropic/', 'deepseek/', 'newlab/', 'provider_endpoint', 'openrouter']) assert.ok(!text.includes(leak), leak);
});

test('models: a capped row offers Web search only while a search key is set, and a plugin row always does', async () => {
    catalogRows = [
        { id: 'chat-cap', name: 'Capped', provider_endpoint: 'vendor/cap', credits_5s: 1, gated_flag: false, chat_web_extra_credits: 2, chat_web_engine: 'capped' },
        { id: 'chat-plug', name: 'Plugin', provider_endpoint: 'vendor/plug', credits_5s: 1, gated_flag: false, chat_web_extra_credits: 4, chat_web_engine: 'plugin' },
    ];
    const web = async () => Object.fromEntries((await (await getModels(req())).json()).models.map((m) => [m.id, m.options.web]));
    assert.deepEqual(await web(), { 'chat-cap': null, 'chat-plug': { extra_credits: 4 } }, 'no key: the capped row hides Web search');
    process.env.EXA_API_KEY = 'exa-test';
    assert.deepEqual(await web(), { 'chat-cap': { extra_credits: 2 }, 'chat-plug': { extra_credits: 4 } }, 'with the key it is offered at its own price');
    const q = new URL(calls.find((c) => c.url.includes('model_catalog')).url).searchParams;
    assert.match(q.get('select'), /chat_web_engine/);
});

test('models: before the engine column exists in the database, the list still loads and Web search reads as the plugin', async () => {
    catalogRows = [{ id: 'chat-a', name: 'A', provider_endpoint: 'vendor/a', credits_5s: 1, gated_flag: false, chat_web_extra_credits: 2 }];
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const u = new URL(typeof input === 'string' ? input : input.url ?? input.href);
        if (u.pathname.endsWith('/model_catalog') && (u.searchParams.get('select') || '').includes('chat_web_engine')) {
            return new Response('{"code":"42703","message":"column model_catalog.chat_web_engine does not exist"}', { status: 400 });
        }
        return inner(input, init);
    };
    const res = await getModels(req());
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).models[0].options.web, { extra_credits: 2 });
});
