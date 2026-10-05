/** Reasoning chat models: strict budget columns, staged inactive, recorded cost covers the worst case. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
// $ per million tokens, OpenRouter's public list read 2026-10-05: [input, output, extra input tokens].
const RATES: Record<string, [number, number, number]> = {
    'chat-claude-sonnet-5.5': [2, 10, 0], 'chat-claude-opus-5.5': [4, 20, 0], 'chat-gpt-6.1-sol': [2, 10, 0],
    'chat-gemini-3.8-flash': [0.75, 3.75, 0], 'chat-grok-4.7': [2, 6, 1300], 'chat-gpt-6-luna': [0.1, 0.5, 0],
    'chat-deepseek-v4.1-flash': [0.3, 1.2, 0],
};
const IDS = Object.keys(RATES);
const INPUT_TOKENS = 9000;

test('the budget columns reject bad values and non-text rows',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query(await read('0196_chat_models_reasoning.sql'));
            await db.query(await read('0196_chat_models_reasoning.sql')); // replay
            const bad = async (set: string, re: RegExp) => {
                await db.query('SAVEPOINT s');
                await assert.rejects(db.query(`UPDATE public.model_catalog SET ${set} WHERE id = 'chat-grok-4.7'`), re);
                await db.query('ROLLBACK TO SAVEPOINT s');
            };
            await bad('chat_max_reply_tokens = 255', /chat_max_reply_tokens_check/);
            await bad('chat_max_reply_tokens = 8193', /chat_max_reply_tokens_check/);
            await bad("chat_reasoning_effort = 'extreme'", /chat_reasoning_effort_check/);
            await db.query('SAVEPOINT s');
            await assert.rejects(db.query(`UPDATE public.model_catalog SET modality = 'image' WHERE id = 'chat-grok-4.7'`), /chat_budget_text_only_check/);
            await db.query('ROLLBACK TO SAVEPOINT s');
            await db.query("UPDATE public.model_catalog SET chat_max_reply_tokens = 8192, chat_reasoning_effort = 'high' WHERE id = 'chat-grok-4.7'");
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });

test('seven premium chat models stage inactive; cost covers the worst case; price clears the floor; replay keeps activation',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            const migration = await read('0196_chat_models_reasoning.sql');
            await db.query(migration);
            const before = (await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows;
            await db.query(migration);
            const { rows } = await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS]);
            assert.equal(rows.length, 7);
            for (const row of rows) {
                const [inRate, outRate, extra] = RATES[row.id];
                const worst = ((INPUT_TOKENS + extra) * inRate + row.chat_max_reply_tokens * outRate) / 1e6;
                assert.equal(row.provider, 'openrouter-chat');
                assert.equal(row.modality, 'text');
                assert.equal(row.active, false, row.id);
                assert.equal(row.gated_flag, false);
                assert.equal(row.cost_unit, 'per_generation');
                assert.equal(row.chat_max_reply_tokens, 4096);
                assert.ok(['low', 'none'].includes(row.chat_reasoning_effort), row.id);
                assert.match(row.provider_endpoint, /^[a-z0-9-]+\/[a-z0-9.-]+$/);
                assert.match(row.id, /^[a-z0-9][a-z0-9.-]{0,63}$/, 'must satisfy MODEL_ID_RE');
                assert.ok(Number(row.provider_cost_per_unit) >= worst - 1e-9, `${row.id} records ${row.provider_cost_per_unit}, worst case ${worst}`);
                assert.ok(row.credits_5s >= Math.ceil(Number(row.provider_cost_per_unit) / 0.01796), `${row.id} below the margin floor`);
            }
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows, before);
            await db.query("UPDATE public.model_catalog SET active = true, credits_5s = 9 WHERE id = 'chat-grok-4.7'");
            await db.query(migration);
            const { rows: [later] } = await db.query("SELECT active, credits_5s FROM public.model_catalog WHERE id = 'chat-grok-4.7'");
            assert.deepEqual(later, { active: true, credits_5s: 9 });
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
