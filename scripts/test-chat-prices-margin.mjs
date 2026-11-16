#!/usr/bin/env node
// 0519 (ADR-0067 amendment 18): every chat price keeps the 50% margin at the providers' 2026-11-14 worst-case rates.
// Runs against the full migration replay (ledger-tests.yml). Every change is rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (/supabase\.(co|com)/.test(url)) throw new Error('use an isolated test database');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const FLOOR = 0.01796;

// [input $/M, output $/M, input tokens, reply cap, image tokens], the dearest standard-tier OpenRouter endpoint or the recorded rate.
const RATE = {
    'chat-claude-opus-5.5': [4.4, 22, 9000, 4096, 5800], 'chat-claude-sonnet-5.5': [2.2, 11, 9000, 4096, 5800],
    'chat-gpt-6.1-sol': [2.2, 11, 9000, 4096, 6000], 'chat-grok-4.7': [2.2, 6.6, 10300, 4096, 4500],
    'chat-gemini-3.8-flash': [0.825, 4.125, 9000, 4096, 1400], 'chat-gpt-6-luna': [0.11, 0.55, 9000, 4096, 6000],
    'chat-deepseek-v4.1-flash': [0.45, 1.8, 9000, 4096, 1300], 'chat-llama-4-maverick': [0.35, 1.15, 9000, 1024, 3000],
    'chat-ministral-14b': [0.22, 0.22, 9000, 1024, 3800], 'chat-mistral-small': [0.165, 0.66, 9000, 1024, 3800],
};
const covers = (credits, cost, worst, what) => {
    assert.ok(cost >= worst - 1e-9, `${what}: recorded ${cost} below worst case ${worst}`);
    assert.ok(credits >= Math.ceil(cost / FLOOR - 1e-9), `${what}: ${credits} Credits under the floor for ${cost}`);
};
// Credits before 0519 (base, Thinking, Web search, Images, long text), from 0196-0198, 0220 and 0517.
// The editor AI edit row is 10 because the full replay also applies 0547 (flat 10 for paid editor actions).
const WAS = {
    'chat-claude-opus-5.5': [7, 5, 3, 6, 2], 'chat-claude-sonnet-5.5': [4, 3, 2, 3, 1], 'chat-gpt-6.1-sol': [4, 3, 2, 3, 1],
    'chat-grok-4.7': [3, 2, 2, 3, 1], 'chat-gemini-3.8-flash': [2, 1, 1, 1, 1], 'chat-gpt-6-luna': [1, 1, 1, 1, 1],
    'chat-deepseek-v4.1-flash': [1, 1, 1, 1, 1], 'chat-llama-4-maverick': [1, null, 1, 1, 1], 'chat-ministral-14b': [1, null, 1, 1, 1],
    'chat-mistral-small': [1, null, 1, 1, 1], 'editor-ai-edit-gemini-3.8-flash': [10, null, null, null, null],
};
const SELECT = `SELECT id, credits_5s, provider_cost_per_unit::float8 AS base, chat_thinking_extra_credits AS tc,
    chat_thinking_extra_cost::float8 AS tcost, chat_web_extra_credits AS wc, chat_web_extra_cost::float8 AS wcost,
    chat_images_extra_credits AS ic, chat_images_extra_cost::float8 AS icost, chat_long_text_extra_credits AS lc,
    chat_long_text_extra_cost::float8 AS lcost FROM public.model_catalog WHERE provider = 'openrouter-chat' ORDER BY id`;

try {
    await c.query('BEGIN');
    // The replay as it stands (0553 applied last): the owner's rule that no model costs 1 credit a reply holds for every chat row.
    const replayed = await q(`SELECT id, credits_5s FROM public.model_catalog WHERE provider = 'openrouter-chat' AND id LIKE 'chat-%'`);
    assert.equal(replayed.length, 10, 'the ten chat rows');
    assert.deepEqual(replayed.filter((r) => r.credits_5s < 2), [], 'no chat row is left at 1 credit a reply (0553)');
    const sql = await readFile(new URL('../packages/db/schema/supabase/0519_chat_prices_50_percent_margin.sql', import.meta.url), 'utf8');
    await c.query(sql); await c.query(sql); // safe to apply twice
    // 0553 (every 1-credit chat model is now 2) runs after 0519 in a full replay; 0519 above re-set luna and DeepSeek to 1.
    const two = await readFile(new URL('../packages/db/schema/supabase/0553_chat_one_credit_models_now_two.sql', import.meta.url), 'utf8');
    await c.query(two); await c.query(two); // safe to apply twice
    const rows = await q(SELECT);
    assert.equal(rows.length, 11, 'ten chat rows and the editor row');

    for (const r of rows.filter((row) => RATE[row.id])) {
        const [inRate, outRate, inTok, cap, img] = RATE[r.id].map((v, k) => (k < 2 ? v / 1e6 : v));
        covers(r.credits_5s, r.base, inTok * inRate + cap * outRate, `${r.id} base`);
        if (r.tc !== null) covers(r.tc, r.tcost, 4096 * outRate, `${r.id} thinking`);
        covers(r.wc, r.wcost, 0.011 + 7000 * inRate, `${r.id} web`);
        covers(r.ic, r.icost, img * 4 * inRate, `${r.id} images`);
        covers(r.lc, r.lcost, 6600 * inRate, `${r.id} long text`);
    }
    const editor = rows.find((r) => r.id === 'editor-ai-edit-gemini-3.8-flash');
    covers(editor.credits_5s, editor.base, 9000 * 0.825e-6 + 4096 * 4.125e-6, 'editor AI edit');

    // No price went down, only Opus went up (base 7 -> 8, Thinking 5 -> 6), and the base price of every 1-credit chat row is now 2 (0553).
    const base = (id) => (id === 'chat-claude-opus-5.5' ? 8 : WAS[id][0] === 1 && RATE[id] ? 2 : WAS[id][0]);
    const credits = (r) => [r.credits_5s, r.tc, r.wc, r.ic, r.lc];
    for (const r of rows) {
        const was = WAS[r.id];
        credits(r).forEach((n, k) => assert.ok(n === was[k] || n > was[k], `${r.id} price ${k} went down`));
        if (r.id !== 'chat-claude-opus-5.5') assert.deepEqual(credits(r), [base(r.id), ...was.slice(1)], `${r.id} Credits unchanged except a 1-credit base now 2`);
    }
    assert.deepEqual(credits(rows.find((r) => r.id === 'chat-claude-opus-5.5')), [8, 6, 3, 6, 2]);

    // The table still refuses an Opus price under the new cost.
    await c.query('SAVEPOINT r');
    await assert.rejects(c.query("UPDATE public.model_catalog SET chat_thinking_extra_credits = 5 WHERE id = 'chat-claude-opus-5.5'"), /chat_thinking_check/);
    await c.query('ROLLBACK TO SAVEPOINT r');
    console.log('chat prices: every cost at the 2026-11-14 worst case, every price at the 50% floor, no price lowered, replay OK');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
