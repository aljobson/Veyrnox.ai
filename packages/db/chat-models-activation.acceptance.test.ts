/** Chat model activation: exact row count, replay-safe, refuses a missing or repriced row. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const IDS = ['chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small'];

test('activation turns on exactly the three staged rows, replays, and refuses drift',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query('DELETE FROM public.model_catalog WHERE id = ANY($1)', [IDS]);
            const activation = await read('0195_chat_models_activation.sql');

            await db.query('SAVEPOINT missing');
            await assert.rejects(db.query(activation), /Expected three verified openrouter chat rows, updated 0/);
            await db.query('ROLLBACK TO SAVEPOINT missing');

            await db.query(await read('0194_chat_models_staged.sql'));
            const others = (await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows;
            await db.query(activation);
            await db.query(activation);
            const { rows } = await db.query('SELECT id, active, credits_5s FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS]);
            assert.deepEqual(rows.map((r) => [r.id, r.active, r.credits_5s]), IDS.slice().sort().map((id) => [id, true, 1]));
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows, others);

            await db.query("UPDATE public.model_catalog SET active = false, credits_5s = 2 WHERE id = 'chat-ministral-14b'");
            await db.query('SAVEPOINT repriced');
            await assert.rejects(db.query(activation), /Expected three verified openrouter chat rows, updated 2/);
            await db.query('ROLLBACK TO SAVEPOINT repriced');
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
