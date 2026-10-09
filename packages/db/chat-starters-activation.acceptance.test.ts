/** Starter chat models activation: exactly three rows, replay-safe, refuses a missing or repriced row, touches nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const IDS = ['chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small'];
const STABLE = 'id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active';

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0193_chat.sql', '0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0201_chat_models_activate_starters.sql');
};

test('activation turns on exactly the three starter rows and replays', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        assert.ok((await db.query('SELECT active FROM public.model_catalog WHERE id = ANY($1)', [IDS])).rows.every((r) => r.active === false), 'staged inactive first');
        const others = (await db.query(`SELECT ${STABLE} FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id`, [IDS])).rows;
        await db.query(migration);
        await db.query(migration);
        const { rows } = await db.query('SELECT id, active, credits_5s, chat_web_extra_credits AS web, chat_images_extra_credits AS images, chat_thinking_extra_credits AS thinking FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS]);
        assert.deepEqual(rows, [
            { id: 'chat-llama-4-maverick', active: true, credits_5s: 1, web: 2, images: 1, thinking: null },
            { id: 'chat-ministral-14b', active: true, credits_5s: 1, web: 2, images: 1, thinking: null },
            { id: 'chat-mistral-small', active: true, credits_5s: 1, web: 2, images: 1, thinking: null },
        ]);
        assert.deepEqual((await db.query(`SELECT ${STABLE} FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id`, [IDS])).rows, others, 'no other row changed');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('activation refuses a missing or repriced row', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        for (const [label, sql] of [
            ['repriced', "UPDATE public.model_catalog SET credits_5s = 2 WHERE id = 'chat-ministral-14b'"],
            ['endpoint changed', "UPDATE public.model_catalog SET provider_endpoint = 'x/y' WHERE id = 'chat-mistral-small'"],
            ['missing', "DELETE FROM public.model_catalog WHERE id = 'chat-llama-4-maverick'"],
        ]) {
            await db.query('SAVEPOINT s');
            await db.query(sql);
            await assert.rejects(db.query(migration), /Expected three verified starter chat rows, updated 2/, label);
            await db.query('ROLLBACK TO SAVEPOINT s');
        }
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
