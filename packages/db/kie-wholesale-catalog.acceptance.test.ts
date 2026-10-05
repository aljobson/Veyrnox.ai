import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
test('wholesale staging is inactive, replay-safe and preserves existing routes',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'isolated database only');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            const ids = ['elevenlabs-dialogue-kie', 'flux-2-pro-1k-kie'];
            await db.query('DELETE FROM public.model_catalog WHERE id = ANY($1)', [ids]);
            const before = (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
            const migration = await read('0159_kie_dialogue_flux_staged.sql');
            await db.query(migration);
            await db.query(migration);
            const rows = (await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [ids])).rows;
            assert.equal(rows.length, 2);
            assert.deepEqual(rows.map((r: any) => [r.id, r.provider_endpoint, Number(r.provider_cost_per_unit), r.credits_5s]), [
                [ids[0], 'market:elevenlabs/text-to-dialogue-v3', 0.07, 5],
                [ids[1], 'market:flux-2/pro-text-to-image', 0.025, 2],
            ]);
            for (const row of rows) {
                assert.equal(row.active, false);
                assert.equal(row.provider, 'kie');
                assert.equal(row.cost_unit, 'per_generation');
                assert.ok(row.credits_5s >= Math.ceil(Number(row.provider_cost_per_unit) / 0.01796));
            }
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE NOT (id = ANY($1)) ORDER BY id', [ids])).rows, before);
            await db.query('UPDATE public.model_catalog SET active = true, credits_5s = 10 WHERE id = ANY($1)', [ids]);
            await db.query(migration);
            const later = (await db.query('SELECT active, credits_5s FROM public.model_catalog WHERE id = ANY($1)', [ids])).rows;
            assert.deepEqual(later, [{ active: true, credits_5s: 10 }, { active: true, credits_5s: 10 }]);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });

test('Flux activation replays safely, preserves other rows and rejects catalogue drift',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'isolated database only');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
            await db.query(await read('0159_kie_dialogue_flux_staged.sql'));
            const before = (await db.query("SELECT * FROM public.model_catalog WHERE id <> 'flux-2-pro-1k-kie' ORDER BY id")).rows;
            const activation = await read('0162_kie_flux_1k_activation.sql');
            await db.query(activation);
            await db.query(activation);
            const flux = (await db.query("SELECT active, credits_5s FROM public.model_catalog WHERE id='flux-2-pro-1k-kie'")).rows[0];
            assert.deepEqual(flux, { active: true, credits_5s: 2 });
            assert.deepEqual((await db.query("SELECT * FROM public.model_catalog WHERE id <> 'flux-2-pro-1k-kie' ORDER BY id")).rows, before);
            for (const mutation of [
                "DELETE FROM public.model_catalog WHERE id='flux-2-pro-1k-kie'",
                "UPDATE public.model_catalog SET credits_5s=1 WHERE id='flux-2-pro-1k-kie'",
                "UPDATE public.model_catalog SET provider_endpoint='unexpected' WHERE id='flux-2-pro-1k-kie'",
                "UPDATE public.model_catalog SET provider_cost_per_unit=0.035 WHERE id='flux-2-pro-1k-kie'",
            ]) {
                await db.query('SAVEPOINT drift');
                await db.query(mutation);
                await assert.rejects(db.query(activation), /Expected one verified kie Flux/);
                await db.query('ROLLBACK TO SAVEPOINT drift');
            }
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
