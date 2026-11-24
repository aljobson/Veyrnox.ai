#!/usr/bin/env node
// ADR-0256 phase 3a (migration 0376): the per-route circuit breaker against the full migration
// replay (ledger-tests.yml). Fixtures roll back except the concurrency fixture, which is restored in finally.
import assert from 'node:assert/strict';
import pg from 'pg';
import { submitWithFailover } from '../lib/supplierRoutesFailover.js';
import { submitCrunAtBoundary } from '../lib/crunSubmitBoundary.js';
import { resolveRouteSet, recordFirstAttempt, markAttemptOutcome } from '../lib/supplierRoutesDispatch.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const MODEL = 'nano-banana-kie';
const CRUN_ENDPOINT = 'crun:test/breaker';
const SUNO_ENDPOINT = 'crun:suno/music-generate';
const pgRpc = async (fn, args) => {
    const keys = Object.keys(args);
    const named = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
    return (await one(`SELECT public.${fn}(${named}) AS r`, keys.map((key) => args[key]))).r;
};
const accepted = { ok: true, providerJobId: 'task_accepted' };
const routeDown = { ok: false, outcome: 'rejected', error: 'provider_route_unavailable', errorCode: 'provider_route_unavailable', scope: 'route' };
const typedRefusal = (errorCode) => ({ ok: false, outcome: 'rejected', error: errorCode, errorCode, scope: 'rejected' });

