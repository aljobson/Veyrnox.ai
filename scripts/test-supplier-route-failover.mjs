#!/usr/bin/env node
// ADR-0256 phase 2a (migration 0373): job_route_failover and record_attempt_supplier
// against the full migration replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];

let scenarioNo = 0;
async function scenario(name, run) {
    const tag = `s${++scenarioNo}`;
    await c.query('BEGIN');
    // 0388 puts a real standby Crun route on this scratch offer at priority 2: clear the non-primary rows so each scenario
    // builds its own, inside the transaction that is rolled back.
    await c.query(`DELETE FROM public.model_routes WHERE model_id = 'nano-banana-kie' AND priority > 1`);
    try {
        const { id: userId } = await one(`INSERT INTO public.users (id, auth_id, email) VALUES (gen_random_uuid(), gen_random_uuid()::text, 'route-test@example.test') RETURNING id`);
        const { id: own } = await one(`SELECT id FROM public.model_routes WHERE model_id = 'nano-banana-kie' AND priority = 1`);
        assert.ok(own, 'the backfilled primary route exists');
        const route = async (priority, state, cost, parity, extra = {}) => (await one(
            `INSERT INTO public.model_routes (model_id, supplier, endpoint, cost_per_unit, priority, state, provenance, parity_record, margin_waiver_note, breaker_opened_at)
             VALUES ('nano-banana-kie', $1, $2, $3, $4, $5, 'licensed_reseller', $6, $7, $8) RETURNING id`,
            [extra.supplier || 'grsai', `test:${tag}:${priority}`, cost, priority, state, parity, extra.waiver || null, extra.breaker || null])).id;
        let n = 0;
        const job = async (state = 'DEBITED') => (await one(
            `INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state) VALUES ($1, $2, 'nano-banana-kie', 2, '{}', $3) RETURNING id`,
            [userId, `route-test-${tag}-${++n}-0000`, state])).id;
        const hop = async (jobId, from, to) => (await one(`SELECT public.job_route_failover($1, $2, $3) AS r`, [jobId, from, to])).r;
        await run({ own, route, job, hop, userId });
        console.log(`ok - ${name}`);
    } finally {
        await c.query('ROLLBACK');
    }
}

await scenario('a hop records the failure, opens attempt 2 and reserves the new supplier', async ({ own, route, job, hop, userId }) => {
    const next = await route(2, 'active', 0.027, 'probe');
    const jobId = await job();
    const r = await hop(jobId, own, next);
    assert.equal(r.ok, true);
    assert.equal(r.attempt_no, 2);
    assert.equal(r.route.supplier, 'grsai');
    const rows = (await c.query(`SELECT attempt_no, outcome, cost_snapshot::float AS cost, supplier_job_id FROM public.job_attempts WHERE job_id = $1 ORDER BY attempt_no`, [jobId])).rows;
    assert.deepEqual(rows.map((x) => [x.attempt_no, x.outcome, x.supplier_job_id]), [[1, 'failed', null], [2, null, null]]);
    assert.equal(rows[0].cost, 0, 'a refused attempt costs nothing');
    const spent = await one(`SELECT count(*)::int AS n FROM public.provider_spend_reservations WHERE user_id = $1 AND effect_key LIKE '%:a2'`, [userId]);
    assert.equal(spent.n, 1, 'the new supplier budget was reserved once');
});

await scenario('a route is never tried twice and a standby, unproven or broken route is refused', async ({ own, route, job, hop }) => {
    const second = await route(2, 'active', 0.027, 'probe');
    const standby = await route(3, 'standby', 0.02, null);
    const jobId = await job();
    assert.equal((await hop(jobId, own, standby)).code, 'route_not_eligible');
    assert.equal((await hop(jobId, own, second)).ok, true);
    assert.equal((await hop(jobId, second, own)).code, 'route_already_tried');
});

await scenario('only a job that is still DEBITED can hop; an accepted attempt cannot', async ({ own, route, job, hop }) => {
    const next = await route(2, 'active', 0.027, 'probe');
    const submitted = await job('SUBMITTED');
    assert.equal((await hop(submitted, own, next)).code, 'job_not_failable_over');
    const jobId = await job();
    await c.query(`INSERT INTO public.job_attempts (job_id, attempt_no, route_id, supplier_job_id, outcome, cost_snapshot) VALUES ($1, 1, $2, 'task_1', 'submitted', 0.02)`, [jobId, own]);
    assert.equal((await hop(jobId, own, next)).code, 'attempt_was_accepted');
});

