/** GPT-6 Luna activation: one row, replay-safe, refuses a missing, repriced or re-configured row, touches nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const ID = 'chat-gpt-6-luna';

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0200_chat_models_activate_gpt_6_luna.sql');
};

test('activation turns on exactly GPT-6 Luna and replays', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        assert.equal((await db.query('SELECT active FROM public.model_catalog WHERE id = $1', [ID])).rows[0].active, false, 'staged inactive first');
        const others = (await db.query('SELECT * FROM public.model_catalog WHERE id <> $1 ORDER BY id', [ID])).rows;
        await db.query(migration);
        await db.query(migration);
        const { rows: [row] } = await db.query('SELECT active, credits_5s, chat_reasoning_effort AS effort, chat_thinking_extra_credits AS thinking, chat_web_extra_credits AS web, chat_images_extra_credits AS images FROM public.model_catalog WHERE id = $1', [ID]);
        assert.deepEqual(row, { active: true, credits_5s: 1, effort: 'none', thinking: 1, web: 2, images: 1 });
        assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> $1 ORDER BY id', [ID])).rows, others, 'no other row changed');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('activation refuses a missing, repriced or re-configured row', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        for (const [label, sql] of [
            ['repriced', 'UPDATE public.model_catalog SET credits_5s = 2 WHERE id = $1'],
            ['reasoning effort changed (the setting that stops empty replies)', "UPDATE public.model_catalog SET chat_reasoning_effort = 'low' WHERE id = $1"],
            ['reply cap changed', 'UPDATE public.model_catalog SET chat_max_reply_tokens = 1024 WHERE id = $1'],
            ['missing', 'DELETE FROM public.model_catalog WHERE id = $1'],
        ]) {
            await db.query('SAVEPOINT s');
            await db.query(sql, [ID]);
            await assert.rejects(db.query(migration), /Expected one verified GPT-6 Luna chat row, updated 0/, label);
            await db.query('ROLLBACK TO SAVEPOINT s');
        }
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
