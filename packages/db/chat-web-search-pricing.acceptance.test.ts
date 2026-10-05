/**
 * 0211 re-prices Web search on all ten chat rows from measured worst cases. It is replay-safe, refuses a hand-edited or missing
 * row, changes nothing else, and every stored cost matches the documented bound: fee $0.06 + 64,000 input tokens at the row's rate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const FEE = 0.06; const TOKENS = 64000; const FLOOR = 0.01796;
// Input rate in USD per token, from OpenRouter's public model list on 2026-10-05.
const RATE: Record<string, number> = {
    'chat-claude-opus-5.5': 4e-6, 'chat-claude-sonnet-5.5': 2e-6, 'chat-gpt-6.1-sol': 2e-6, 'chat-grok-4.7': 2e-6,
    'chat-gemini-3.8-flash': 7.5e-7, 'chat-deepseek-v4.1-flash': 3e-7, 'chat-gpt-6-luna': 1e-7,
    'chat-llama-4-maverick': 1.875e-7, 'chat-ministral-14b': 2e-7, 'chat-mistral-small': 1.5e-7,
};
const IDS = Object.keys(RATE).sort();

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0193_chat.sql', '0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0211_chat_web_search_worst_case.sql');
};
const web = async (db: pg.Client) => (await db.query('SELECT id, chat_web_extra_credits AS credits, chat_web_extra_cost::float8 AS cost FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS])).rows;

test('every stored cost is the documented bound, and credits are the margin floor', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const before = await web(db);
        assert.ok(before.every((r) => r.cost < 0.1 || r.id === 'chat-claude-opus-5.5'), 'the old, lower recorded costs are in place first');
        await db.query(migration);
        const rows = await web(db);
        assert.deepEqual(rows.map((r) => r.id), IDS);
        for (const r of rows) {
            const bound = Math.round((FEE + TOKENS * RATE[r.id]) * 10000) / 10000;
            assert.equal(r.cost, bound, `${r.id}: the stored cost is the documented bound`);
            assert.equal(r.credits, Math.ceil(Math.round((bound / FLOOR) * 1e6) / 1e6), `${r.id}: credits are the margin floor`);
        }
        // Each row rose: nothing was made cheaper by accident.
        for (const r of rows) assert.ok(r.cost > before.find((b) => b.id === r.id)!.cost, `${r.id} rose`);
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('replay is safe and nothing but the two Web search columns changes', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const strip = (rows: any[]) => rows.map(({ chat_web_extra_credits, chat_web_extra_cost, updated_at, ...rest }) => rest);
        const before = strip((await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows);
        await db.query(migration);
        const once = await web(db);
        await db.query(migration);
        assert.deepEqual(await web(db), once, 'applying it twice changes nothing');
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
                ['recorded cost edited by hand', "UPDATE public.model_catalog SET chat_web_extra_cost = chat_web_extra_cost + 0.0001, chat_web_extra_credits = chat_web_extra_credits + 1 WHERE id = $1"],
                ['missing', 'DELETE FROM public.model_catalog WHERE id = $1'],
            ]) {
                await db.query('SAVEPOINT s');
                await db.query(sql, [id]);
                await assert.rejects(db.query(migration), /Expected ten chat rows to re-price Web search on, updated 9/, `${id}: ${label}`);
                await db.query('ROLLBACK TO SAVEPOINT s');
            }
        }
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
