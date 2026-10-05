// ADR-0067 amendment 2: Thinking and Web search are priced options stored on the catalog row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn, replyBudget, replyPrice, sourcesMarkdown } from '../lib/chat.js';

const ROW = {
    credits_5s: 4, chat_max_reply_tokens: 4096, chat_reasoning_effort: 'low',
    chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192, chat_thinking_extra_credits: 3,
    chat_web_extra_credits: 3,
};
const turn = (extra) => ({ text: 'hi', idempotency_key: 'key-0123456789', ...extra });

test('options default to off and accept only the two booleans', () => {
    assert.deepEqual(validateTurn(turn()).options, { thinking: false, web: false });
    assert.deepEqual(validateTurn(turn({ options: { thinking: true } })).options, { thinking: true, web: false });
    assert.deepEqual(validateTurn(turn({ options: { thinking: true, web: true } })).options, { thinking: true, web: true });
    for (const bad of [true, 'yes', [], { thinking: 'true' }, { web: 1 }, { thinking: true, cheap: true }, null]) {
        assert.deepEqual(validateTurn(turn({ options: bad })), { ok: false, error: 'invalid_options' }, JSON.stringify(bad));
    }
});

test('the price is the catalog base plus the catalog extra for each option chosen', () => {
    assert.deepEqual(replyPrice(ROW, { thinking: false, web: false }), { ok: true, credits: 4 });
    assert.deepEqual(replyPrice(ROW, { thinking: true, web: false }), { ok: true, credits: 7 });
    assert.deepEqual(replyPrice(ROW, { thinking: false, web: true }), { ok: true, credits: 7 });
    assert.deepEqual(replyPrice(ROW, { thinking: true, web: true }), { ok: true, credits: 10 });
});

test('an option the row does not offer is refused, not priced at zero', () => {
    const noThinking = { credits_5s: 1 };
    assert.deepEqual(replyPrice(noThinking, { thinking: true, web: false }), { ok: false, error: 'option_unavailable' });
    assert.deepEqual(replyPrice(noThinking, { thinking: false, web: true }), { ok: false, error: 'option_unavailable' });
    assert.deepEqual(replyPrice({ credits_5s: 1, chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192 }, { thinking: true, web: false }),
        { ok: false, error: 'option_unavailable' }, 'a half-configured option is not offered');
    assert.deepEqual(replyPrice({ credits_5s: 0 }, {}), { ok: false, error: 'model_unavailable' });
});

test('thinking swaps in the row\'s thinking cap and effort; web search changes neither', () => {
    assert.deepEqual(replyBudget(ROW, { thinking: false, web: false }), { maxTokens: 4096, reasoningEffort: 'low' });
    assert.deepEqual(replyBudget(ROW, { thinking: true, web: false }), { maxTokens: 8192, reasoningEffort: 'high' });
    assert.deepEqual(replyBudget(ROW, { thinking: false, web: true }), { maxTokens: 4096, reasoningEffort: 'low' });
    assert.deepEqual(replyBudget({ ...ROW, chat_thinking_effort: null }, { thinking: true }), { maxTokens: 4096, reasoningEffort: 'low' });
});

test('sources become a short markdown list: https only, deduplicated, titles cleaned, capped', () => {
    assert.equal(sourcesMarkdown([]), '');
    assert.equal(sourcesMarkdown(undefined), '');
    const md = sourcesMarkdown([
        { url: 'https://nodejs.org/en/blog/release/v26.10.0', title: 'Node.js — 26.10.0 [Current]\nrelease' },
        { url: 'https://nodejs.org/en/blog/release/v26.10.0', title: 'duplicate' },
        { url: 'javascript:alert(1)', title: 'bad' },
        { url: 'http://insecure.example/x', title: 'plain http' },
        { url: 'https://example.com/a_(b)', title: '' },
        { url: 'not a url', title: 'junk' },
    ]);
    assert.equal(md, '\n\nSources\n- [Node.js — 26.10.0 Current release](https://nodejs.org/en/blog/release/v26.10.0)\n- [plain http](http://insecure.example/x)\n- [example.com](https://example.com/a_%28b%29)');
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.example/`, title: `S${i}` }));
    assert.equal(sourcesMarkdown(many).split('\n- ').length - 1, 8);
});
