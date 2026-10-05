// ADR-0067 amendment: a catalog row may set its own reply cap and reasoning effort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replyBudget, MAX_REPLY_TOKENS } from '../lib/chat.js';

test('a row with no budget columns gets the default cap and no reasoning setting', () => {
    assert.deepEqual(replyBudget({}), { maxTokens: MAX_REPLY_TOKENS, reasoningEffort: null });
    assert.deepEqual(replyBudget({ chat_max_reply_tokens: null, chat_reasoning_effort: null }), { maxTokens: 1024, reasoningEffort: null });
    assert.deepEqual(replyBudget(null), { maxTokens: 1024, reasoningEffort: null });
});

test('a valid row budget is used as stored', () => {
    assert.deepEqual(replyBudget({ chat_max_reply_tokens: 4096, chat_reasoning_effort: 'low' }), { maxTokens: 4096, reasoningEffort: 'low' });
    assert.deepEqual(replyBudget({ chat_max_reply_tokens: 256, chat_reasoning_effort: 'none' }), { maxTokens: 256, reasoningEffort: 'none' });
});

test('an out-of-range or malformed budget falls back instead of reaching the provider', () => {
    for (const bad of [0, 255, 8193, 100000, -1, 1.5, '4096', NaN, {}]) {
        assert.equal(replyBudget({ chat_max_reply_tokens: bad }).maxTokens, 1024, String(bad));
    }
    for (const bad of ['extreme', 'LOW', '', 3, {}, 'low; drop table']) {
        assert.equal(replyBudget({ chat_reasoning_effort: bad }).reasoningEffort, null, String(bad));
    }
});
