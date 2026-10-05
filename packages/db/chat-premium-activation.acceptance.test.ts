/** The five premium chat models: one migration turns on exactly them, replay-safe, and refuses a missing, repriced or re-configured row. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const IDS = ['chat-claude-opus-5.5', 'chat-deepseek-v4.1-flash', 'chat-gemini-3.8-flash', 'chat-gpt-6.1-sol', 'chat-grok-4.7'];

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0193_chat.sql', '0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0209_chat_models_activate_premium.sql');
};

test('the migration turns on exactly the five premium models and replays', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const before = (await db.query('SELECT id, active FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS])).rows;
        assert.deepEqual(before.map((r) => r.active), [false, false, false, false, false], 'staged inactive first');
        const others = (await db.query('SELECT * FROM public.model_catalog WHERE NOT (id = ANY($1)) ORDER BY id', [IDS])).rows;
        await db.query(migration);
        await db.query(migration);
        const rows = (await db.query('SELECT id, active, credits_5s FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS])).rows;
        assert.deepEqual(rows, [
            { id: 'chat-claude-opus-5.5', active: true, credits_5s: 7 }, { id: 'chat-deepseek-v4.1-flash', active: true, credits_5s: 1 },
            { id: 'chat-gemini-3.8-flash', active: true, credits_5s: 2 }, { id: 'chat-gpt-6.1-sol', active: true, credits_5s: 4 },
            { id: 'chat-grok-4.7', active: true, credits_5s: 3 },
        ]);
        assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE NOT (id = ANY($1)) ORDER BY id', [IDS])).rows, others, 'no other row changed');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('the migration refuses a missing, repriced or re-configured row', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        for (const id of IDS) {
            for (const [label, sql] of [
                ['repriced', 'UPDATE public.model_catalog SET credits_5s = credits_5s + 1 WHERE id = $1'],
                ['reasoning effort changed (the setting that stops empty replies)', "UPDATE public.model_catalog SET chat_reasoning_effort = 'high' WHERE id = $1"],
                ['reply cap changed', 'UPDATE public.model_catalog SET chat_max_reply_tokens = 1024 WHERE id = $1'],
                ['recorded cost changed', 'UPDATE public.model_catalog SET provider_cost_per_unit = provider_cost_per_unit + 0.0001 WHERE id = $1'],
                ['missing', 'DELETE FROM public.model_catalog WHERE id = $1'],
            ]) {
                await db.query('SAVEPOINT s');
                await db.query(sql, [id]);
                await assert.rejects(db.query(migration), /Expected five verified premium chat rows, updated 4/, `${id}: ${label}`);
                await db.query('ROLLBACK TO SAVEPOINT s');
            }
        }
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
