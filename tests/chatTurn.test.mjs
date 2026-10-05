// ADR-0067: every ending of a chat turn, with the database and the provider faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChatTurn } from '../lib/chatTurn.js';
import { ChatProviderError } from '../packages/adapters/openrouterChat.js';

const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const MODEL = { id: 'chat-fast', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', modality: 'text', credits_5s: 2, gated_flag: false, active: true };
const body = (extra = {}) => ({ text: 'Hello there', idempotency_key: 'key-0123456789', ...extra });
const env = { OPENROUTER_API_KEY: 'sk-test' };

/** A fake database: scripted replies per RPC name, every call recorded. */
function fakes({ replies = {}, model = MODEL, stream } = {}) {
    const calls = [];
    const base = {
        check_generation_rate_limit: { ok: true },
        chat_turn_context: { ok: true, user_id: 'user-1', model_id: 'chat-fast', system_prompt: 'Be brief.', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier reply' }] },
        ledger_debit: { ok: true, job_id: JOB, balance_after: 8 },
        job_submitted: { ok: true },
        chat_complete_turn: { ok: true, message_id: 'msg-1', refund: false },
        job_failed: { ok: true },
        ledger_refund: { ok: true },
        job_submit_rejected: { ok: true },
        read_user_credits: { balance: 8 },
    };
    const rpc = async (name, args) => {
        calls.push([name, args]);
        const r = name in replies ? replies[name] : base[name];
        if (r instanceof Error) throw r;
        return typeof r === 'function' ? r(args) : r;
    };
    const select = async () => (model ? [model] : []);
    const streamCalls = [];
    const streamFn = stream || (async function* (a) { streamCalls.push(a); yield { delta: 'Hi ' }; yield { delta: 'there.' }; });
    return { calls, streamCalls, deps: { rpc, select, stream: async function* (a) { streamCalls.push(a); yield* streamFn(a); } } };
}
/** Rejects when the signal aborts, including when it already has (a late listener would never fire). */
const untilAborted = (signal) => new Promise((_, rej) => {
    const stop = () => rej(new DOMException('aborted', 'AbortError'));
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
});
const called = (f, name) => f.calls.filter(([n]) => n === name);
const run = (f, over = {}) => runChatTurn({ authId: AUTH, threadId: THREAD, body: body(), cfg: {}, env, deps: f.deps, ...over });

/** Read every server-sent event from a streamed response. */
async function events(res) {
    const text = await res.text();
    return text.split('\n\n').filter(Boolean).map((f) => ({ event: /^event: (.+)$/m.exec(f)[1], data: JSON.parse(/^data: (.+)$/m.exec(f)[1]) }));
}
const names = (evs) => evs.map((e) => e.event);

test('refuses what is wrong before touching money', async () => {
    const f = fakes();
    assert.equal((await run(f, { threadId: 'not-a-uuid' })).status, 404);
    assert.equal((await run(f, { body: { text: '', idempotency_key: 'key-0123456789' } })).status, 400);
    assert.equal((await run(f, { body: { text: 'hi', idempotency_key: 'short' } })).status, 400);
    assert.equal((await run(f, { body: { text: 'x'.repeat(8001), idempotency_key: 'key-0123456789' } })).status, 400);
    assert.equal((await run(f, { env: {} })).status, 503);
    assert.equal(f.calls.length, 0, 'no RPC ran');
});

test('rate limit: early 429 with Retry-After, and a null verdict fails closed', async () => {
    let f = fakes({ replies: { check_generation_rate_limit: { ok: false, code: 'RATE_LIMITED', limit: 10, count: 10, retry_after_seconds: 17 } } });
    const res = await run(f);
    assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), '17');
    assert.equal(called(f, 'ledger_debit').length, 0);
    f = fakes({ replies: { check_generation_rate_limit: null } });
    assert.equal((await run(f)).status, 503);
    f = fakes({ replies: { check_generation_rate_limit: new Error('db down') } });
    assert.equal((await run(f)).status, 503);
});

test('thread and model gates', async () => {
    assert.equal((await run(fakes({ replies: { chat_turn_context: { ok: false, code: 'THREAD_NOT_FOUND' } } }))).status, 404);
    for (const model of [null, { ...MODEL, active: false }, { ...MODEL, modality: 'video' }, { ...MODEL, provider: 'fal' }, { ...MODEL, credits_5s: 0 }, { ...MODEL, credits_5s: 1.5 }]) {
        const f = fakes({ model });
        assert.equal((await run(f)).status, 409, JSON.stringify(model));
        assert.equal(called(f, 'ledger_debit').length, 0, 'a refused model is never debited');
    }
    assert.equal((await run(fakes({ model: { ...MODEL, gated_flag: true } }))).status, 402);
});

