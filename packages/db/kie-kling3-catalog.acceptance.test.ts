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

test('Kling activation is replay-safe, preserves other models and refuses missing or repriced candidates',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query("DELETE FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'");
            const activation = await read('0154_kie_kling3_i2v_activation.sql');
            await db.query('SAVEPOINT missing_candidate');
            await assert.rejects(db.query(activation), /Expected one verified kie Kling 3.0 row/);
            await db.query('ROLLBACK TO SAVEPOINT missing_candidate');
            await db.query(await read('0152_kie_kling3_i2v_staged.sql'));
            const others = (await db.query("SELECT * FROM public.model_catalog WHERE id <> 'kling-3.0-i2v-kie' ORDER BY id")).rows;
            const original = (await db.query("SELECT * FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'")).rows[0];
            await db.query(activation);
            await db.query(activation);
            const activated = (await db.query("SELECT * FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'")).rows[0];
            assert.equal(activated.active, true);
            const { active: oldActive, updated_at: oldTime, ...before } = original;
            const { active: newActive, updated_at: newTime, ...after } = activated;
            assert.deepEqual(after, before);
            assert.deepEqual((await db.query("SELECT * FROM public.model_catalog WHERE id <> 'kling-3.0-i2v-kie' ORDER BY id")).rows, others);
            await db.query("UPDATE public.model_catalog SET active = false, credits_5s = 3 WHERE id = 'kling-3.0-i2v-kie'");
            await db.query('SAVEPOINT repriced_candidate');
            await assert.rejects(db.query(activation), /Expected one verified kie Kling 3.0 row/);
            await db.query('ROLLBACK TO SAVEPOINT repriced_candidate');
            assert.equal((await db.query("SELECT active FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie'")).rows[0].active, false);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