async function scenario(name, run) {
    await c.query('BEGIN');
    // Migrations 0388 and 0389 gave this scratch offer a Crun route, put Crun first and cut it to 1 credit. Each scenario starts
    // from the original kie-first, 2-credit shape and builds its own routes, inside the transaction that is rolled back.
    await c.query(`DELETE FROM public.model_routes WHERE model_id = 'nano-banana-kie' AND supplier = 'crun';
        UPDATE public.model_routes SET priority = 1 WHERE model_id = 'nano-banana-kie' AND supplier = 'kie';
        UPDATE public.model_catalog SET provider = 'kie', provider_endpoint = 'market:google/nano-banana', provider_cost_per_unit = 0.0200, credits_5s = 2
         WHERE id = 'nano-banana-kie';
        DELETE FROM public.model_routes WHERE model_id = 'nano-banana-kie' AND priority > 1;`);
    try {
        const { id: userId } = await one(`INSERT INTO public.users (id, auth_id, email) VALUES (gen_random_uuid(), gen_random_uuid()::text, 'breaker-test@example.test') RETURNING id`);
        const { id: own } = await one(`SELECT id FROM public.model_routes WHERE model_id = $1 AND priority = 1`, [MODEL]);
        let n = 0;
        const job = async (modelId = MODEL) => (await one(
            `INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state) VALUES ($1, $2, $3, 2, '{}', 'DEBITED') RETURNING id`,
            [userId, `breaker-test-${++n}-0000-${name.length}`, modelId])).id;
        const refuse = async (route) => one(`SELECT public.job_route_failover($1, $2, NULL) AS r`, [await job(), route]); // a provable refusal at submit
        const second = (await one(
            `INSERT INTO public.model_routes (model_id, supplier, endpoint, cost_per_unit, priority, state, provenance, parity_record)
             VALUES ($1, 'grsai', 'test:breaker', 0.015, 2, 'active', 'licensed_reseller', 'probe') RETURNING id`, [MODEL])).id;
        const state = async (id) => one(`SELECT consecutive_failures AS fails, breaker_opened_at IS NOT NULL AS open FROM public.model_routes WHERE id = $1`, [id]);
        const hopTo = async (id) => { const j = await job(); await c.query(`INSERT INTO public.job_attempts (job_id, attempt_no, route_id, outcome, cost_snapshot) VALUES ($1, 1, $2, 'failed', 0)`, [j, own]);
            return (await one(`SELECT public.job_route_failover($1, $2, $3) AS r`, [j, own, id])).r; };
        const supplierJob = async (route, supplierJobId, secondsAgo = 0) => { const j = await job();
            await c.query(`UPDATE public.jobs SET provider_job_id = $2 WHERE id = $1`, [j, supplierJobId]);
            await c.query(`INSERT INTO public.job_attempts (job_id, attempt_no, route_id, supplier_job_id, outcome, cost_snapshot, created_at) VALUES ($1, 1, $2, $3, 'submitted', 0.01, now() - make_interval(secs => $4))`, [j, route, supplierJobId, secondsAgo]); return j; };
        const crun = await one(
            `INSERT INTO public.model_routes (model_id, supplier, endpoint, cost_per_unit, priority, state, provenance, parity_record)
             VALUES ($1, 'crun', $2, 0.015, 3, 'active', 'licensed_reseller', 'probe') RETURNING id, supplier, endpoint`, [MODEL, CRUN_ENDPOINT]);
        await c.query(`UPDATE public.provider_spend_provider_policy SET admission_open = true WHERE provider = 'crun'`);
        // The real failover and the real Crun gate, against the real RPCs; only the supplier's answer is scripted.
        const submitCrun = async (answer, { route = crun, modelId = MODEL, jobInputs = { prompt: 'x' } } = {}) => {
            const jobId = await job(modelId);
            let supplierCalls = 0;
            const provider = { submit: (j) => submitCrunAtBoundary(j, {
                apiKey: 'test', cfg: {}, reservationKey: `breaker-test:${jobId}`, purpose: 'generic.create', rpc: pgRpc,
                submit: async () => { supplierCalls += 1; return answer; }, wait: async () => {},
            }) };
            const { result } = await submitWithFailover({
                jobId, modelRow: { id: modelId, provider: 'crun', provider_endpoint: route.endpoint }, ownRoute: route, routes: [route], canHop: false,
                inputs: {}, jobInputs, publicHost: 'https://test.invalid', first: { provider, record: {}, key: 'test' },
                deps: { providerFor: () => null, capabilityFor: () => null, rpc: pgRpc, log: () => {} },
            }, {});
            return { jobId, result, supplierCalls };
        };
        const openedAgo = (id, minutes) => c.query(`UPDATE public.model_routes SET consecutive_failures = 5, breaker_first_opened_at = NULL, breaker_opened_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, minutes]);
        const stamp = async (id) => (await one(`SELECT breaker_opened_at AS at FROM public.model_routes WHERE id = $1`, [id])).at;
        await run({ own, second, refuse, state, hopTo, supplierJob, newJob: job, crun, submitCrun, openedAgo, stamp });
        console.log(`ok - ${name}`);
    } finally {
        await c.query('ROLLBACK');
    }
}

await scenario('supplier-side failures count towards route failures.', async ({ second, refuse, state }) => {
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

await scenario('customer-input outcomes do not count; text submission is admitted.', async ({ crun, submitCrun, state }) => {
    const refusals = [
        typedRefusal('provider_moderation'), typedRefusal('provider_input_rejected'), typedRefusal('provider_refused'),
        { ok: false, outcome: 'rejected', error: 'crun 451/451' }, { ok: false, outcome: 'rejected', error: 'crun 422/422: reference_rejected' },
    ];
    for (const refusal of refusals) {
        const { jobId, result } = await submitCrun(refusal);
        assert.deepEqual(result, refusal, 'the refusal keeps its shape, including the redacted legacy one');
        assert.equal((await one(`SELECT outcome FROM public.job_attempts WHERE job_id = $1`, [jobId])).outcome, 'failed', 'the attempt is still closed');
    }
    assert.deepEqual(await state(crun.id), { fails: 0, open: false });
    const next = await submitCrun(accepted);
    assert.equal(next.result.ok, true);
    assert.equal(next.supplierCalls, 1);
});

await scenario('supplier-side failures count as route failures, and the gate observes route health', async ({ crun, submitCrun, state }) => {
    for (let i = 0; i < 5; i += 1) await submitCrun(routeDown);
    assert.deepEqual(await state(crun.id), { fails: 5, open: true });
    assert.equal((await one(`SELECT breaker_first_opened_at = breaker_opened_at AS same_start
        FROM public.model_routes WHERE id = $1`, [crun.id])).same_start, true);
    const held = await submitCrun(accepted);
    assert.equal(held.result.errorCode, 'provider_unavailable');
    assert.equal(held.supplierCalls, 0, 'nothing reaches the supplier during the cooldown');
});

await scenario('Veo customer-input outcomes leave route health unchanged and text still passes the real gate', async ({ submitCrun, state }) => {
    const modelId = 'veo-3.1-kie';
    const route = await one(`SELECT * FROM public.model_routes WHERE model_id = $1 AND supplier = 'crun' AND state = 'active'`, [modelId]);
    assert.ok(route, 'the active Veo Crun route exists');
    const refusal = { ok: false, outcome: 'rejected', error: 'crun 422/422' };
    for (let i = 0; i < 5; i += 1) {
        const { jobId, result, supplierCalls } = await submitCrun(refusal, {
            route, modelId, jobInputs: { prompt: 'animate this image', image_url: 'https://test.invalid/reference.png' },
        });
        assert.equal(supplierCalls, 1);
        assert.deepEqual(result, refusal, 'redacted refusals retain their exact shape');
        assert.equal((await one(`SELECT outcome FROM public.job_attempts WHERE job_id = $1`, [jobId])).outcome, 'failed');
    }
    assert.deepEqual(await state(route.id), { fails: 0, open: false });
    const text = await submitCrun(accepted, { route, modelId, jobInputs: { prompt: 'a landscape' } });
    assert.equal(text.result.ok, true);
    assert.equal(text.supplierCalls, 1);
});

for (const errorCode of ['provider_moderation', 'provider_task_failed']) {
    await scenario(`async ${errorCode} outcomes apply reviewed failure accounting`, async ({ crun, supplierJob, state }) => {
        const refused = errorCode === 'provider_moderation';
        for (let i = 0; i < 5; i += 1) {
            const providerJobId = `async_${i}`;
            const jobId = await supplierJob(crun.id, providerJobId);
            let response;
            const call = async (fn, args) => {
                assert.equal(fn, refused ? 'mark_job_attempt_refused' : 'mark_job_attempt_outcome');
                response = await pgRpc(fn, args);
                return response;
            };
            const mark = () => markAttemptOutcome({ provider: 'crun', providerJobId, outcome: 'failed', errorCode }, {}, {
                env: { SUPPLIER_ROUTES_ENABLED: 'true' }, call,
            });
            assert.equal(await mark(), true);
            assert.deepEqual(response, { ok: true, updated: 1 });
            assert.equal((await one(`SELECT outcome FROM public.job_attempts WHERE job_id = $1`, [jobId])).outcome, 'failed');
            assert.equal(await mark(), true);
            assert.deepEqual(response, { ok: true, updated: 0 }, 'redelivery is a no-op');
        }
        assert.deepEqual(await state(crun.id), { fails: refused ? 0 : 5, open: !refused });
    });
}

await scenario("the gate's own refusal leaves recorded route health unchanged", async ({ crun, submitCrun, state, openedAgo, stamp }) => {
    await openedAgo(crun.id, 3);
    const before = await stamp(crun.id);
    for (let i = 0; i < 3; i += 1) assert.equal((await submitCrun(accepted)).supplierCalls, 0);
    assert.deepEqual(await state(crun.id), { fails: 5, open: true });
    assert.equal((await stamp(crun.id)).getTime(), before.getTime());
});

await scenario('after the cooldown a generic Crun route takes a probe: success closes it, failure re-opens it', async ({ crun, submitCrun, state, openedAgo, stamp, supplierJob }) => {
    await openedAgo(crun.id, 11);
    const failed = await submitCrun(routeDown);
    assert.equal(failed.supplierCalls, 1, 'the probe reached the supplier');
    assert.ok(Date.now() - (await stamp(crun.id)).getTime() < 60_000, 'a failed probe restarts the cooldown');
    assert.equal((await submitCrun(accepted)).supplierCalls, 0);
    await openedAgo(crun.id, 11);
    const probe = await submitCrun(accepted);
    assert.equal(probe.result.ok, true);
    await supplierJob(crun.id, 'task_probe');
    assert.equal((await one(`SELECT public.mark_job_attempt_outcome('crun', 'task_probe', 'completed') AS r`)).r.updated, 1);
    assert.deepEqual(await state(crun.id), { fails: 0, open: false });
});

await scenario('Suno keeps its fenced reopen: an old breaker still holds until the owner reopens it', async () => {
    const opened = await one(`UPDATE public.model_routes SET breaker_opened_at = date_trunc('milliseconds', now()) - interval '11 minutes' WHERE supplier = 'crun' AND endpoint = $1 RETURNING breaker_opened_at AS at`, [SUNO_ENDPOINT]);
    assert.ok(opened, 'the Suno route exists');
    const gate = () => pgRpc('reserve_crun_create_slot', { p_reservation_key: 'breaker-test:suno', p_purpose: 'music.create', p_endpoint: SUNO_ENDPOINT, p_suno_model: 'v6' });
    assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');
    assert.equal((await pgRpc('reopen_crun_endpoint_routes', { p_endpoint: SUNO_ENDPOINT, p_expected_opened_at: opened.at })).ok, true);
    assert.equal((await gate()).ok, true);
});

await scenario('a route resolved before cooldown expiry records both a failed and a completed probe', async ({ crun, own, second, openedAgo, submitCrun, stamp, state }) => {
    await c.query(`UPDATE public.model_routes SET state = 'disabled' WHERE id = ANY($1::uuid[])`, [[own, second]]);
    const offer = { id: MODEL, provider: 'crun', provider_endpoint: CRUN_ENDPOINT };
    const resolve = () => resolveRouteSet(offer, {}, {
        env: { SUPPLIER_ROUTES_ENABLED: 'true' },
        read: async (table, { filter }) => {
            assert.equal(table, 'model_routes');
            assert.equal(filter, `model_id=eq.${MODEL}`);
            return (await c.query(`SELECT * FROM public.model_routes WHERE model_id = $1`, [MODEL])).rows;
        },
    });
    for (const answer of [routeDown, accepted]) {
        await openedAgo(crun.id, 9);
        const resolved = await resolve();
        assert.equal(resolved.own?.id, crun.id);
        assert.equal(new Date(resolved.own.breaker_opened_at).getTime(), (await stamp(crun.id)).getTime());
        await openedAgo(crun.id, 11);
        const probe = await submitCrun(answer, { route: resolved.own });
        assert.equal(probe.supplierCalls, 1, 'the request crosses the cooldown before reaching the real gate');
        if (!answer.ok) {
            assert.deepEqual(await state(crun.id), { fails: 6, open: true });
            assert.ok(Date.now() - (await stamp(crun.id)).getTime() < 60_000);
            assert.equal((await submitCrun(accepted)).supplierCalls, 0);
        } else {
            const submitted = await pgRpc('job_submitted', {
                p_job_id: probe.jobId, p_provider: 'crun', p_provider_job_id: answer.providerJobId,
            });
            assert.equal(submitted.ok, true);
            assert.equal(await recordFirstAttempt({ jobId: probe.jobId, route: resolved.own, providerJobId: answer.providerJobId }, {}, { call: pgRpc }), true);
            assert.equal((await pgRpc('mark_job_attempt_outcome', {
                p_provider: 'crun', p_supplier_job_id: answer.providerJobId, p_outcome: 'completed',
            })).updated, 1);
            assert.deepEqual(await state(crun.id), { fails: 0, open: false });
        }
    }
});

await scenario('the gate accepts only the exact Seedance edit/extend exceptions and isolates their breakers', async ({ crun, openedAgo }) => {
    const base = 'crun:bytedance/seedance2-5-r2v';
    let n = 0;
    const gate = (endpoint) => pgRpc('reserve_crun_create_slot', {
        p_reservation_key: `breaker-test:seedance:${++n}`, p_purpose: 'generic.create', p_endpoint: endpoint, p_suno_model: null,
    });
    for (const endpoint of [`${base}:edit`, `${base}:extend`]) assert.equal((await gate(endpoint)).ok, true, endpoint);
    for (const endpoint of [`${base}:edit2`, `${base}:Edit`, `${base}:edit:extend`, `${base}:`, 'crun:other/model:edit']) {
        assert.equal((await gate(endpoint)).code, 'INVALID_INPUTS', endpoint);
    }
    await c.query(`UPDATE public.model_routes SET endpoint = $2 WHERE id = $1`, [crun.id, `${base}:edit`]);
    await openedAgo(crun.id, 1);
    assert.equal((await gate(`${base}:edit`)).code, 'CRUN_UNAVAILABLE');
    assert.equal((await gate(`${base}:extend`)).ok, true);
    assert.equal((await gate(base)).ok, true);
    await openedAgo(crun.id, 11);
    assert.equal((await gate(`${base}:edit`)).ok, true, 'edit recovers after the generic cooldown');
});

await scenario('closing a refused attempt is idempotent and refuses a job it does not own', async ({ crun, second, state, newJob, supplierJob }) => {
    const close = (jobId, routeId) => pgRpc('job_route_close_refused', { p_job_id: jobId, p_route_id: routeId });
    const jobId = await newJob();
    assert.equal((await close(jobId, crun.id)).ok, true);
    assert.equal((await close(jobId, crun.id)).ok, true);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.job_attempts WHERE job_id = $1 AND outcome = 'failed'`, [jobId])).n, 1);
    assert.equal((await close(jobId, second)).code, 'failed_route_mismatch');
    assert.equal((await close(await supplierJob(crun.id, 'task_held'), crun.id)).code, 'job_not_failable_over_or_accepted');
    assert.equal((await close('00000000-0000-0000-0000-000000000000', crun.id)).code, 'job_not_found');
    const settled = await newJob();
    await c.query(`UPDATE public.jobs SET state = 'FAILED' WHERE id = $1`, [settled]);
    assert.equal((await close(settled, crun.id)).code, 'job_not_failable_over_or_accepted');
    assert.deepEqual(await state(crun.id), { fails: 0, open: false });
});

