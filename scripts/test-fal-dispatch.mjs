#!/usr/bin/env node
// ADR-0076 acceptance against the full replay on a disposable local Postgres.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' && new URL(url).hostname !== 'localhost') {
    throw new Error('a disposable local DATABASE_URL is required');
}
const pool = new pg.Pool({ connectionString: url, max: 12 });
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const model = `dispatch-test-${randomUUID().slice(0, 8)}`;
const endpoint = 'fal-ai/flux-2-pro';
const users = [];
const admit = async (user, key = randomUUID(), inputs = { prompt: 'test' }, free = false) =>
    (await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,$6) AS r', [user, key, model, inputs, endpoint, free])).r;
const start = async () => (await one('SELECT public.start_fal_dispatch() AS r')).r;
const claim = async id => (await one('SELECT public.claim_fal_dispatch($1) AS r', [id])).r;
const record = async (j, state, handle = null, token = j.attempt_token) =>
    (await one('SELECT public.record_fal_dispatch($1,$2,$3,$4) AS r', [j.job_id, token, state, handle])).r;
const recover = async () => (await one('SELECT public.recover_fal_dispatch(25) AS r')).r;
const job = async (id) => one('SELECT state, error_code, provider_job_id FROM public.jobs WHERE id=$1', [id]);
const dispatch = async (id) => one('SELECT state, provider_job_id, projected_at FROM public.fal_dispatch WHERE job_id=$1', [id]);
const balance = async (u) => (await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u])).balance;
async function user() {
    const auth = randomUUID();
    await pool.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [auth, `${auth}@example.invalid`]);
    const u = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    users.push(auth);
    return u;
}
let failed = 0;
async function check(name, run) {
    try { await run(); console.log(`  ok ${name}`); }
    catch (e) { failed++; console.error(`  FAIL ${name}: ${e.message}`); }
}
try {
    for (const file of ['0230_fal_durable_dispatch.sql', '0231_fal_targeted_claim.sql']) {
        await pool.query(await readFile(new URL(`../packages/db/schema/supabase/${file}`, import.meta.url), 'utf8'));
    }
    await pool.query(`INSERT INTO public.model_catalog
        (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active)
        VALUES ($1,'Dispatch test','fal',$2,'text-to-image',2,0.01,'per_generation',false,true)`, [model, endpoint]);
    await check('concurrent admission debits once and creates one intent', async () => {
        const u = await user(), before = await balance(u), key = randomUUID();
        const results = await Promise.all(Array.from({ length: 8 }, () => admit(u, key)));
        assert.equal(results.filter(r => !r.idempotent).length, 1);
        assert.ok(results.every(r => r.ok && r.job_id === results[0].job_id));
        assert.equal(await balance(u), before - 2);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.fal_dispatch WHERE job_id=$1', [results[0].job_id])).n, 1);
        const claims = await Promise.all(Array.from({ length: 8 }, start));
        assert.equal(claims.filter(Boolean).length, 1);
        const claim = claims.find(Boolean);
        assert.equal((await record(claim, 'REJECTED')).ok, true);
        await recover();
        assert.equal(await balance(u), before);
    });
    await check('targeted claim selects only its reference and never reclaims STARTED or UNKNOWN', async () => {
        const u = await user(), first = await admit(u), second = await admit(u);
        const c = await claim(second.job_id);
        assert.equal(c.disposition, 'CLAIMED');
        assert.equal(c.job_id, second.job_id);
        assert.equal(c.endpoint, endpoint);
        assert.deepEqual(c.payload, { prompt: 'test' });
        assert.equal((await dispatch(first.job_id)).state, 'READY');
        assert.deepEqual(await claim(second.job_id), { disposition: 'INELIGIBLE' });
        await record(c, 'UNKNOWN');
        assert.deepEqual(await claim(second.job_id), { disposition: 'INELIGIBLE' });
        await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')", [second.job_id,u]);
        const older = await start();
        assert.equal(older.job_id, first.job_id);
        assert.equal(older.disposition, undefined, 'cron keeps its existing response contract');
        await record(older, 'REJECTED'); await recover();
    });
    await check('mixed cron and targeted races create exactly one attempt token', async () => {
        const u = await user(), r = await admit(u);
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? start() : claim(r.job_id)));
        const owned = results.filter(c => c?.job_id);
        assert.equal(owned.length, 1);
        assert.equal(owned[0].job_id, r.job_id);
        assert.match(owned[0].attempt_token, /^[a-f0-9-]{36}$/);
        assert.deepEqual(await claim(r.job_id), { disposition: 'INELIGIBLE' });
        await record(owned[0], 'REJECTED'); await recover();
    });
    await check('locked job or outbox returns BUSY promptly without consuming its intent', async () => {
        for (const table of ['jobs', 'fal_dispatch']) {
            const u = await user(), r = await admit(u), locker = await pool.connect(), caller = await pool.connect();
            try {
                await locker.query('BEGIN');
                await locker.query(table === 'jobs' ? 'SELECT id FROM public.jobs WHERE id=$1 FOR UPDATE'
                    : 'SELECT job_id FROM public.fal_dispatch WHERE job_id=$1 FOR UPDATE', [r.job_id]);
                await caller.query("SET statement_timeout='500ms'");
                const result = (await caller.query('SELECT public.claim_fal_dispatch($1) AS r', [r.job_id])).rows[0].r;
                assert.deepEqual(result, { disposition: 'BUSY' });
                assert.equal((await dispatch(r.job_id)).state, 'READY');
            } finally {
                await locker.query('ROLLBACK'); locker.release();
                await caller.query('RESET statement_timeout'); caller.release();
            }
            const c = await claim(r.job_id);
            assert.equal(c.disposition, 'CLAIMED');
            await record(c, 'REJECTED'); await recover();
        }
    });
    await check('missing, legacy, expired and refunded references cannot acquire ownership', async () => {
        assert.deepEqual(await claim(null), { disposition: 'MISSING' });
        assert.deepEqual(await claim(randomUUID()), { disposition: 'MISSING' });
        const u = await user();
        const legacy = (await one("SELECT public.ledger_debit($1,$2,2,'debit:generation',$3,$4) AS r",
            [u,randomUUID(),model,{prompt:'test'}])).r;
        assert.deepEqual(await claim(legacy.job_id), { disposition: 'MISSING' });
        assert.equal(await dispatch(legacy.job_id), undefined);
        await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')", [legacy.job_id,u]);
        const r = await admit(u);
        await pool.query("UPDATE public.jobs SET updated_at=now()-interval '14 minutes' WHERE id=$1", [r.job_id]);
        assert.deepEqual(await claim(r.job_id), { disposition: 'EXPIRED' });
        assert.equal((await dispatch(r.job_id)).state, 'READY');
        assert.equal(await start(), null);
        await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')", [r.job_id,u]);
        assert.deepEqual(await claim(r.job_id), { disposition: 'INELIGIBLE' });
        await recover();
    });
    await check('changed inputs conflict, equivalent JSON key order replays', async () => {
        const u = await user(), key = randomUUID();
        const a = await admit(u, key, { prompt: 'test', seed: 1 });
        assert.equal((await admit(u, key, { seed: 1, prompt: 'test' })).job_id, a.job_id);
        assert.equal((await admit(u, key, { prompt: 'different' })).code, 'IDEMPOTENCY_CONFLICT');
        const changedPayload=(await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,false) AS r',
            [u,key,model,{prompt:'test',seed:1},{prompt:'test',seed:2},endpoint])).r;
        assert.equal(changedPayload.code,'IDEMPOTENCY_CONFLICT');
        const c = await start(); await record(c, 'REJECTED'); await recover();
    });
    await check('failed intent insertion rolls back debit and job', async () => {
        const u = await user(), key = randomUUID(), before = await balance(u);
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query(`CREATE FUNCTION public.test_dispatch_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'injected outbox outage'; END $$`);
            await c.query('CREATE TRIGGER test_dispatch_failure BEFORE INSERT ON public.fal_dispatch FOR EACH ROW EXECUTE FUNCTION public.test_dispatch_failure()');
            await assert.rejects(c.query('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,false)', [u, key, model, { prompt: 'test' }, endpoint]), /injected outbox outage/);
        } finally { await c.query('ROLLBACK'); c.release(); }
        assert.equal(await balance(u), before);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.jobs WHERE user_id=$1 AND idempotency_key=$2', [u,key])).n, 0);
    });
    await check('failed free intent insertion rolls back the allowance and zero-credit job', async () => {
        await pool.query('UPDATE public.model_catalog SET free_allowance_per_day=1,free_allowance_daily_budget=100 WHERE id=$1',[model]);
        const u=await user(), key=randomUUID(), before=await balance(u), c=await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query(`CREATE FUNCTION public.test_dispatch_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'injected outbox outage'; END $$`);
            await c.query('CREATE TRIGGER test_dispatch_failure BEFORE INSERT ON public.fal_dispatch FOR EACH ROW EXECUTE FUNCTION public.test_dispatch_failure()');
            await assert.rejects(c.query('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,true)',
                [u,key,model,{prompt:'test'},endpoint]),/injected outbox outage/);
        } finally { await c.query('ROLLBACK'); c.release(); }
        assert.equal(await balance(u),before);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.model_free_allowance_claims WHERE user_id=$1 AND idempotency_key=$2',[u,key])).n,0);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.jobs WHERE user_id=$1 AND idempotency_key=$2',[u,key])).n,0);
        await pool.query('UPDATE public.model_catalog SET free_allowance_per_day=0,free_allowance_daily_budget=0 WHERE id=$1',[model]);
    });
    await check('crash after STARTED never reclaims; recovery annotates without delaying refund', async () => {
        const u = await user(); const r = await admit(u); const c = await start();
        const before = await one('SELECT updated_at FROM public.jobs WHERE id=$1', [r.job_id]);
        await pool.query("UPDATE public.fal_dispatch SET started_at=now()-interval '3 minutes' WHERE job_id=$1", [r.job_id]);
        await recover();
        assert.equal((await dispatch(r.job_id)).state, 'UNKNOWN');
        assert.equal((await job(r.job_id)).error_code, 'provider_outcome_unknown');
        assert.deepEqual(await one('SELECT updated_at FROM public.jobs WHERE id=$1', [r.job_id]), before);
        assert.equal(await start(), null);
        assert.equal((await record(c, 'ACCEPTED', 'late-handle')).ok, true);
        await recover();
        assert.equal((await job(r.job_id)).provider_job_id, 'late-handle');
    });
    await check('accepted evidence survives projection failure and a later pass attaches it', async () => {
        const u = await user(); const r = await admit(u); const c = await start();
        assert.equal((await record(c, 'ACCEPTED', 'durable-handle')).ok, true);
        assert.equal((await record(c, 'ACCEPTED', 'durable-handle')).idempotent, true);
        assert.equal((await record(c, 'ACCEPTED', 'wrong-handle')).code, 'OUTCOME_CONFLICT');
        assert.equal((await record(c, 'ACCEPTED', 'durable-handle', randomUUID())).code, 'ATTEMPT_MISMATCH');
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            await db.query(`CREATE FUNCTION public.test_projection_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.state='SUBMITTED' THEN RAISE EXCEPTION 'injected projection outage'; END IF; RETURN NEW; END $$`);
            await db.query('CREATE TRIGGER test_projection_failure BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.test_projection_failure()');
            const recovered = (await db.query('SELECT public.recover_fal_dispatch(25) AS r')).rows[0].r;
            assert.equal(recovered.ok, false); assert.ok(recovered.failed > 0);
        } finally { await db.query('ROLLBACK'); db.release(); }
        assert.equal((await dispatch(r.job_id)).provider_job_id, 'durable-handle');
        assert.equal((await job(r.job_id)).state, 'DEBITED');
        await recover();
        assert.equal((await job(r.job_id)).state, 'SUBMITTED');
        assert.equal(await start(), null);
    });
    await check('a conflicting handle cannot block another job or overwrite either piece of evidence', async () => {
        const u = await user(), bad = await admit(u), good = await admit(u);
        const handles = new Map([[bad.job_id, 'poison-evidence'], [good.job_id, 'healthy-evidence']]);
        for (let i = 0; i < 2; i++) {
            const c = await start();
            assert.ok(c && handles.has(c.job_id));
            assert.equal((await record(c, 'ACCEPTED', handles.get(c.job_id))).ok, true);
        }
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            const submitted = (await db.query("SELECT public.job_submitted($1,'fal','conflicting-handle') AS r", [bad.job_id])).rows[0].r;
            assert.equal(submitted.ok, true);
            const recovered = (await db.query('SELECT public.recover_fal_dispatch(25) AS r')).rows[0].r;
            assert.deepEqual(recovered, { ok: false, processed: 2, failed: 1 });
            const rows = (await db.query(`SELECT j.id,j.state,j.provider_job_id AS job_handle,
                d.provider_job_id AS evidence,d.projected_at,d.recovery_checked_at
                FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id=j.id
                WHERE j.id=ANY($1::uuid[])`, [[bad.job_id, good.job_id]])).rows;
            const poisoned = rows.find(r => r.id === bad.job_id), healthy = rows.find(r => r.id === good.job_id);
            assert.equal(poisoned.job_handle, 'conflicting-handle');
            assert.equal(poisoned.evidence, 'poison-evidence');
            assert.equal(poisoned.projected_at, null);
            assert.ok(poisoned.recovery_checked_at);
            assert.equal(healthy.state, 'SUBMITTED');
            assert.equal(healthy.job_handle, 'healthy-evidence');
            assert.ok(healthy.projected_at);
            assert.equal((await db.query('SELECT public.recover_fal_dispatch(25) AS r')).rows[0].r.processed, 0);
        } finally { await db.query('ROLLBACK'); db.release(); }
        assert.equal((await recover()).ok, true);
        assert.equal((await job(bad.job_id)).provider_job_id, 'poison-evidence');
        for (const id of handles.keys()) await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')", [id,u]);
    });
    await check('legacy replay never adds an intent', async () => {
        const u = await user(), key = randomUUID();
        const r = (await one("SELECT public.ledger_debit($1,$2,2,'debit:generation',$3,$4) AS r", [u,key,model,{prompt:'test'}])).r;
        assert.equal((await admit(u,key)).job_id, r.job_id);
        assert.equal(await dispatch(r.job_id), undefined);
    });
    await check('free admission and rejection return the allowance without ledger entries', async () => {
        await pool.query('UPDATE public.model_catalog SET free_allowance_per_day=1,free_allowance_daily_budget=100 WHERE id=$1', [model]);
        const u = await user(), before = await balance(u); const r = await admit(u,randomUUID(),{prompt:'test'},true);
        assert.equal(r.free,true); assert.equal(r.balance_after,before);
        const c = await start(); await record(c,'REJECTED'); await recover(); await recover();
        assert.equal((await job(r.job_id)).state,'REFUNDED');
        assert.equal((await one('SELECT count(*)::int AS n FROM public.ledger_entries WHERE job_id=$1', [r.job_id])).n,0);
        assert.equal((await one('SELECT state FROM public.model_free_allowance_claims WHERE user_id=$1', [u])).state,'RETURNED');
        await pool.query('UPDATE public.model_catalog SET free_allowance_per_day=0,free_allowance_daily_budget=0 WHERE id=$1', [model]);
    });
    await check('stuck-job refund wins over late accepted evidence, without resubmission', async () => {
        const u = await user(), before = await balance(u); const r = await admit(u), c = await start();
        await pool.query("UPDATE public.jobs SET updated_at=now()-interval '16 minutes' WHERE id=$1", [r.job_id]);
        await pool.query('SELECT public.sweep_stuck_jobs()');
        assert.equal((await job(r.job_id)).state,'REFUNDED'); assert.equal(await balance(u),before);
        await record(c,'ACCEPTED','after-refund'); await recover();
        assert.equal((await job(r.job_id)).state,'REFUNDED');
        assert.equal((await dispatch(r.job_id)).provider_job_id,'after-refund');
        assert.equal(await start(),null);
    });
    await check('unknown work and missing/failed heartbeats are visible before timeout', async () => {
        const u = await user(); const r = await admit(u), c = await start();
        await record(c,'UNKNOWN');
        await pool.query("SELECT public.record_worker_task_health('fal_dispatch',false)");
        await pool.query('SELECT public.refresh_recovery_health()');
        const h=(await one('SELECT public.recovery_status() AS r')).r;
        assert.ok(h.unhealthy_tasks.includes('fal_dispatch'));
        assert.ok(h.fal_dispatch_unknown > 0);
        await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')",[r.job_id,u]);
    });
    await check('refunded queued jobs cannot start', async () => {
        const u = await user(); const r = await admit(u);
        await pool.query("SELECT public.ledger_refund($1,$2,2,'refund:test')",[r.job_id,u]);
        assert.equal(await start(),null); await recover();
        assert.equal((await dispatch(r.job_id)).state,'CLOSED');
    });
    await check('outbox is forced RLS and internal RPCs reject browser roles', async () => {
        const table = await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.fal_dispatch'::regclass");
        assert.deepEqual(table,{relrowsecurity:true,relforcerowsecurity:true});
        assert.equal((await one("SELECT has_function_privilege('service_role','public.claim_fal_dispatch(uuid)','EXECUTE') AS p")).p, true);
        for (const role of ['anon','authenticated']) {
            assert.equal((await one("SELECT has_table_privilege($1,'public.fal_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS p",[role])).p,false);
            for (const fn of ['admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)','start_fal_dispatch()', 'claim_fal_dispatch(uuid)',
                'record_fal_dispatch(uuid,uuid,text,text)','recover_fal_dispatch(integer)']) {
                assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS p',[role,`public.${fn}`])).p,false);
            }
        }
        await pool.query("SELECT public.record_worker_task_health('fal_dispatch',true)");
        await pool.query('SELECT public.refresh_recovery_health()');
    });
    for (const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) {
        assert.equal((await q(`SELECT * FROM public.${fn}()`)).length,0,fn);
    }
} finally {
    // Delete through auth/users cascades; model rows remain harmless in this disposable database.
    await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])',[users]);
    await pool.end();
}
if (failed) process.exitCode=1;
