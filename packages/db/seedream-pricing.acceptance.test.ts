/** Price correction must preserve routing/activation and refuse unknown drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
test('Seedream repricing preserves catalog state and rejects unexpected pricing',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'isolated test database only');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
        try {
            await db.query('BEGIN');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query(`INSERT INTO public.model_catalog
                (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,active)
                VALUES ('seedream-4','Seedream v4','fal','fal-ai/bytedance/seedream/v4/text-to-image',
                'text-to-image',3,0.04,'per_generation',NULL,false)
                ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider,
                provider_endpoint = EXCLUDED.provider_endpoint, credits_5s = 3,
                provider_cost_per_unit = 0.04, cost_unit = 'per_generation',
                billing_seconds = NULL, active = false`);
            const others = "SELECT * FROM public.model_catalog WHERE id <> 'seedream-4' ORDER BY id";
            const before = (await db.query(others)).rows;
            const sql = await read('0114_seedream_fal_floor_price.sql');
            await db.query(sql);
            await db.query(sql);
            const row = (await db.query(`SELECT provider, provider_endpoint, active, credits_5s,
                provider_cost_per_unit::float AS cost FROM public.model_catalog WHERE id = 'seedream-4'`)).rows[0];
            assert.deepEqual(row, { provider: 'fal',
                provider_endpoint: 'fal-ai/bytedance/seedream/v4/text-to-image',
                active: false, credits_5s: 2, cost: 0.03 });
            assert.deepEqual((await db.query(others)).rows, before);
            await db.query("UPDATE public.model_catalog SET provider_cost_per_unit = 0.05 WHERE id = 'seedream-4'");
            await db.query('SAVEPOINT drift');
            await assert.rejects(db.query(sql), /Expected one seedream-4\/fal row/);
            await db.query('ROLLBACK TO SAVEPOINT drift');
            assert.equal((await db.query("SELECT provider_cost_per_unit::float AS cost FROM public.model_catalog WHERE id = 'seedream-4'")).rows[0].cost, 0.05);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