async function sharedKlingRoutes() {
    const rows = (await c.query(`SELECT id, model_id, consecutive_failures, breaker_opened_at FROM public.model_routes
        WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'
          AND model_id IN ('kling-3.0-i2v-kie', 'kling-3.0-i2v') AND state = 'active'
        ORDER BY model_id`)).rows;
    assert.equal(rows.length, 2, 'both replayed Kling routes exist');
    return rows;
}

await scenario('generic Crun endpoint recovery follows supplier evidence across sibling routes', async ({ openedAgo, state, stamp }) => {
    const [first, sibling] = await sharedKlingRoutes();
    const gate = () => pgRpc('reserve_crun_create_slot', {
        p_reservation_key: 'breaker-test:shared-kling', p_purpose: 'generic.create', p_endpoint: 'crun:kling/v3', p_suno_model: null,
    });
    const record = (id, ok) => c.query(`SELECT private.route_breaker_record($1, $2)`, [id, ok]);
    await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL
        WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
    await record(sibling.id, false);
    assert.deepEqual(await state(sibling.id), { fails: 1, open: false });
    assert.deepEqual(await state(first.id), { fails: 0, open: false });

    await c.query(`UPDATE public.model_routes SET consecutive_failures = 0 WHERE id = $1`, [sibling.id]);
    await openedAgo(first.id, 11);
    const before = await stamp(first.id);
    assert.equal((await gate()).ok, true);
    await record(sibling.id, false);
    assert.deepEqual(await state(sibling.id), { fails: 1, open: true });
    assert.ok(Date.now() - (await stamp(sibling.id)).getTime() < 60_000);
    assert.equal((await stamp(first.id)).getTime(), before.getTime(), 'failure writes only its own row');
    assert.deepEqual(await state(first.id), { fails: 5, open: true });
    assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');

    await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL WHERE id = $1`, [sibling.id]);
    assert.equal((await gate()).ok, true);
    await record(sibling.id, true);
    assert.deepEqual(await state(first.id), { fails: 0, open: false });
    assert.deepEqual(await state(sibling.id), { fails: 0, open: false });
    assert.equal((await gate()).ok, true);
});

await scenario('sibling completions preserve a fresh cooldown and clear it after expiry', async ({ openedAgo, state, stamp, supplierJob }) => {
    const [first, sibling] = await sharedKlingRoutes();
    await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL
        WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
    // Attempt timestamps, not completion order, determine sibling evidence.
    await supplierJob(sibling.id, 'task_before_sibling_trip', 120);
    await openedAgo(first.id, 1);
    const before = await stamp(first.id);
    const gate = () => pgRpc('reserve_crun_create_slot', {
        p_reservation_key: 'breaker-test:sibling-cooldown', p_purpose: 'generic.create', p_endpoint: 'crun:kling/v3', p_suno_model: null,
    });
    const complete = (task) => pgRpc('mark_job_attempt_outcome', {
        p_provider: 'crun', p_supplier_job_id: task, p_outcome: 'completed',
    });
    assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');
    assert.equal((await complete('task_before_sibling_trip')).updated, 1);
    assert.deepEqual(await state(sibling.id), { fails: 0, open: false });
    assert.deepEqual(await state(first.id), { fails: 5, open: true });
    assert.equal((await stamp(first.id)).getTime(), before.getTime());
    assert.equal((await gate()).code, 'CRUN_UNAVAILABLE', 'completion leaves the fresh sibling cooldown intact');

    await openedAgo(first.id, 10);
    await supplierJob(sibling.id, 'task_after_sibling_cooldown', 0);
    assert.equal((await complete('task_after_sibling_cooldown')).updated, 1);
    assert.deepEqual(await state(first.id), { fails: 0, open: false });
    assert.deepEqual(await state(sibling.id), { fails: 0, open: false });
    assert.equal((await gate()).ok, true, 'completion clears the sibling at the cooldown boundary');
});

await scenario('Suno siblings and other suppliers retain their existing accounting semantics', async ({ crun, own, openedAgo, state, stamp }) => {
    const suno = await one(`SELECT id FROM public.model_routes WHERE supplier = 'crun' AND endpoint = $1 LIMIT 1`, [SUNO_ENDPOINT]);
    assert.ok(suno);
    await openedAgo(suno.id, 11);
    const sunoStamp = await stamp(suno.id);
    await c.query(`UPDATE public.model_routes SET endpoint = $2, consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL WHERE id = $1`, [crun.id, SUNO_ENDPOINT]);
    await c.query(`SELECT private.route_breaker_record($1, false)`, [crun.id]);
    assert.deepEqual(await state(crun.id), { fails: 1, open: false });
    await c.query(`SELECT private.route_breaker_record($1, true)`, [crun.id]);
    assert.deepEqual(await state(crun.id), { fails: 0, open: false });
    assert.deepEqual(await state(suno.id), { fails: 5, open: true });
    assert.equal((await stamp(suno.id)).getTime(), sunoStamp.getTime());

    for (const id of [crun.id, own]) {
        await openedAgo(id, 11);
        await c.query(`UPDATE public.model_routes SET consecutive_failures = 1 WHERE id = $1`, [id]);
        const before = await stamp(id);
        await c.query(`SELECT private.route_breaker_record($1, false)`, [id]);
        assert.deepEqual(await state(id), { fails: 2, open: true });
        assert.equal((await stamp(id)).getTime(), before.getTime());
        await c.query(`SELECT private.route_breaker_record($1, true)`, [id]);
        assert.deepEqual(await state(id), { fails: 0, open: false });
    }
});

// Read timestamp text so assertions retain PostgreSQL precision within the test transaction.
const evidenceState = (id) => one(`SELECT consecutive_failures AS fails,
    breaker_opened_at::text AS stamp, breaker_first_opened_at::text AS first
    FROM public.model_routes WHERE id = $1`, [id]);
const finishTask = (task, outcome, provider = 'crun') => pgRpc('mark_job_attempt_outcome', {
    p_provider: provider, p_supplier_job_id: task, p_outcome: outcome,
});
const endpointGate = (endpoint, key) => pgRpc('reserve_crun_create_slot', {
    p_reservation_key: `breaker-test:evidence:${key}`, p_purpose: 'generic.create', p_endpoint: endpoint, p_suno_model: null,
});
const startPeriod = async (id, legacy = false) => {
    await c.query(`UPDATE public.model_routes SET consecutive_failures = 5,
        breaker_opened_at = now() - interval '11 minutes',
        breaker_first_opened_at = CASE WHEN $2::boolean THEN NULL ELSE now() - interval '11 minutes' END
        WHERE id = $1`, [id, legacy]);
    return evidenceState(id);
};

for (const legacy of [false, true]) {
    await scenario(`async failure evidence preserves the open period (legacy=${legacy})`, async ({ crun, supplierJob }) => {
        const before = await startPeriod(crun.id, legacy);
        const originalStart = before.first || before.stamp;
        await supplierJob(crun.id, 'task_before_trip', 720);
        assert.equal((await finishTask('task_before_trip', 'failed')).updated, 1);
        assert.deepEqual(await evidenceState(crun.id), { ...before, fails: 6 }, 'late pre-trip failure increments without refreshing');
        assert.equal((await endpointGate(crun.endpoint, 'old-failure')).ok, true);

        await supplierJob(crun.id, 'task_current_probe', 0);
        assert.equal((await finishTask('task_current_probe', 'failed')).updated, 1);
        const refreshed = await evidenceState(crun.id);
        assert.equal(refreshed.fails, 7);
        assert.ok(new Date(refreshed.stamp) > new Date(before.stamp));
        assert.equal(refreshed.first, originalStart);
        assert.equal((await endpointGate(crun.endpoint, 'current-failure')).code, 'CRUN_UNAVAILABLE');
        assert.equal((await finishTask('task_current_probe', 'failed')).updated, 0, 'redelivery remains a no-op');
        assert.deepEqual(await evidenceState(crun.id), refreshed);

        // Move only the latest stamp between completions; the open-period start must stay fixed.
        for (let i = 0; i < 2; i += 1) {
            await c.query(`UPDATE public.model_routes SET breaker_opened_at = now() - interval '11 minutes' WHERE id = $1`, [crun.id]);
            await supplierJob(crun.id, `task_repeat_${i}`, 0);
            assert.equal((await finishTask(`task_repeat_${i}`, 'failed')).updated, 1);
            assert.deepEqual(await evidenceState(crun.id), { ...refreshed, fails: 8 + i });
        }
    });
}

// Each pair was admitted in one window, including rows opened 10/30 seconds before expiry.
// Exercise both same-route and cross-route failures, and a completion from either boundary time.
for (const [firstSecondsAgo, secondSecondsAgo] of [[0, 10], [70, 90], [90, 70]]) {
    for (const secondOnSibling of [false, true]) {
        await scenario(`only the latest failure window refreshes (${firstSecondsAgo}/${secondSecondsAgo}, sibling=${secondOnSibling})`, async ({ supplierJob }) => {
            const [first, sibling] = await sharedKlingRoutes();
            await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL,
                breaker_first_opened_at = NULL WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
            const before = await startPeriod(first.id);
            const gate = () => endpointGate('crun:kling/v3', 'latest-window');
            assert.equal((await gate()).ok, true);
            await supplierJob(first.id, 'first_window_failure', firstSecondsAgo);
            const second = secondOnSibling ? sibling : first;
            await supplierJob(second.id, 'second_window_failure', secondSecondsAgo);
            await supplierJob(sibling.id, 'same_window_completion', firstSecondsAgo);

            assert.equal((await finishTask('first_window_failure', 'failed')).updated, 1);
            const refreshed = await evidenceState(first.id);
            assert.equal(refreshed.fails, 6);
            assert.equal(refreshed.first, before.first);
            assert.ok(new Date(refreshed.stamp) > new Date(before.stamp));
            assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');

            // now() is fixed in this transaction. Age the refreshed stamp slightly so a
            // second write to now() is observable, as it would be in separate completions.
            await c.query(`UPDATE public.model_routes SET breaker_opened_at = now() - interval '30 seconds' WHERE id = $1`, [first.id]);
            const firstBeforeSecond = await evidenceState(first.id);
            const secondBefore = await evidenceState(second.id);
            assert.equal((await finishTask('second_window_failure', 'failed')).updated, 1);
            assert.deepEqual(await evidenceState(second.id), { ...secondBefore, fails: secondBefore.fails + 1 },
                'another failure from the same window increments without moving or creating a stamp');
            if (secondOnSibling) assert.deepEqual(await evidenceState(first.id), firstBeforeSecond);
            assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');

            assert.equal((await finishTask('same_window_completion', 'completed')).updated, 1);
            for (const route of [first, sibling]) assert.deepEqual(await evidenceState(route.id), { fails: 0, stamp: null, first: null });
            assert.equal((await gate()).ok, true, 'completion still uses the original period start');
        });
    }
}

// At now(), the initial cooldown expired 60 seconds ago. These rows represent probes
// created after expiry, 30/10 seconds before expiry, exactly at the grace boundary,
// and 61 seconds before expiry. Gate admission still occurs only after ten minutes.
for (const secondsAgo of [0, 90, 70, 120, 121]) {
    await scenario(`shared endpoint probe ordering uses attempt time (${secondsAgo}s ago)`, async ({ supplierJob }) => {
        const [first, sibling] = await sharedKlingRoutes();
        await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL,
            breaker_first_opened_at = NULL WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
        const before = await startPeriod(first.id);
        const inWindow = secondsAgo <= 120;
        const gate = () => endpointGate('crun:kling/v3', `order-${secondsAgo}`);
        assert.equal((await gate()).ok, true, 'the gate admits the probes after cooldown');
        await supplierJob(first.id, 'probe_a_failed', secondsAgo);
        await supplierJob(sibling.id, 'probe_b_completed', secondsAgo);
        assert.equal((await finishTask('probe_a_failed', 'failed')).updated, 1);
        const failed = await evidenceState(first.id);
        assert.equal(failed.fails, 6);
        assert.equal(failed.first, before.first);
        assert.equal(failed.stamp === before.stamp, !inWindow);
        assert.equal((await gate()).code || 'admitted', inWindow ? 'CRUN_UNAVAILABLE' : 'admitted');
        assert.equal((await finishTask('probe_b_completed', 'completed')).updated, 1);
        assert.deepEqual(await evidenceState(sibling.id), { fails: 0, stamp: null, first: null });
        assert.deepEqual(await evidenceState(first.id), inWindow ? { fails: 0, stamp: null, first: null } : failed,
            'only a completion in the probe window clears a sibling');
        assert.equal((await gate()).ok, true);
    });
}

for (const legacy of [false, true]) {
    await scenario(`an unstamped sibling joins the existing open period (legacy=${legacy})`, async ({ supplierJob }) => {
        const [first, sibling] = await sharedKlingRoutes();
        await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL,
            breaker_first_opened_at = NULL WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
        const before = await startPeriod(first.id, legacy);
        const gate = () => endpointGate('crun:kling/v3', `join-${legacy}`);
        assert.equal((await gate()).ok, true);
        await supplierJob(first.id, 'probe_a_completed', 0);
        await supplierJob(sibling.id, 'probe_b_failed', 0);
        assert.equal((await finishTask('probe_b_failed', 'failed')).updated, 1);
        const joined = await evidenceState(sibling.id);
        assert.equal(joined.fails, 1);
        assert.equal(joined.first, before.first || before.stamp, 'the sibling inherits the original start, including legacy rows');
        assert.ok(new Date(joined.stamp) > new Date(before.stamp));
        assert.deepEqual(await evidenceState(first.id), before, 'failure writes only its own row');
        assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');
        assert.equal((await finishTask('probe_a_completed', 'completed')).updated, 1);
        for (const route of [first, sibling]) assert.deepEqual(await evidenceState(route.id), { fails: 0, stamp: null, first: null });
        assert.equal((await gate()).ok, true, 'the admitted probe clears both routes despite the new sibling stamp');
    });
}

await scenario('pre-trip sibling completions preserve fresh and expired stamps', async ({ supplierJob, openedAgo }) => {
    const [first, sibling] = await sharedKlingRoutes();
    const gate = () => endpointGate('crun:kling/v3', 'pre-trip-completion');
    for (const age of [1, 11]) {
        await c.query(`UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL,
            breaker_first_opened_at = NULL WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3'`);
        await openedAgo(first.id, age);
        await supplierJob(sibling.id, `old_completion_${age}`, 720);
        const before = await evidenceState(first.id);
        assert.equal((await finishTask(`old_completion_${age}`, 'completed')).updated, 1);
        assert.deepEqual(await evidenceState(first.id), before);
        assert.deepEqual(await evidenceState(sibling.id), { fails: 0, stamp: null, first: null });
        const result = await gate();
        if (age === 1) assert.equal(result.code, 'CRUN_UNAVAILABLE');
        else assert.equal(result.ok, true);
    }
});

