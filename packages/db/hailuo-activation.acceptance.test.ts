/** Verify the catalog swap is atomic, replay-safe and refuses pricing drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
test('Hailuo activation swaps only the verified pair and aborts on a missing twin',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'isolated test database only');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
        try {
            await db.query('BEGIN');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query(await read('0107_kie_twins_hailuo_tts_seedream_staged.sql'));
            await db.query(`INSERT INTO public.model_catalog
                (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,active)
                VALUES ('minimax-hailuo-02','MiniMax Hailuo 02','fal','fal-ai/minimax/hailuo-02/standard/text-to-video',
                'text-to-video',17,0.27,'per_second',6,true) ON CONFLICT (id) DO NOTHING`);
            const others = "SELECT * FROM public.model_catalog WHERE id NOT IN ('hailuo-02-kie','minimax-hailuo-02') ORDER BY id";
            const before = (await db.query(others)).rows;
            const sql = await read('0112_activate_kie_hailuo.sql');
            await db.query(sql);
            await db.query(sql);
            const pair = (await db.query("SELECT id, name, active, credits_5s FROM public.model_catalog WHERE id IN ('hailuo-02-kie','minimax-hailuo-02') ORDER BY id")).rows;
            assert.deepEqual(pair, [
                { id: 'hailuo-02-kie', name: 'MiniMax Hailuo 02', active: true, credits_5s: 10 },
                { id: 'minimax-hailuo-02', name: 'MiniMax Hailuo 02', active: false, credits_5s: 17 },
            ]);
            assert.deepEqual((await db.query(others)).rows, before);
            await db.query("UPDATE public.model_catalog SET active = false WHERE id = 'hailuo-02-kie'");
            await db.query("DELETE FROM public.model_catalog WHERE id = 'minimax-hailuo-02'");
            await db.query('SAVEPOINT missing_twin');
            await assert.rejects(db.query(sql), /Expected one minimax-hailuo-02\/fal row/);
            await db.query('ROLLBACK TO SAVEPOINT missing_twin');
            assert.equal((await db.query("SELECT active FROM public.model_catalog WHERE id = 'hailuo-02-kie'")).rows[0].active, false);
            await db.query("UPDATE public.model_catalog SET provider_cost_per_unit = 0.20 WHERE id = 'hailuo-02-kie'");
            await db.query('SAVEPOINT changed_cost');
            await assert.rejects(db.query(sql), /Expected one verified hailuo-02-kie row/);
            await db.query('ROLLBACK TO SAVEPOINT changed_cost');
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
