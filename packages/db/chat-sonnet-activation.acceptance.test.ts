/** Claude Sonnet 5.5 activation: one row, replay-safe, refuses a missing or repriced row, touches nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const ID = 'chat-claude-sonnet-5.5';

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (all in one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0199_chat_models_activate_claude_sonnet.sql');
};

test('activation turns on exactly Claude Sonnet 5.5 and replays', { skip: !url && 'DATABASE_URL not set' }, async () => {
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
        const { rows: [row] } = await db.query('SELECT active, credits_5s, chat_thinking_extra_credits AS thinking, chat_web_extra_credits AS web, chat_images_extra_credits AS images FROM public.model_catalog WHERE id = $1', [ID]);
        assert.deepEqual(row, { active: true, credits_5s: 4, thinking: 3, web: 3, images: 3 });
        assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> $1 ORDER BY id', [ID])).rows, others, 'no other row changed');
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
        await db.query('SAVEPOINT repriced');
        await db.query('UPDATE public.model_catalog SET credits_5s = 5 WHERE id = $1', [ID]);
        await assert.rejects(db.query(migration), /Expected one verified Claude Sonnet 5.5 chat row, updated 0/);
        await db.query('ROLLBACK TO SAVEPOINT repriced');
        await db.query('SAVEPOINT missing');
        await db.query('DELETE FROM public.model_catalog WHERE id = $1', [ID]);
        await assert.rejects(db.query(migration), /Expected one verified Claude Sonnet 5.5 chat row, updated 0/);
        await db.query('ROLLBACK TO SAVEPOINT missing');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