await scenario('late async failures retain Suno and non-Crun accounting', async ({ own, openedAgo, supplierJob }) => {
    const suno = await one(`SELECT id FROM public.model_routes WHERE supplier = 'crun' AND endpoint = $1 LIMIT 1`, [SUNO_ENDPOINT]);
    for (const [route, supplier] of [[suno.id, 'crun'], [own, 'kie']]) {
        await openedAgo(route, 11);
        const before = await evidenceState(route);
        await supplierJob(route, `late_${supplier}`, 720);
        assert.equal((await finishTask(`late_${supplier}`, 'failed', supplier)).updated, 1);
        const after = await evidenceState(route);
        assert.equal(after.fails, 6);
        assert.ok(new Date(after.stamp) > new Date(before.stamp), 'old suppliers still refresh at the threshold regardless of admission time');
        assert.equal(after.first, null);
        await supplierJob(route, `complete_${supplier}`, 720);
        assert.equal((await finishTask(`complete_${supplier}`, 'completed', supplier)).updated, 1);
        assert.deepEqual(await evidenceState(route), { fails: 0, stamp: null, first: null });
    }
});

async function sharedEndpointConcurrency() {
    const databaseUrl = new URL(url);
    const host = databaseUrl.hostname === '[::1]' ? '::1' : databaseUrl.hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || !decodeURIComponent(databaseUrl.pathname.slice(1)).endsWith('_check')) {
        throw new Error('The committed concurrency fixture requires a local database whose name ends in _check');
    }
    const blocker = new pg.Client({ connectionString: url });
    let saved = [];
    try {
        await blocker.connect();
        await c.query('BEGIN');
        const [locked, other] = await sharedKlingRoutes();
        // Save timestamp text to retain database precision when restoring the committed fixture.
        saved = (await c.query(`SELECT id, consecutive_failures, breaker_opened_at::text, breaker_first_opened_at::text, updated_at::text
            FROM public.model_routes WHERE id = ANY($1::uuid[]) FOR UPDATE`, [[locked.id, other.id]])).rows;
        await c.query(`UPDATE public.model_routes SET consecutive_failures = 1,
            breaker_opened_at = now() - interval '11 minutes',
            breaker_first_opened_at = now() - interval '11 minutes' WHERE id = ANY($1::uuid[])`, [[locked.id, other.id]]);
        await c.query('COMMIT');

        await c.query('BEGIN');
        await blocker.query('BEGIN');
        await c.query("SET LOCAL lock_timeout = '250ms'");
        await blocker.query("SET LOCAL lock_timeout = '250ms'");
        await blocker.query(`SELECT id FROM public.model_routes WHERE id = $1 FOR UPDATE`, [locked.id]);
        const lockedState = () => one(`SELECT consecutive_failures, breaker_opened_at, breaker_first_opened_at
            FROM public.model_routes WHERE id = $1`, [locked.id]);
        const before = await lockedState();
        assert.ok(before.breaker_opened_at, 'the locked sibling stamp is committed and visible to the completion');
        assert.ok(Date.now() - before.breaker_opened_at.getTime() >= 10 * 60_000, 'the locked sibling cooldown has expired');

        // Counted failures only write their own row, even while a sibling is locked.
        await c.query(`SELECT private.route_breaker_record($1, false)`, [other.id]);
        assert.equal((await one(`SELECT consecutive_failures FROM public.model_routes WHERE id = $1`, [other.id])).consecutive_failures, 2);
        assert.deepEqual(await lockedState(), before);

        // The visible stamped sibling qualifies for reset; SKIP LOCKED must avoid waiting on it.
        await c.query(`SELECT private.route_breaker_record($1, true)`, [other.id]);
        assert.deepEqual(await one(`SELECT consecutive_failures, breaker_opened_at, breaker_first_opened_at FROM public.model_routes WHERE id = $1`, [other.id]),
            { consecutive_failures: 0, breaker_opened_at: null, breaker_first_opened_at: null });
        assert.deepEqual(await lockedState(), before);

        // Release the lock, then exercise the low-count stamp left by the skipped reset.
        await blocker.query('ROLLBACK');
        await c.query(`UPDATE public.model_routes SET breaker_opened_at = now() - interval '11 minutes' WHERE id = $1`, [locked.id]);
        const aged = await lockedState();
        await c.query(`UPDATE public.provider_spend_provider_policy SET admission_open = true WHERE provider = 'crun'`);
        const gate = async () => (await one(`SELECT public.reserve_crun_create_slot(
            'breaker-test:concurrent-kling', 'generic.create', 'crun:kling/v3', NULL) AS r`)).r;
        assert.equal((await gate()).ok, true);
        await c.query(`SELECT private.route_breaker_record($1, false)`, [locked.id]);
        const refreshed = await lockedState();
        assert.equal(refreshed.consecutive_failures, 2);
        assert.equal(refreshed.breaker_first_opened_at.getTime(), before.breaker_first_opened_at.getTime());
        assert.ok(refreshed.breaker_opened_at.getTime() > aged.breaker_opened_at.getTime());
        assert.ok(Date.now() - refreshed.breaker_opened_at.getTime() < 60_000);
        assert.equal((await gate()).code, 'CRUN_UNAVAILABLE');
        console.log('ok - shared endpoint accounting remains nonblocking and retains probe recovery');
    } finally {
        try { await c.query('ROLLBACK'); }
        finally {
            try { await blocker.query('ROLLBACK'); }
            finally {
                try {
                    await c.query('BEGIN');
                    for (const row of saved) {
                        await c.query(`UPDATE public.model_routes SET consecutive_failures = $2,
                            breaker_opened_at = $3::timestamptz, breaker_first_opened_at = $4::timestamptz, updated_at = $5::timestamptz WHERE id = $1`,
                        [row.id, row.consecutive_failures, row.breaker_opened_at, row.breaker_first_opened_at, row.updated_at]);
                    }
                    await c.query('COMMIT');
                } finally {
                    try { await c.query('ROLLBACK'); }
                    finally { await blocker.end(); }
                }
            }
        }
    }
}

try { await sharedEndpointConcurrency(); }
finally { await c.end(); }
console.log('supplier route breaker: all scenarios passed');
