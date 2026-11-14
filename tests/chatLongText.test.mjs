// ADR-0067 amendment 17: messages up to 30,000 characters, priced with the row's long-message extra above 8,000.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_USER_TEXT_MAX, CHAT_USER_TEXT_STANDARD_MAX, isLongText } from '../lib/chatLimits.js';
import { MAX_USER_TEXT_TOKENS, replyPrice, rowOptions, selectChatModels, validateTurn } from '../lib/chat.js';
import { runChatTurn } from '../lib/chatTurn.js';
import { ChatProviderError } from '../packages/adapters/openrouterChat.js';
import { longTextState, messageLimit } from '../app/veyrnox/_lib/chatLongText.js';

const KEY = 'key-0123456789';
const THREAD = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const BASE = { id: 'chat-fast', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', modality: 'text', credits_5s: 2, gated_flag: false, active: true };
const LONG = { ...BASE, chat_long_text_extra_credits: 1, chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192, chat_thinking_extra_credits: 3 };

test('the limits: 30,000 characters and 7,500 tokens in all, 8,000 and 2,000 before the extra applies', () => {
    assert.deepEqual([CHAT_USER_TEXT_MAX, CHAT_USER_TEXT_STANDARD_MAX, MAX_USER_TEXT_TOKENS], [30000, 8000, 7500]);
    assert.equal(validateTurn({ text: 'x'.repeat(30000), idempotency_key: KEY }).ok, true);
    assert.deepEqual(validateTurn({ text: 'x'.repeat(30001), idempotency_key: KEY }), { ok: false, error: 'invalid_text' });
    assert.deepEqual(validateTurn({ text: '日'.repeat(7501), idempotency_key: KEY }), { ok: false, error: 'invalid_text' }, 'CJK holds to the token cap');
});

test('isLongText: over 8,000 characters or over 2,000 estimated tokens', () => {
    assert.equal(isLongText('x'.repeat(8000)), false);
    assert.equal(isLongText('x'.repeat(8001)), true);
    assert.equal(isLongText('日'.repeat(2000)), false);
    assert.equal(isLongText('日'.repeat(2001)), true, 'a CJK message is long by its tokens');
    assert.equal(isLongText(undefined), false);
});

test('replyPrice: the extra is added once for a long message, with any other option, and refused where not offered', () => {
    assert.deepEqual(replyPrice(LONG, { longText: false }), { ok: true, credits: 2 });
    assert.deepEqual(replyPrice(LONG, { longText: true }), { ok: true, credits: 3 });
    assert.deepEqual(replyPrice(LONG, { longText: true, thinking: true }), { ok: true, credits: 6 });
    assert.deepEqual(replyPrice(BASE, { longText: true }), { ok: false, error: 'invalid_text' }, 'a row without the extra keeps 8,000');
    for (const bad of [0, -1, 1.5, '1', null]) assert.deepEqual(replyPrice({ ...BASE, chat_long_text_extra_credits: bad }, { longText: true }), { ok: false, error: 'invalid_text' });
    const research = { ...LONG, chat_research_extra_credits: 15, chat_research_write_max_tokens: 4096, chat_research_search_model: 'vendor/plan' };
    assert.deepEqual(replyPrice(research, { research: true, longText: true }), { ok: false, error: 'option_unavailable' }, 'never with Deep research');
    assert.deepEqual(rowOptions(LONG).long_text, { extra_credits: 1 });
    assert.equal(rowOptions(BASE).long_text, null);
});

test('selectChatModels: a database without 0517 is read again without the long-message column, and without both late columns', async () => {
    const missing = (c) => Object.assign(new Error('400'), { status: 400, body: `{"message":"column model_catalog.${c} does not exist"}` });
    const seen = [];
    const rows = await selectChatModels(async (_t, q) => {
        seen.push(q.columns);
        for (const c of ['chat_long_text_extra_credits', 'chat_web_engine']) if (q.columns.split(',').includes(c)) throw missing(c);
        return [{ id: 'a' }];
    }, { columns: 'id,chat_web_engine,chat_long_text_extra_credits', filter: 'x' }, {});
    assert.deepEqual(rows, [{ id: 'a' }]);
    assert.deepEqual(seen, ['id,chat_web_engine,chat_long_text_extra_credits', 'id,chat_web_engine', 'id']);
});

test('the composer: the per-model limit, the catalog extra, the counter and the refusal', () => {
    const offered = { max_message_chars: 30000, options: { long_text: { extra_credits: 2 } } };
    const plain = { max_message_chars: 8000, options: { long_text: null } };
    assert.equal(messageLimit(offered), 30000); assert.equal(messageLimit(plain), 8000); assert.equal(messageLimit(undefined), 8000);
    assert.deepEqual(longTextState(offered, 'x'.repeat(100)), { limit: 30000, long: false, extra: 0, tooLong: false, showCounter: false, count: 100 });
    assert.deepEqual(longTextState(offered, 'x'.repeat(8001)), { limit: 30000, long: true, extra: 2, tooLong: false, showCounter: true, count: 8001 });
    assert.equal(longTextState(offered, 'x'.repeat(30001)).tooLong, true);
    assert.deepEqual(longTextState(plain, 'x'.repeat(7500)), { limit: 8000, long: false, extra: 0, tooLong: false, showCounter: true, count: 7500 });
    assert.equal(longTextState(plain, 'x'.repeat(8001)).tooLong, true);
    assert.equal(longTextState(plain, '日'.repeat(2001)).tooLong, true, 'over the token cap on a model without the extra');
});

function fakes({ model = LONG, replies = {}, stream } = {}) {
    const calls = [];
    const base = {
        check_generation_rate_limit: { ok: true }, account_spend_eligible: { ok: true },
        provider_spend_admit_model: { ok: true, idempotent: false, estimated_cost_microusd: 25000 },
        chat_turn_context: { ok: true, user_id: 'user-1', model_id: 'chat-fast', system_prompt: null, history: [] },
        ledger_debit: { ok: true, job_id: JOB, balance_after: 8 }, job_submitted: { ok: true },
        chat_complete_turn: { ok: true, message_id: 'msg-1', refund: false }, job_failed: { ok: true }, ledger_refund: { ok: true },
        read_user_credits: { balance: 8 }, chat_stops_before_text: 0,
    };
    const rpc = async (name, args) => { calls.push([name, args]); return name in replies ? replies[name] : base[name]; };
    const select = async (_t, q) => [Object.fromEntries(String(q.columns).split(',').filter((c) => c in model).map((c) => [c, model[c]]))];
    const s = stream || (async function* () { yield { delta: 'Hi.' }; });
    return { calls, deps: { rpc, select, stream: s } };
}
const called = (f, name) => f.calls.filter(([n]) => n === name);
const run = (f, text, env = { OPENROUTER_API_KEY: 'sk-test' }) => runChatTurn({ authId: AUTH, threadId: THREAD, body: { text, idempotency_key: KEY }, cfg: {}, env, deps: f.deps });

test('the turn: 8,000 characters is the flat price; 8,001 adds the extra and marks the job; 30,000 is accepted', async () => {
    for (const [len, credits, long] of [[8000, 2, false], [8001, 3, true], [30000, 3, true]]) {
        const f = fakes();
        await (await run(f, 'x'.repeat(len))).text();
        const [, debit] = called(f, 'ledger_debit')[0];
        assert.equal(debit.p_credits, credits, `${len} characters`);
        assert.equal(debit.p_inputs.long_text, long ? true : undefined);
        assert.equal(called(f, 'chat_complete_turn')[0][1].p_user_text.length, len);
    }
});

test('the turn: 30,001 characters, or a long message to a row without the extra, is refused before any money moves', async () => {
    let f = fakes();
    assert.equal((await run(f, 'x'.repeat(30001))).status, 400);
    assert.equal(f.calls.length, 0);
    f = fakes({ model: BASE });
    const res = await run(f, 'x'.repeat(8001));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'invalid_text' });
    assert.equal(called(f, 'ledger_debit').length + called(f, 'provider_spend_admit_model').length, 0);
});

test('the turn: a failed long reply refunds as before, and a replay of one is not charged again', async () => {
    let f = fakes({ stream: async function* () { throw new ChatProviderError('provider_rate_limited'); } });
    await (await run(f, 'x'.repeat(9000))).text();
    assert.equal(called(f, 'ledger_debit')[0][1].p_credits, 3);
    assert.equal(called(f, 'ledger_refund').length, 1);
    f = fakes({ replies: { ledger_debit: { ok: true, job_id: JOB, idempotent: true, balance_after: 8 } } });
    const res = await run(f, 'x'.repeat(9000));
    assert.deepEqual(await res.json(), { replay: true, job_id: JOB, balance_after: 8 });
    assert.equal(called(f, 'chat_complete_turn').length, 0);
});

test('the turn: a long message is never covered by the free allowance', async () => {
    const f = fakes({ model: { ...LONG, free_allowance_per_day: 3 } });
    await (await run(f, 'x'.repeat(9000), { OPENROUTER_API_KEY: 'sk-test', FREE_ALLOWANCE_ENABLED: 'true' })).text();
    assert.equal(called(f, 'submit_free_job').length, 0);
    assert.equal(called(f, 'ledger_debit')[0][1].p_credits, 3);
});