test('the debit: price from the catalog, never the client; no message text on the job', async () => {
    const f = fakes();
    const res = await run(f, { body: body({ credits: 0, price: 0, model_id: 'other' }) });
    await events(res);
    const [, d] = called(f, 'ledger_debit')[0];
    assert.equal(d.p_credits, 2, 'the catalog price, whatever the body says');
    assert.equal(d.p_model_id, 'chat-fast');
    assert.equal(d.p_reason, 'debit:chat');
    assert.equal(d.p_user_id, 'user-1');
    assert.equal(d.p_idempotency_key, 'key-0123456789');
    assert.deepEqual(d.p_inputs, { kind: 'chat', thread_id: THREAD });
    assert.ok(!JSON.stringify(d).includes('Hello there'), 'the message text is not stored on the job');
    assert.equal(d.p_limit_per_window, 10); assert.equal(d.p_window_seconds, 60);
});

test('debit refusals map to status codes and never reach the provider', async () => {
    for (const [reply, status, error] of [
        [{ ok: false, code: 'INSUFFICIENT_BALANCE', message: 'have 1 need 2' }, 402, 'insufficient_balance'],
        [{ ok: false, code: 'ACCOUNT_FROZEN' }, 403, 'account_frozen'],
        [{ ok: false, code: 'RATE_LIMITED', limit: 10, count: 10, retry_after_seconds: 5 }, 429, 'rate_limited'],
        [{ ok: false, code: 'NO_BALANCE_ROW' }, 400, 'no_balance_row'],
    ]) {
        const f = fakes({ replies: { ledger_debit: reply } });
        const res = await run(f);
        assert.equal(res.status, status);
        assert.equal((await res.json()).error, error);
        assert.equal(f.streamCalls.length, 0);
    }
    const f = fakes({ replies: { ledger_debit: new Error('boom') } });
    assert.equal((await run(f)).status, 502);
});

test('the same send again is a replay: no provider call, no second charge', async () => {
    const f = fakes({ replies: { ledger_debit: { ok: true, job_id: JOB, idempotent: true, balance_after: 8 } } });
    const res = await run(f);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { replay: true, job_id: JOB, balance_after: 8 });
    assert.equal(f.streamCalls.length, 0); assert.equal(called(f, 'job_submitted').length, 0);
});

test('job_submitted fails: the debit is refunded and the provider is never called', async () => {
    const f = fakes({ replies: { job_submitted: { ok: false, code: 'BAD_STATE_FOR_SUBMIT' } } });
    const res = await run(f);
    assert.equal(res.status, 502);
    assert.equal(called(f, 'ledger_refund').length, 1);
    assert.equal(called(f, 'ledger_refund')[0][1].p_reason, 'refund:submit_failed');
    assert.equal(called(f, 'ledger_refund')[0][1].p_credits, 2);
    assert.equal(f.streamCalls.length, 0);
});

test('success: events in order, one save, charged, no refund; the provider gets the caps, history and key', async () => {
    const f = fakes();
    const res = await run(f);
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store, no-transform');
    const evs = await events(res);
    assert.deepEqual(names(evs), ['start', 'delta', 'delta', 'done']);
    assert.deepEqual(evs[0].data, { job_id: JOB, credits: 2, balance_after: 8 });
    assert.equal(evs.at(-1).data.status, 'complete'); assert.equal(evs.at(-1).data.credits_charged, 2); assert.equal(evs.at(-1).data.balance, 8);
    const [, save] = called(f, 'chat_complete_turn')[0];
    assert.deepEqual(save, { p_job_id: JOB, p_thread_id: THREAD, p_user_text: 'Hello there', p_reply: 'Hi there.', p_status: 'complete' });
    assert.equal(called(f, 'ledger_refund').length, 0); assert.equal(called(f, 'job_failed').length, 0);
    const [call] = f.streamCalls;
    assert.equal(call.apiKey, 'sk-test'); assert.equal(call.model, 'vendor/fast'); assert.equal(call.maxTokens, 1024);
    assert.deepEqual(call.messages.map((m) => [m.role, m.content]), [
        ['system', 'Be brief.'], ['user', 'earlier'], ['assistant', 'earlier reply'], ['user', 'Hello there']]);
    const sub = called(f, 'job_submitted')[0][1];
    assert.deepEqual(sub, { p_job_id: JOB, p_provider: 'openrouter-chat', p_provider_job_id: JOB });
});

