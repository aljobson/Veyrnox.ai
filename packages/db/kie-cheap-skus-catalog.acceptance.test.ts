/** Run only against a throwaway local database; every fixture rolls back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const expected = [
    ['kling-3.0-i2v-720p-kie', 'market:kling-3.0/video-std', 'image-to-video', 22, 0.35, 'per_second', 5],
    ['seedance-2.0-mini-kie', 'market:bytedance/seedance-2-mini', 'text-to-video', 13, 0.205, 'per_second', 5],
    ['wan-2.6-flash-i2v-kie', 'market:wan/2-6-flash-image-to-video', 'image-to-video', 7, 0.1, 'per_generation', null],
    ['seedream-5-flash-kie', 'market:seedream/5-flash-text-to-image', 'text-to-image', 1, 0.0162, 'per_generation', null],
] as const;

test('four inactive kie candidates insert once, preserve later prices/state and reject conflicting identities',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname), 'use a throwaway local database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const read = (name: string) => readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            // Base-schema acceptance needs the columns, without changing existing rows.
            await db.query("ALTER TABLE public.model_catalog ADD COLUMN IF NOT EXISTS cost_unit TEXT NOT NULL DEFAULT 'per_generation', ADD COLUMN IF NOT EXISTS billing_seconds NUMERIC(6,2)");
            const ids = expected.map(row => row[0]);
            await db.query('DELETE FROM public.model_catalog WHERE id = ANY($1)', [ids]);
            const others = async () => (await db.query('SELECT * FROM public.model_catalog WHERE NOT (id = ANY($1)) ORDER BY id', [ids])).rows;
            const before = await others();
            const migration = await read('0358_kie_cheap_skus_staged.sql');
            await db.query(migration);
            const first = (await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [ids])).rows;
            await db.query(migration);
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [ids])).rows, first);
            for (const [id, endpoint, modality, credits, cost, unit, seconds] of expected) {
                const row = first.find(row => row.id === id);
                assert.ok(row);
                assert.deepEqual([row.provider, row.provider_endpoint, row.modality, row.active, row.gated_flag], ['kie', endpoint, modality, false, false]);
                assert.deepEqual([row.credits_5s, Number(row.provider_cost_per_unit), row.cost_unit, row.billing_seconds === null ? null : Number(row.billing_seconds)], [credits, cost, unit, seconds]);
                assert.ok(credits >= Math.ceil(cost / 0.01796));
                const reservation = await db.query('SELECT provider_cost_per_unit * GREATEST(1, CEIL($2::numeric / credits_5s)) AS cost FROM public.model_catalog WHERE id = $1', [id, credits]);
                assert.equal(Number(reservation.rows[0].cost), cost);
                // Full replay also exercises the real reservation calculator from 0327.
                const fn = await db.query("SELECT to_regprocedure('private.provider_spend_model_cost(text,jsonb,integer)') AS name");
                if (fn.rows[0].name) {
                    const quote = await db.query("SELECT * FROM private.provider_spend_model_cost($1, '{}'::jsonb, $2)", [id, credits]);
                    assert.equal(Number(quote.rows[0].cost_microusd), Math.round(cost * 1e6));
                }
            }
            assert.deepEqual(await others(), before);
            await db.query('UPDATE public.model_catalog SET active = true, gated_flag = true, credits_5s = 3, provider_cost_per_unit = 0.7777 WHERE id = ANY($1)', [ids]);
            const later = (await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [ids])).rows;
            await db.query(migration);
            await db.query(migration);
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [ids])).rows, later);
            assert.deepEqual(await others(), before);
            for (const [query, value] of [
                ['UPDATE public.model_catalog SET provider = $1 WHERE id = $2', 'fal'],
                ['UPDATE public.model_catalog SET provider_endpoint = $1 WHERE id = $2', 'market:wrong/model'],
                ['UPDATE public.model_catalog SET modality = $1 WHERE id = $2', 'text-to-image'],
            ]) {
                await db.query('SAVEPOINT identity_conflict');
                await db.query(query, [value, ids[0]]);
                await assert.rejects(db.query(migration), /Conflicting staged kie identity/);
                await db.query('ROLLBACK TO SAVEPOINT identity_conflict');
            }
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });
