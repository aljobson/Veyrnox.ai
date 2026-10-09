// POST /api/v1/chat/sends/close (ADR-0067 amendment 11), through the real route file and the real database client
// with only the network stubbed, and the chat turn's answer to a send that was closed.
// The browser makes a send's idempotency key before any request, so it has the key even when Stop came before
// `start` and no job id ever reached it. This route is how it asks about such a send: the database answers with the
// job that send made, or, when it made none, closes the key in the same step (chat_close_send, migration 0242) so
// that no chat reply can be charged for it afterwards. `closed: true` is that statement and nothing else is.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { POST as closeSend } from '../app/api/v1/chat/sends/close/route.js';
import { runChatTurn } from '../lib/chatTurn.js';
import { SupabaseError } from '../packages/db/supabase-client.js';

// The job read imports `next/server`, which plain Node resolves only with its extension (as tests/jobReadLimit.test.mjs does).
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET: getJob } = await import('../app/api/v1/jobs/[id]/route.js');

const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const KEY = 'vx-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_ENABLED', 'CHAT_SEND_CLOSE_ENABLED'];
const realFetch = globalThis.fetch;
const realError = console.error;
let calls; let reply; let logged;

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://db.example.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.CHAT_ENABLED = 'true'; process.env.CHAT_SEND_CLOSE_ENABLED = 'true';
    calls = []; reply = { ok: true, closed: true }; logged = [];
    console.error = (...args) => { logged.push(args.join(' ')); };
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
        const name = /\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname)?.[1];
        if (!name) throw new Error(`unexpected request ${url.href}`);
        calls.push([name, JSON.parse(init.body)]);
        if (reply instanceof Error) throw reply;
        if (reply instanceof Response) return reply;
        return Response.json(reply);
    };
});
afterEach(() => { globalThis.fetch = realFetch; console.error = realError; for (const k of ENV) delete process.env[k]; });

