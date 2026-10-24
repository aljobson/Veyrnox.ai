#!/usr/bin/env node
// ADR-0256 phase 3a (migration 0376): the per-route circuit breaker against the full migration
// replay (ledger-tests.yml). Every fixture is rolled back.
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
    // 0388 puts a real standby Crun route on this scratch offer at priority 2: clear the non-primary rows so each scenario
    // builds its own, inside the transaction that is rolled back.
    await c.query(`DELETE FROM public.model_routes WHERE model_id = 'nano-banana-kie' AND priority > 1`);
    try {
        const { id: userId } = await one(`INSERT INTO public.users (id, auth_id, email) VALUES (gen_random_uuid(), gen_random_uuid()::text, 'breaker-test@example.test') RETURNING id`);
        const { id: own } = await one(`SELECT id FROM public.model_routes WHERE model_id = $1 AND priority = 1`, [MODEL]);
        let n = 0;
        const job = async () => (await one(
            `INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state) VALUES ($1, $2, $3, 2, '{}', 'DEBITED') RETURNING id`,
            [userId, `breaker-test-${++n}-0000-${name.length}`, MODEL])).id;
        const refuse = async (route) => one(`SELECT public.job_route_failover($1, $2, NULL) AS r`, [await job(), route]); // a provable refusal at submit
        const second = (await one(
            `INSERT INTO public.model_routes (model_id, supplier, endpoint, cost_per_unit, priority, state, provenance, parity_record)
             VALUES ($1, 'grsai', 'test:breaker', 0.015, 2, 'active', 'licensed_reseller', 'probe') RETURNING id`, [MODEL])).id;
        const state = async (id) => one(`SELECT consecutive_failures AS fails, breaker_opened_at IS NOT NULL AS open FROM public.model_routes WHERE id = $1`, [id]);
        const hopTo = async (id) => { const j = await job(); await c.query(`INSERT INTO public.job_attempts (job_id, attempt_no, route_id, outcome, cost_snapshot) VALUES ($1, 1, $2, 'failed', 0)`, [j, own]);
            return (await one(`SELECT public.job_route_failover($1, $2, $3) AS r`, [j, own, id])).r; };
        const supplierJob = async (route, supplierJobId) => { const j = await job();
            await c.query(`UPDATE public.jobs SET provider_job_id = $2 WHERE id = $1`, [j, supplierJobId]);
            await c.query(`INSERT INTO public.job_attempts (job_id, attempt_no, route_id, supplier_job_id, outcome, cost_snapshot) VALUES ($1, 1, $2, $3, 'submitted', 0.01)`, [j, route, supplierJobId]); return j; };
        await run({ own, second, refuse, state, hopTo, supplierJob, newJob: job });
        console.log(`ok - ${name}`);
    } finally {
        await c.query('ROLLBACK');
    }
}

await scenario('five failures in a row trip the breaker; four do not', async ({ second, refuse, state }) => {
    for (let i = 0; i < 4; i += 1) await refuse(second);
    assert.deepEqual(await state(second), { fails: 4, open: false });
    await refuse(second);
    assert.deepEqual(await state(second), { fails: 5, open: true });
});

await scenario('a completed job closes the breaker and resets the count; a failed one counts once', async ({ own, second, refuse, state, supplierJob }) => {
    for (let i = 0; i < 5; i += 1) await refuse(second);
    assert.equal((await state(second)).open, true);
    await supplierJob(second, 'task_ok');
    assert.equal((await one(`SELECT public.mark_job_attempt_outcome('grsai', 'task_ok', 'completed') AS r`)).r.updated, 1);
    assert.deepEqual(await state(second), { fails: 0, open: false });
    await supplierJob(own, 'task_bad');
    assert.equal((await one(`SELECT public.mark_job_attempt_outcome('kie', 'task_bad', 'failed') AS r`)).r.updated, 1);
    assert.equal((await one(`SELECT public.mark_job_attempt_outcome('kie', 'task_bad', 'failed') AS r`)).r.updated, 0);
    assert.equal((await state(own)).fails, 1);
});

await scenario('closing the same attempt twice counts one failure', async ({ second, state, newJob }) => {
    const j = await newJob();
    await c.query(`SELECT public.job_route_failover($1, $2, NULL)`, [j, second]);
    await c.query(`SELECT public.job_route_failover($1, $2, NULL)`, [j, second]);
    assert.equal((await state(second)).fails, 1);
});

await scenario('an open breaker blocks a hop for ten minutes, then the route is a probe', async ({ second, refuse, hopTo, state }) => {
    for (let i = 0; i < 5; i += 1) await refuse(second);
    assert.equal((await hopTo(second)).code, 'route_not_eligible');
    await c.query(`UPDATE public.model_routes SET breaker_opened_at = now() - interval '11 minutes' WHERE id = $1`, [second]);
    assert.equal((await hopTo(second)).ok, true, 'after the cooldown the route may take a probe job');
    await refuse(second);
    const s = await state(second);
    assert.equal(s.open, true);
    assert.equal((await hopTo(second)).code, 'route_not_eligible', 'a failed probe re-opens it for another ten minutes');
});

await c.end();
console.log('supplier route breaker: all scenarios passed');
