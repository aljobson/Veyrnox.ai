import test from 'node:test';
import assert from 'node:assert/strict';
import { replyPrice, rowOptions, validateTurn, researchEnabled, researchSettings } from '../lib/chat.js';

const base = { credits_5s: 2 };
const offered = { ...base, chat_research_extra_credits: 15, chat_research_write_max_tokens: 4096, chat_research_search_model: 'mistralai/mistral-small-2603',
    chat_web_extra_credits: 2, chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192, chat_thinking_extra_credits: 3, chat_images_extra_credits: 1 };
const turn = (options) => validateTurn({ text: 'hello', idempotency_key: 'key-0123456789', options });

test('a row offers research only when its credits, write cap and search model are all valid', () => {
    assert.deepEqual(researchSettings(offered), { extraCredits: 15, writeMaxTokens: 4096, searchModel: 'mistralai/mistral-small-2603' });
    for (const bad of [{}, { chat_research_extra_credits: 15 }, { chat_research_write_max_tokens: 4096 }, { chat_research_search_model: 'm/x' },
        { chat_research_extra_credits: 0, chat_research_write_max_tokens: 4096 }, { chat_research_extra_credits: 15, chat_research_write_max_tokens: 100 },
        { chat_research_extra_credits: 15, chat_research_write_max_tokens: 9000 }, { chat_research_extra_credits: '15', chat_research_write_max_tokens: 4096 },
        { ...offered, chat_research_search_model: null }, { ...offered, chat_research_search_model: '' }, { ...offered, chat_research_search_model: 'bad model!' },
        { ...offered, chat_research_search_model: '../etc' }, { ...offered, chat_research_search_model: 42 }]) {
        assert.equal(researchSettings({ ...base, ...bad }), null, JSON.stringify(bad));
    }
});

test('the models route shape is unchanged for a row without research, and gains one key for a row with it', () => {
    assert.deepEqual(Object.keys(rowOptions(base)).sort(), ['images', 'thinking', 'web']);
    assert.deepEqual(rowOptions(offered).research, { extra_credits: 15 });
});

test('a research reply is the base plus the research extra, and nothing else is added', () => {
    assert.deepEqual(replyPrice(offered, { research: true }), { ok: true, credits: 17 });
    assert.deepEqual(replyPrice(offered, {}), { ok: true, credits: 2 }, 'off by default');
});

test('research is priced alone: never with another option, and never on a row that does not offer it', () => {
    for (const other of [{ thinking: true }, { web: true }, { images: true }]) {
        assert.deepEqual(replyPrice(offered, { research: true, ...other }), { ok: false, error: 'option_unavailable' }, JSON.stringify(other));
    }
    assert.deepEqual(replyPrice(base, { research: true }), { ok: false, error: 'option_unavailable' });
});

test('turn validation accepts research as a boolean, and a turn without it keeps its old shape', () => {
    assert.deepEqual(turn({ research: true }).options, { thinking: false, web: false, research: true });
    assert.deepEqual(turn({ web: true }).options, { thinking: false, web: true });
    assert.deepEqual(turn(undefined).options, { thinking: false, web: false });
    assert.deepEqual(turn({ research: false }).options, { thinking: false, web: false });
    for (const bad of [{ research: 'yes' }, { research: 1 }, { deep: true }]) assert.equal(turn(bad).ok, false, JSON.stringify(bad));
});

test('the research switch is off unless the flag is exactly "true"', () => {
    assert.equal(researchEnabled({ CHAT_RESEARCH_ENABLED: 'true' }), true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', true]) assert.equal(researchEnabled({ CHAT_RESEARCH_ENABLED: v }), false, String(v));
    assert.equal(researchEnabled(undefined), false);
});
