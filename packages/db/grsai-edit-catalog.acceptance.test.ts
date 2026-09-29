import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
test('GrsAI edit activation replays safely, preserves other rows and rejects catalogue drift',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'isolated database only');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query(await read('0086_nano_banana_pro.sql'));
            await db.query(await read('0111_grsai_nano_pro_staged.sql'));
            await db.query("UPDATE public.model_catalog SET active=true WHERE id IN ('nano-banana-pro-edit','nano-banana-pro-grsai')");
            await db.query(await read('0165_grsai_nano_pro_edit_staged.sql'));
            const before = (await db.query("SELECT * FROM public.model_catalog WHERE id <> 'nano-banana-pro-edit-grsai' ORDER BY id")).rows;
            const activation = await read('0166_grsai_nano_pro_edit_activation.sql');
            await db.query(activation);
            await db.query(activation);
            const flux = (await db.query("SELECT active, credits_5s FROM public.model_catalog WHERE id='nano-banana-pro-edit-grsai'")).rows[0];
            assert.deepEqual(flux, { active: true, credits_5s: 2 });
            assert.deepEqual((await db.query("SELECT * FROM public.model_catalog WHERE id <> 'nano-banana-pro-edit-grsai' ORDER BY id")).rows, before);
            for (const mutation of [
                "DELETE FROM public.model_catalog WHERE id='nano-banana-pro-edit-grsai'",
                "UPDATE public.model_catalog SET credits_5s=1 WHERE id='nano-banana-pro-edit-grsai'",
                "UPDATE public.model_catalog SET provider_endpoint='unexpected' WHERE id='nano-banana-pro-edit-grsai'",
                "UPDATE public.model_catalog SET provider_cost_per_unit=0.035 WHERE id='nano-banana-pro-edit-grsai'",
            ]) {
                await db.query('SAVEPOINT drift');
                await db.query(mutation);
                await assert.rejects(db.query(activation), /Expected one verified GrsAI Nano Pro Edit/);
                await db.query('ROLLBACK TO SAVEPOINT drift');
            }
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
