#!/usr/bin/env node
// Ambiguous-submit holding and reconciliation follow the actual attempted
// supplier — Crun (now primary) and failover suffixed reservation keys
// included — not a hard-coded supplier list (assessment F-14, ADR-0307). Full
// replayed chain; throwaway LOCAL database only, everything rolls back.
//
// The provider_spend guard trigger is disabled on the rebuild_check database
// (ledger-tests.yml), so reservations are inserted directly to model the first
// attempt and any failover attempt.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('refuses remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const val = async (sql, args = []) => Object.values(await one(sql, args))[0];

const MODEL = 'test-recovery-model';
async function user() {
    const auth = randomUUID();
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
    const id = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    await val(`SELECT public.ledger_grant($1, 500, 'grant:test')`, [id]);
    return id;
}
// A DEBITED job that answered ambiguously, with a reservation per attempt.
async function unknownJob(userId, attempts) {
    const key = `rec-${randomUUID()}`;
    const debit = await one(`SELECT public.ledger_debit($1,$2,50,'debit:generation',$3,'{}'::jsonb) AS r`, [userId, key, MODEL]);
    const jobId = debit.r.job_id;
    let t = 0;
    for (const { provider, suffix } of attempts) {
        await db.query(
            `INSERT INTO public.provider_spend_reservations(user_id, effect_key, model_id, provider, purpose, estimated_cost_microusd, admitted_at)
             VALUES ($1,$2,$3,$4,'job',1000000, now() - make_interval(secs => $5))`,
            [userId, suffix ? `${key}${suffix}` : key, MODEL, provider, 1000 - t]);
        t += 1;
    }
    await db.query(`UPDATE public.jobs SET error_code='provider_outcome_unknown', updated_at = now() - interval '30 minutes' WHERE id=$1`, [jobId]);
    return { jobId, key };
}
const jobState = (id) => one('SELECT state, error_code, provider, provider_job_id FROM public.jobs WHERE id=$1', [id]);
const sweep = () => val('SELECT public.sweep_stuck_jobs(15,120,500,60) AS r');
const reconcile = (id, outcome, handle = null) => val('SELECT public.reconcile_provider_submit_unknown($1,$2,$3) AS r', [id, outcome, handle]);

try {
    await db.query('BEGIN');

    await check('a Crun ambiguous submit is HELD by the sweep, not refunded', async () => {
        const u = await user();
        const { jobId } = await unknownJob(u, [{ provider: 'crun' }]);
        await sweep();
        const j = await jobState(jobId);
        assert.equal(j.state, 'DEBITED', 'the Crun job is still held, not swept');
        assert.equal((await db.query("SELECT count(*)::int n FROM public.ledger_entries WHERE job_id=$1 AND delta>0", [jobId])).rows[0].n, 0, 'no refund');
    });

    await check('a Crun ambiguous submit reconciles to Crun on ACCEPTED', async () => {
        const u = await user();
        const { jobId } = await unknownJob(u, [{ provider: 'crun' }]);
        const r = await reconcile(jobId, 'ACCEPTED', 'crun-handle-1');
        assert.equal(r.ok, true, JSON.stringify(r));
        const j = await jobState(jobId);
        assert.equal(j.state, 'SUBMITTED');
        assert.equal(j.provider, 'crun', 'reconciled to the actual supplier, not a hard-coded one');
        assert.equal(j.error_code, null, 'the ambiguous marker is cleared');
    });

    await check('a failover ambiguous submit reconciles to the LAST attempted supplier (suffixed key)', async () => {
        const u = await user();
        // First attempt crun (older), failover attempt kie under `<key>:a2` (newer).
        const { jobId } = await unknownJob(u, [{ provider: 'crun' }, { provider: 'kie', suffix: ':a2' }]);
        const r = await reconcile(jobId, 'ACCEPTED', 'kie-handle-9');
        assert.equal(r.ok, true, JSON.stringify(r));
        const j = await jobState(jobId);
        assert.equal(j.state, 'SUBMITTED');
        assert.equal(j.provider, 'kie', 'reconciled to the failover supplier under the suffixed key');
    });

    await check('a failover ambiguous submit is HELD by the sweep (suffixed reservation counts)', async () => {
        const u = await user();
        const { jobId } = await unknownJob(u, [{ provider: 'crun' }, { provider: 'kie', suffix: ':a2' }]);
        await sweep();
        assert.equal((await jobState(jobId)).state, 'DEBITED', 'held on the failover reservation');
    });

    await check('a REJECTED reconciliation refunds the held job', async () => {
        const u = await user();
        const { jobId } = await unknownJob(u, [{ provider: 'crun' }]);
        const before = Number(await val('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u]));
        const r = await reconcile(jobId, 'REJECTED');
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal((await jobState(jobId)).state, 'REFUNDED');
        assert.equal(Number(await val('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u])), before + 50, 'the 50 credits are refunded');
    });

    await check('an ordinary orphaned debit (no ambiguous marker) is still swept and refunded (F-13 kept)', async () => {
        const u = await user();
        const key = `orph-${randomUUID()}`;
        const debit = await one(`SELECT public.ledger_debit($1,$2,50,'debit:generation',$3,'{}'::jsonb) AS r`, [u, key, MODEL]);
        const jobId = debit.r.job_id;
        // A reservation exists (the Worker died after debit+reserve, before submit), error_code stays NULL.
        await db.query(`INSERT INTO public.provider_spend_reservations(user_id, effect_key, model_id, provider, purpose, estimated_cost_microusd, admitted_at)
             VALUES ($1,$2,$3,'crun','job',1000000, now())`, [u, key, MODEL]);
        await db.query(`UPDATE public.jobs SET updated_at = now() - interval '30 minutes' WHERE id=$1`, [jobId]);
        await sweep();
        assert.equal((await jobState(jobId)).state, 'REFUNDED', 'a NULL-error_code orphan is swept, not held');
    });

    console.log(`supplier-aware submit recovery: ok (${passed})`);
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