const req = (body = { idempotency_key: KEY }, headers = {}) => new Request('https://veyrnox.ai/api/v1/chat/sends/close', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const answer = async (r) => { reply = r; const res = await closeSend(req()); return [res.status, await res.json()]; };
const found = (state, extra = {}) => ({ ok: true, closed: false, job_id: JOB, state, credits: 2, model_id: 'chat-fast', error_code: null, ...extra });

test('dark unless Chat is open and this route is switched on, and then nothing is asked of the database', async () => {
    for (const v of [undefined, 'false', 'TRUE', '1']) {
        if (v === undefined) delete process.env.CHAT_ENABLED; else process.env.CHAT_ENABLED = v;
        const res = await closeSend(req());
        assert.deepEqual([res.status, await res.json()], [503, { error: 'chat_not_open' }], `CHAT_ENABLED=${v}`);
    }
    process.env.CHAT_ENABLED = 'true';
    // Its own switch, off until migration 0242 is applied: the browser reads this as no answer and its warning stays.
    for (const v of [undefined, 'false', 'TRUE', '1', '']) {
        if (v === undefined) delete process.env.CHAT_SEND_CLOSE_ENABLED; else process.env.CHAT_SEND_CLOSE_ENABLED = v;
        const res = await closeSend(req());
        assert.deepEqual([res.status, await res.json()], [503, { error: 'send_close_not_open' }], `CHAT_SEND_CLOSE_ENABLED=${v}`);
    }
    assert.equal(calls.length, 0);
    // Who is calling is settled first: without an identity the answer is 401 whether the switch is on or off.
    delete process.env.CHAT_SEND_CLOSE_ENABLED;
    assert.equal((await closeSend(req(undefined, { 'x-veyrnox-auth-id': '' }))).status, 401);
});

test('the browser asks this route, with the key under the name it reads', () => {
    const api = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');
    const route = readFileSync(new URL('../app/api/v1/chat/sends/close/route.js', import.meta.url), 'utf8');
    // gatewayFetch puts /api/v1 in front: the path is this route file's own, and the body field is the one it takes the key from.
    assert.match(api, /\n {2}closeSend: \(key\) => gatewayFetch\('\/chat\/sends\/close', \{ method: 'POST', body: json\(\{ idempotency_key: key \}\) \}\),\n/);
    assert.match(route, /const key = body && typeof body === 'object' \? body\.idempotency_key : undefined;/);
    assert.match(route, /rpc\('chat_close_send', \{ p_auth_id: gate\.authId, p_idempotency_key: key \}, gate\.cfg\)/);
});

test('it needs the verified identity header, and a key in the one shape the browser makes', async () => {
    for (const bad of ['', 'not-a-uuid', 'DROP TABLE users']) {
        const res = await closeSend(req(undefined, { 'x-veyrnox-auth-id': bad }));
        assert.deepEqual([res.status, await res.json()], [401, { error: 'not_authenticated' }], bad);
    }
    const badKeys = [undefined, null, '', 'key-0123456789', KEY.slice(3), KEY.toUpperCase(), `${KEY}0`, ` ${KEY}`, `${KEY}\n`, `../${KEY}`, `vx-${'f'.repeat(36)}`, 42, [KEY], { key: KEY }, JOB];
    for (const key of badKeys) {
        const res = await closeSend(req({ idempotency_key: key }));
        assert.deepEqual([res.status, await res.json()], [400, { error: 'invalid_key' }], JSON.stringify(key));
    }
    // The key is the only thing read from the body, by its one name.
    assert.equal((await closeSend(req({ key: KEY }))).status, 400);
    for (const body of ['', '{', 'null', '[]', '"x"', '42']) {
        const res = await closeSend(req(body));
        assert.equal(res.status, 400, body);
        assert.match((await res.json()).error, /^invalid_(body|key)$/, body);
    }
    const big = await closeSend(req({ idempotency_key: KEY, pad: 'x'.repeat(70 * 1024) }));
    assert.equal(big.status, 413, 'the repo-wide body limit');
    assert.equal(calls.length, 0, 'none of these reached the database');
});

test('the database is asked once, for the verified caller and that key, and its statement is passed on', async () => {
    const res = await closeSend(req());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { closed: true });
    // The caller comes from the middleware's header, never from the body: a key asked about is looked for among that
    // person's own sends only, and closing it closes it for that person only.
    await closeSend(req({ idempotency_key: KEY, user_id: 'someone-else', p_auth_id: 'someone-else', auth_id: 'someone-else' }));
    assert.deepEqual(calls, [['chat_close_send', { p_auth_id: AUTH, p_idempotency_key: KEY }], ['chat_close_send', { p_auth_id: AUTH, p_idempotency_key: KEY }]]);
    assert.deepEqual(logged, []);
});

test('a send that made a job is answered with that job, in the words of the job read, and nothing of the provider', async () => {
    const states = [['PRICED', 'queued', false], ['DEBITED', 'queued', false], ['FAILOVER', 'queued', false], ['SUBMITTED', 'running', false], ['SUCCEEDED', 'running', false],
        ['STORED', 'succeeded', false], ['FAILED', 'failed', false], ['REFUNDED', 'failed', true]];
    for (const [db, state, refunded] of states) {
        assert.deepEqual(await answer(found(db, { provider: 'openrouter-chat', provider_job_id: JOB, created_at: 'x', updated_at: 'y', inputs: { thread_id: THREAD } })),
            [200, { closed: false, job_id: JOB, state, refunded, credits: 2, model_id: 'chat-fast' }], db);
        // The same job, read by its id, says the same.
        reply = { ok: true, state: db, credits: 2, model_id: 'chat-fast', error_code: null };
        const byId = await (await getJob(new Request(`https://veyrnox.ai/api/v1/jobs/${JOB}`, { headers: { 'x-veyrnox-auth-id': AUTH } }), { params: Promise.resolve({ id: JOB }) })).json();
        assert.deepEqual({ state: byId.state, refunded: byId.refunded }, { state, refunded }, db);
    }
    // Charged and not stored is a succeeded job with our own code. A vendor's string never crosses.
    assert.deepEqual((await answer(found('STORED', { error_code: 'reply_not_saved' })))[1], { closed: false, job_id: JOB, state: 'succeeded', refunded: false, credits: 2, model_id: 'chat-fast', error_code: 'reply_not_saved' });
    assert.equal((await answer(found('REFUNDED', { error_code: 'Upstream 500: <html>' })))[1].error_code, 'provider_error');
});

