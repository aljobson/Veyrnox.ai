#!/usr/bin/env node
// ADR-0256 phase 4a (migration 0374): model_route_reorder against the full migration replay
// (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const MODEL = 'nano-banana-kie';

async function scenario(name, run) {
    await c.query('BEGIN');
    try {
        const { id: own } = await one(`SELECT id FROM public.model_routes WHERE model_id = $1 AND priority = 1`, [MODEL]);
        const add = async (priority, { supplier = 'grsai', cost = 0.015, state = 'active', provenance = 'licensed_reseller', parity = 'probe', breaker = null } = {}) =>
            (await one(`INSERT INTO public.model_routes (model_id, supplier, endpoint, cost_per_unit, priority, state, provenance, parity_record, breaker_opened_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [MODEL, supplier, `test:${supplier}:${priority}`, cost, priority, state, provenance, parity, breaker])).id;
        const reorder = async (ids, note = 'owner approved the new order') => (await one(`SELECT public.model_route_reorder($1, $2::uuid[], $3) AS r`, [MODEL, ids, note])).r;
        const order = async () => (await c.query(`SELECT id, supplier, state FROM public.model_routes WHERE model_id = $1 ORDER BY priority`, [MODEL])).rows;
        await run({ own, add, reorder, order });
        console.log(`ok - ${name}`);
    } finally {
        await c.query('ROLLBACK');
    }
}

await scenario('a reorder renumbers the routes, points the catalog at the new first route and logs it', async ({ own, add, reorder, order }) => {
    const second = await add(2);
    const standby = await add(3, { supplier: 'fal', state: 'standby', provenance: 'unverified', parity: null });
    const r = await reorder([second, own]);
    assert.deepEqual(r, { ok: true, first_supplier: 'grsai', first_endpoint: 'test:grsai:2' });
    assert.deepEqual((await order()).map((x) => x.id), [second, own, standby]);
    const cat = await one(`SELECT provider, provider_endpoint, provider_cost_per_unit::float AS cost FROM public.model_catalog WHERE id = $1`, [MODEL]);
    assert.deepEqual(cat, { provider: 'grsai', provider_endpoint: 'test:grsai:2', cost: 0.015 });
    const log = await one(`SELECT old_order, new_order, note FROM public.model_route_order_changes WHERE model_id = $1`, [MODEL]);
    assert.deepEqual(log.old_order, [own, second, standby]);
    assert.deepEqual(log.new_order, [second, own, standby]);
    await assert.rejects(() => c.query(`UPDATE public.model_route_order_changes SET note = 'edited'`), /append-only/);
});

await scenario('the order must name every active route, once, with a note', async ({ own, add, reorder }) => {
    const second = await add(2);
    assert.equal((await reorder([own])).code, 'order_must_list_every_active_route');
    assert.equal((await reorder([own, own, second])).code, 'order_must_list_every_active_route');
    assert.equal((await reorder([second, own], 'x')).code, 'note_required');
    assert.equal((await one(`SELECT public.model_route_reorder('no-such-model', ARRAY[]::uuid[], 'a note') AS r`)).r.code, 'model_not_found');
});

await scenario('an unverified route may only be last, and a tripped route cannot be ordered', async ({ own, add, reorder }) => {
    const crun = await add(2, { supplier: 'crun', provenance: 'unverified' });
    assert.equal((await reorder([crun, own])).code, 'unverified_route_must_be_last');
    assert.equal((await reorder([own, crun])).ok, true);
    await c.query(`UPDATE public.model_routes SET breaker_opened_at = now() WHERE id = $1`, [crun]);
    assert.equal((await reorder([crun, own])).code, 'route_not_eligible');
});

await scenario('a first route above the margin floor is refused by the catalog trigger and nothing changes', async ({ own, add, reorder, order }) => {
    const dear = await add(2, { supplier: 'byteplus', cost: 1.0 });
    const before = (await order()).map((x) => x.id);
    await c.query('SAVEPOINT s');
    await assert.rejects(() => reorder([dear, own]), /margin|floor|cost|violates|price/i);
    await c.query('ROLLBACK TO SAVEPOINT s');
    assert.deepEqual((await order()).map((x) => x.id), before);
});

await scenario('an offer has at most three routes', async ({ add }) => {
    await add(2); await add(3, { supplier: 'fal' });
    await c.query('SAVEPOINT s');
    await assert.rejects(() => add(4, { supplier: 'byteplus' }), /at most three/);
    await c.query('ROLLBACK TO SAVEPOINT s');
});

await c.end();
console.log('supplier route reorder: all scenarios passed');