await scenario('the margin floor holds unless a waiver is recorded; a missing next route only closes the attempt', async ({ own, route, job, hop }) => {
    const dear = await route(2, 'active', 1.0, 'probe');
    const waived = await route(3, 'active', 1.0, 'probe', { waiver: 'resilience only', supplier: 'byteplus' });
    const jobId = await job();
    assert.equal((await hop(jobId, own, dear)).code, 'route_below_margin_floor');
    assert.equal((await hop(jobId, own, waived)).ok, true);
    const closeOnly = await job();
    assert.deepEqual(await hop(closeOnly, own, null), { ok: true, attempt_no: null });
    assert.equal((await one(`SELECT outcome FROM public.job_attempts WHERE job_id = $1`, [closeOnly])).outcome, 'failed');
});

await scenario('record_attempt_supplier stores the new supplier id only when the job carries it', async ({ own, route, job, hop }) => {
    const next = await route(2, 'active', 0.027, 'probe');
    const jobId = await job();
    assert.equal((await hop(jobId, own, next)).ok, true);
    await c.query(`UPDATE public.jobs SET provider_job_id = 'task_77' WHERE id = $1`, [jobId]);
    assert.equal((await one(`SELECT public.record_attempt_supplier($1, 2, 'WRONG') AS r`, [jobId])).r.code, 'supplier_job_mismatch');
    assert.equal((await one(`SELECT public.record_attempt_supplier($1, 2, 'task_77') AS r`, [jobId])).r.updated, 1);
    assert.equal((await one(`SELECT public.record_attempt_supplier($1, 2, 'task_77') AS r`, [jobId])).r.updated, 0);
    const a = await one(`SELECT outcome, supplier_job_id FROM public.job_attempts WHERE job_id = $1 AND attempt_no = 2`, [jobId]);
    assert.deepEqual(a, { outcome: 'submitted', supplier_job_id: 'task_77' });
});

await scenario('a hop past a supplier spend limit is refused and writes no attempt', async ({ own, route, job, hop }) => {
    const next = await route(2, 'active', 0.027, 'probe');
    const jobId = await job();
    await c.query(`UPDATE public.provider_spend_policy SET admission_open = false`);
    const r = await hop(jobId, own, next);
    assert.equal(r.code, 'spend_limit');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.job_attempts WHERE job_id = $1 AND attempt_no = 2`, [jobId])).n, 0);
});


// Migrations 0379 and 0380: Veo 3.1 Lite has Crun first at 5 credits and kie as the active second route.
await c.query('BEGIN');
try {
    const { id: userId } = await one(`INSERT INTO public.users (id, auth_id, email) VALUES (gen_random_uuid(), gen_random_uuid()::text, 'crun-hop@example.test') RETURNING id`);
    const kie = (await one(`SELECT id, priority, state FROM public.model_routes WHERE model_id = 'veo-3.1-lite-kie' AND supplier = 'kie'`));
    const crun = (await one(`SELECT id, priority, state FROM public.model_routes WHERE model_id = 'veo-3.1-lite-kie' AND supplier = 'crun'`));
    assert.deepEqual([crun.priority, crun.state, kie.priority, kie.state], [1, 'active', 2, 'active'], 'Crun first, kie second, both active');
    assert.equal((await one(`SELECT credits_5s FROM public.model_catalog WHERE id = 'veo-3.1-lite-kie'`)).credits_5s, 5);
    const active = (await c.query(`SELECT endpoint FROM public.model_routes WHERE supplier = 'crun' AND state = 'active' ORDER BY endpoint`)).rows.map((r) => r.endpoint);
    assert.deepEqual(active, ['crun:bytedance/seedance2-0-fast-t2v', 'crun:google/veo3-1-fast-t2v', 'crun:google/veo3-1-lite-t2v'], 'only the proven routes are active (Veo Lite 0379, Veo Fast 0386, Seedance Fast 0387)');
    // A job debited at the new 5 credits cannot hop onto kie ($0.15 is above 5 x 0.01796) without a waiver,
    // so a job Crun refuses outright refunds instead of selling below the floor.
    const fresh = (await one(`INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state) VALUES ($1, 'crun-hop-test-0001', 'veo-3.1-lite-kie', 5, '{}', 'DEBITED') RETURNING id`, [userId])).id;
    assert.equal((await one(`SELECT public.job_route_failover($1, $2, $3) AS r`, [fresh, crun.id, kie.id])).r.code, 'route_below_margin_floor');
    console.log('ok - Crun is first for Veo Lite at 5 credits; a hop onto kie needs a margin waiver');
} finally {
    await c.query('ROLLBACK');
}

await c.end();
console.log('supplier route failover: all scenarios passed');
