/** Staged chat text models: inactive, above the margin floor, harmless replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const IDS = ['chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small'];

test('chat models stage inactive at a priced floor and replay without overriding activation',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query('DELETE FROM public.model_catalog WHERE id = ANY($1)', [IDS]);
            const before = (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
            const migration = await read('0194_chat_models_staged.sql');
            await db.query(migration);
            await db.query(migration);
            const { rows } = await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS]);
            assert.equal(rows.length, 3);
            for (const row of rows) {
                assert.equal(row.provider, 'openrouter');
                assert.equal(row.modality, 'text');
                assert.equal(row.active, false);
                assert.equal(row.gated_flag, false);
                assert.equal(row.cost_unit, 'per_generation');
                assert.match(row.provider_endpoint, /^[a-z0-9-]+\/[a-z0-9.-]+$/);
                assert.ok(row.credits_5s >= Math.ceil(Number(row.provider_cost_per_unit) / 0.01796), row.id);
            }
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows, before);
            await db.query("UPDATE public.model_catalog SET active = true, credits_5s = 3 WHERE id = 'chat-mistral-small'");
            await db.query(migration);
            const { rows: [later] } = await db.query("SELECT active, credits_5s FROM public.model_catalog WHERE id = 'chat-mistral-small'");
            assert.deepEqual(later, { active: true, credits_5s: 3 });
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