test('"closed" is passed on only as the database said it: any other answer is a failure, never "nothing was charged"', async () => {
    // `ISOLATION_LEVEL`: the database will not say "closed" where it could miss a job that was made while it waited.
    const odd = [null, {}, { ok: true }, { ok: false, code: 'ISOLATION_LEVEL' }, { ok: true, closed: 'true' }, { ok: true, closed: 1 }, { ok: 'true', closed: true }, { closed: true }, { ok: true, closed: true, job_id: JOB },
        { ok: true, closed: true, state: 'SUBMITTED' }, { ok: true, closed: false }, found('DONE'), found(undefined), found(null), found('STORED', { job_id: 'job-1' }), found('STORED', { job_id: undefined }),
        { ok: false }, { ok: false, code: 'SOMETHING_NEW' }, 'closed', 42, []];
    for (const r of odd) {
        const [status, body] = await answer(r);
        assert.deepEqual([status, body], [502, { error: 'close_failed' }], JSON.stringify(r));
    }
    // The database did not answer, or answered with an error: the same, and the detail stays in the log.
    for (const r of [new Error('socket hang up'), Response.json({ code: '42883', message: 'function public.chat_close_send(text, text) does not exist' }, { status: 404 }),
        Response.json({ message: 'secret detail' }, { status: 500 }), new Response('<html>', { status: 502 })]) {
        const [status, body] = await answer(r);
        assert.deepEqual([status, body], [502, { error: 'close_failed' }]);
        assert.doesNotMatch(JSON.stringify(body), /secret|does not exist|socket/);
    }
});

test('the refusals: the shared job-read limit, the cap on closed sends, an account that is not set up', async () => {
    reply = { ok: false, code: 'RATE_LIMITED', limit: 600, retry_after_seconds: 9999 };
    let res = await closeSend(req());
    assert.deepEqual([res.status, res.headers.get('retry-after'), await res.json()], [429, '60', { error: 'rate_limited', retry_after_seconds: 60 }]);
    assert.deepEqual(await answer({ ok: false, code: 'CLOSE_LIMIT' }), [429, { error: 'close_limit' }]);
    assert.deepEqual(await answer({ ok: false, code: 'USER_NOT_FOUND' }), [409, { error: 'user_not_provisioned' }]);
    assert.deepEqual(await answer({ ok: false, code: 'INVALID_KEY' }), [400, { error: 'invalid_key' }]);
    res = await closeSend(req());
    assert.equal(res.headers.get('cache-control'), 'no-store');
});

// ---- the turn: a send that was closed is never charged ----
// The database refuses to make a chat job for a closed key (the trigger of migration 0242 raises, so the whole debit
// is undone). The reader pressed Stop and is gone, so the answer goes to nobody: it is typed, quiet and charges nothing.

