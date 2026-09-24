import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
test('GrsAI activation swaps only the verified route, replays safely and fails atomically',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
        try {
            await db.query('BEGIN');
            for (const name of ['0029_cost_unit_and_deactivate_seedance.sql', '0105_kie_twins_staged.sql', '0111_grsai_nano_pro_staged.sql']) {
                await db.query(await read(name));
            }
            await db.query("UPDATE public.model_catalog SET active = false WHERE id = 'nano-banana-pro-grsai'");
            await db.query("UPDATE public.model_catalog SET active = true WHERE id = 'nano-banana-pro-kie'");
            const snapshot = async () => (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
            const before = await snapshot();
            const migration = await read('0124_activate_grsai_nano_pro.sql');
            await db.query(migration);
            const after = await snapshot();
            await db.query(migration);
            assert.deepEqual(await snapshot(), after, 'replay has no additional effects');
            const grs = after.find((r) => r.id === 'nano-banana-pro-grsai');
            assert.equal(grs.active, true);
            assert.equal(grs.name, 'Nano Banana Pro');
            assert.equal(grs.credits_5s, 2);
            assert.equal(Number(grs.provider_cost_per_unit), 0.0271);
            assert.equal(after.find((r) => r.id === 'nano-banana-pro-kie').active, false);
            const unrelated = (rows: any[]) => rows.filter((r) => !['nano-banana-pro-grsai', 'nano-banana-pro-kie'].includes(r.id));
            assert.deepEqual(unrelated(after), unrelated(before), 'other image/edit models are untouched');

            // A missing retirement target must roll back activation too.
            await db.query('SAVEPOINT missing_target');
            await db.query("UPDATE public.model_catalog SET active = false WHERE id = 'nano-banana-pro-grsai'");
            await db.query("DELETE FROM public.model_catalog WHERE id = 'nano-banana-pro-kie'");
            await db.query('SAVEPOINT before_activation');
            await assert.rejects(db.query(migration), /Expected one kie Nano Banana Pro row/);
            await db.query('ROLLBACK TO SAVEPOINT before_activation');
            assert.equal((await db.query("SELECT active FROM public.model_catalog WHERE id = 'nano-banana-pro-grsai'")).rows[0].active, false);
            await db.query('ROLLBACK TO SAVEPOINT missing_target');

            // Endpoint/cost drift must not turn an unverified route on.
            await db.query("UPDATE public.model_catalog SET provider_cost_per_unit = 0.09, active = false WHERE id = 'nano-banana-pro-grsai'");
            await db.query('SAVEPOINT changed_cost');
            await assert.rejects(db.query(migration), /Expected one verified GrsAI Nano Banana Pro row/);
            await db.query('ROLLBACK TO SAVEPOINT changed_cost');
            assert.equal((await db.query("SELECT active FROM public.model_catalog WHERE id = 'nano-banana-pro-grsai'")).rows[0].active, false);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
