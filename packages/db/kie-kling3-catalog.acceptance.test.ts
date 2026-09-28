/** Staged pricing row: inactive, conservative cost and harmless replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
test('Kling 3.0 staging preserves other catalog rows and does not override later activation',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            // CI's acceptance database starts with the base schema only.
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query("DELETE FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'");
            const before = (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
            const migration = await read('0152_kie_kling3_i2v_staged.sql');
            await db.query(migration);
            await db.query(migration);
            const { rows: [row] } = await db.query("SELECT * FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'");
            assert.equal(row.provider, 'kie');
            assert.equal(row.provider_endpoint, 'market:kling-3.0/video');
            assert.equal(row.active, false);
            assert.equal(row.gated_flag, false);
            assert.equal(row.cost_unit, 'per_second');
            assert.equal(Number(row.billing_seconds), 5);
            assert.equal(Number(row.provider_cost_per_unit), 0.45);
            assert.equal(row.modality, 'image-to-video');
            assert.equal(row.credits_5s, 28);
            assert.ok(row.credits_5s >= Math.ceil(Number(row.provider_cost_per_unit) / 0.01796));
            assert.deepEqual((await db.query("SELECT * FROM public.model_catalog WHERE id <> 'kling-3.0-i2v-kie' ORDER BY id")).rows, before);
            await db.query("UPDATE public.model_catalog SET active = true, credits_5s = 3 WHERE id = 'kling-3.0-i2v-kie'");
            await db.query(migration);
            const { rows: [later] } = await db.query("SELECT active, credits_5s FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'");
            assert.deepEqual(later, { active: true, credits_5s: 3 });
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