const MODEL = { id: 'chat-fast', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', modality: 'text', credits_5s: 2, gated_flag: false, active: true };
const closedSend = () => new SupabaseError('rpc failed: 409', { status: 409, body: { code: 'PT409', message: 'CHAT_SEND_CLOSED', details: null, hint: null } });
function turn({ replies = {}, model = MODEL, env = { OPENROUTER_API_KEY: 'sk-test' } } = {}) {
    const rpcs = []; let streamed = 0;
    const base = { check_generation_rate_limit: { ok: true }, chat_turn_context: { ok: true, user_id: 'user-1', model_id: 'chat-fast', system_prompt: '', history: [] }, ledger_debit: { ok: true, job_id: JOB, balance_after: 8 } };
    const rpc = async (name, args) => { rpcs.push(name); const r = name in replies ? replies[name] : base[name] ?? { ok: true }; if (r instanceof Error) throw r; return typeof r === 'function' ? r(args) : r; };
    const select = async (_t, q) => [Object.fromEntries(String(q.columns).split(',').map((c) => c.trim()).filter((c) => c in model).map((c) => [c, model[c]]))];
    const stream = async function* () { streamed += 1; yield { delta: 'Hi' }; };
    const go = () => runChatTurn({ authId: AUTH, threadId: THREAD, body: { text: 'Hello there', idempotency_key: KEY }, cfg: {}, env, deps: { rpc, select, stream } });
    return { rpcs, go, streamed: () => streamed };
}

test('a send that was closed before its debit is refused as send_closed: nothing is charged, started, refunded or logged as a failure', async () => {
    const t = turn({ replies: { ledger_debit: closedSend() } });
    const res = await t.go();
    assert.deepEqual([res.status, await res.json()], [409, { error: 'send_closed' }]);
    assert.deepEqual(t.rpcs, ['check_generation_rate_limit', 'chat_turn_context', 'ledger_debit'], 'no job was made, so nothing follows the debit');
    assert.equal(t.streamed(), 0, 'the provider was never called');
    assert.deepEqual(logged, [], 'a person pressing Stop is not a failure of ours');
    // Any other failure of the debit is still a failure, said and logged as before.
    // The refusal is known by all three: the status, the code and the message, as PostgREST sends what the trigger raised.
    for (const err of [new SupabaseError('rpc failed: 409', { status: 409, body: { code: 'PT409', message: 'SOMETHING_ELSE' } }), new SupabaseError('rpc failed: 500', { status: 500, body: { message: 'CHAT_SEND_CLOSED' } }),
        new SupabaseError('rpc failed: 500', { status: 500, body: { code: 'PT409', message: 'CHAT_SEND_CLOSED' } }), new SupabaseError('rpc failed: 409', { status: 409, body: { code: 'P0001', message: 'CHAT_SEND_CLOSED' } }),
        new SupabaseError('rpc failed: 409', { status: 409, body: { message: 'CHAT_SEND_CLOSED' } }),
        new SupabaseError('rpc failed: 409', { status: 409, body: 'CHAT_SEND_CLOSED' }), new Error('CHAT_SEND_CLOSED')]) {
        logged = [];
        const other = turn({ replies: { ledger_debit: err } });
        const r = await other.go();
        assert.deepEqual([r.status, await r.json()], [502, { error: 'debit_failed' }]);
        assert.equal(logged.length, 1);
    }
});

test('the same on the free allowance path: the free job is refused, and the paid debit is not tried in its place', async () => {
    const free = { ...MODEL, free_allowance_per_day: 3 };
    const t = turn({ model: free, env: { OPENROUTER_API_KEY: 'sk-test', FREE_ALLOWANCE_ENABLED: 'true' }, replies: { submit_free_job: closedSend() } });
    const res = await t.go();
    assert.deepEqual([res.status, await res.json()], [409, { error: 'send_closed' }]);
    assert.deepEqual(t.rpcs, ['check_generation_rate_limit', 'chat_turn_context', 'submit_free_job']);
    assert.deepEqual(logged, []);
    // A free call that fails any other way still falls through to the paid debit, as it always has.
    const other = turn({ model: free, env: { OPENROUTER_API_KEY: 'sk-test', FREE_ALLOWANCE_ENABLED: 'true' }, replies: { submit_free_job: new Error('timeout') } });
    assert.equal((await other.go()).headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.ok(other.rpcs.includes('ledger_debit'));
});