test('provider gives nothing: job failed, refunded, no messages stored', async () => {
    const f = fakes({ stream: async function* () { throw new ChatProviderError('provider_rate_limited'); } });
    const evs = await events(await run(f));
    assert.deepEqual(names(evs), ['start', 'error', 'done']);
    assert.equal(evs[1].data.error, 'provider_rate_limited');
    assert.deepEqual([evs[2].data.status, evs[2].data.credits_charged], ['failed', 0]);
    assert.deepEqual(called(f, 'job_failed')[0][1], { p_provider_job_id: JOB, p_provider: 'openrouter-chat', p_error_code: 'provider_rate_limited' });
    assert.equal(called(f, 'ledger_refund').length, 1);
    assert.equal(called(f, 'chat_complete_turn').length, 0);
});

test('a non-typed provider crash is shown as provider_unavailable, not the raw error', async () => {
    const f = fakes({ stream: async function* () { throw new Error('socket hang up at 10.0.0.1 with key sk-secret'); } });
    const text = await (await run(f)).text();
    assert.ok(text.includes('provider_unavailable')); assert.ok(!text.includes('sk-secret') && !text.includes('10.0.0.1'));
});

test('cut off after partial text: the text is kept and the Credits come back', async () => {
    const f = fakes({
        stream: async function* () { yield { delta: 'It started but' }; throw new ChatProviderError('provider_dropped'); },
        replies: { chat_complete_turn: { ok: true, message_id: 'msg-2', refund: true } },
    });
    const evs = await events(await run(f));
    assert.deepEqual(names(evs), ['start', 'delta', 'error', 'done']);
    assert.equal(evs[2].data.error, 'provider_dropped');
    assert.deepEqual([evs.at(-1).data.status, evs.at(-1).data.credits_charged], ['error', 0]);
    assert.equal(called(f, 'chat_complete_turn')[0][1].p_status, 'error');
    assert.equal(called(f, 'ledger_refund').length, 1);
    assert.equal(called(f, 'job_failed').length, 0, 'chat_complete_turn already failed the job');
});

test('the user presses Stop after text: kept and charged; before any text: refunded', async () => {
    const ac = new AbortController();
    let f = fakes({ stream: async function* ({ signal }) {
        yield { delta: 'Partial' };
        ac.abort();
        await untilAborted(signal);
    } });
    let evs = await events(await run(f, { signal: ac.signal }));
    assert.equal(evs.at(-1).data.status, 'canceled'); assert.equal(evs.at(-1).data.credits_charged, 2);
    assert.equal(called(f, 'chat_complete_turn')[0][1].p_status, 'canceled');
    assert.equal(called(f, 'ledger_refund').length, 0);

    const ac2 = new AbortController();
    f = fakes({ stream: async function* ({ signal }) {
        ac2.abort();
        await untilAborted(signal);
    } });
    evs = await events(await run(f, { signal: ac2.signal }));
    assert.deepEqual([evs.at(-1).data.status, evs.at(-1).data.credits_charged], ['canceled', 0]);
    assert.equal(called(f, 'job_failed')[0][1].p_error_code, 'user_canceled');
    assert.equal(called(f, 'ledger_refund').length, 1); assert.equal(called(f, 'chat_complete_turn').length, 0);
});

test('if saving the turn fails, nothing is refunded here and the user is told; the sweep owns the job', async () => {
    const f = fakes({ replies: { chat_complete_turn: new Error('db down') } });
    const evs = await events(await run(f));
    assert.deepEqual(names(evs).slice(-2), ['error', 'done']);
    assert.equal(evs.at(-2).data.error, 'turn_not_saved'); assert.equal(evs.at(-1).data.credits_charged, 0);
    assert.equal(called(f, 'ledger_refund').length, 0);
});

test('a failed refund is logged and does not hide the result from the user', async () => {
    const f = fakes({ stream: async function* () { throw new ChatProviderError('provider_unavailable'); }, replies: { ledger_refund: new Error('db down') } });
    const evs = await events(await run(f));
    assert.equal(evs.at(-1).data.status, 'failed');
});
