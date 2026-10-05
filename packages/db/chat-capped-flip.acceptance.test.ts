/**
 * 0213 switches all ten chat rows to the capped web search and re-prices Web search in the same statement, so the low price is
 * never charged for the uncapped plugin. Replay-safe, refuses a hand-edited or missing row, changes nothing else, and every price
 * is the documented bound: Exa's measured fee ($0.011 bound) plus 7,000 input tokens at the row's rate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const FEE = 0.011; const TOKENS = 7000; const FLOOR = 0.01796;
// Input rate in USD per token, from OpenRouter's public model list on 2026-10-05.
const RATE: Record<string, number> = {
    'chat-claude-opus-5.5': 4e-6, 'chat-claude-sonnet-5.5': 2e-6, 'chat-gpt-6.1-sol': 2e-6, 'chat-grok-4.7': 2e-6,
    'chat-gemini-3.8-flash': 7.5e-7, 'chat-deepseek-v4.1-flash': 3e-7, 'chat-gpt-6-luna': 1e-7,
    'chat-llama-4-maverick': 1.875e-7, 'chat-ministral-14b': 2e-7, 'chat-mistral-small': 1.5e-7,
};
const IDS = Object.keys(RATE).sort();
const up = (n: number, step: number) => Math.round(Math.ceil(Math.round((n / step) * 1e6) / 1e6) * step * 1e6) / 1e6;

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0193_chat.sql', '0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql',
        '0211_chat_web_search_worst_case.sql', '0212_chat_web_engine.sql']) await db.query(await read(f));
    return read('0213_chat_web_search_capped.sql');
};
const state = async (db: pg.Client) => (await db.query('SELECT id, chat_web_engine AS engine, chat_web_extra_credits AS credits, chat_web_extra_cost::float8 AS cost FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS])).rows;

test('every row is capped at the documented bound, with Credits at the margin floor, and each price fell', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const before = await state(db);
        assert.ok(before.every((r) => r.engine === 'plugin'), 'plugin rows first');
        await db.query(migration);
        const rows = await state(db);
        assert.deepEqual(rows.map((r) => r.id), IDS);
        for (const r of rows) {
            const cost = up(FEE + TOKENS * RATE[r.id], 0.0001);
            assert.equal(r.engine, 'capped', r.id);
            assert.equal(r.cost, cost, `${r.id}: the stored cost is the documented bound`);
            assert.equal(r.credits, Math.max(1, Math.ceil(Math.round((cost / FLOOR) * 1e6) / 1e6)), `${r.id}: credits are the margin floor`);
            const old = before.find((b) => b.id === r.id)!;
            assert.ok(r.cost < old.cost && r.credits < old.credits, `${r.id}: cheaper than the uncapped plugin bound`);
        }
        assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.credits])), {
            'chat-claude-opus-5.5': 3, 'chat-claude-sonnet-5.5': 2, 'chat-deepseek-v4.1-flash': 1, 'chat-gemini-3.8-flash': 1, 'chat-gpt-6-luna': 1,
            'chat-gpt-6.1-sol': 2, 'chat-grok-4.7': 2, 'chat-llama-4-maverick': 1, 'chat-ministral-14b': 1, 'chat-mistral-small': 1,
        });
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('replay is safe and nothing but the engine and the two Web search columns changes', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const strip = (rows: any[]) => rows.map(({ chat_web_engine, chat_web_extra_credits, chat_web_extra_cost, updated_at, ...rest }) => rest);
        const before = strip((await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows);
        await db.query(migration);
        const once = await state(db);
        await db.query(migration);
        assert.deepEqual(await state(db), once, 'applying it twice changes nothing');
        assert.deepEqual(strip((await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows), before, 'no other column or row changed');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('the migration refuses a hand-edited or missing row', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        for (const id of IDS) {
            for (const [label, sql] of [
                ['recorded cost edited by hand', 'UPDATE public.model_catalog SET chat_web_extra_cost = chat_web_extra_cost + 0.0001, chat_web_extra_credits = chat_web_extra_credits + 1 WHERE id = $1'],
                ['missing', 'DELETE FROM public.model_catalog WHERE id = $1'],
            ]) {
                await db.query('SAVEPOINT s');
                await db.query(sql, [id]);
                await assert.rejects(db.query(migration), /Expected ten chat rows to switch to the capped web search, updated 9/, `${id}: ${label}`);
                await db.query('ROLLBACK TO SAVEPOINT s');
            }
        }
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
