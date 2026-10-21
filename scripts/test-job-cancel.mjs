#!/usr/bin/env node
// Full replay, disposable local Postgres only. Real RPCs, including concurrent claims/cancels.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/rebuild_check') {
    throw new Error('a disposable local rebuild_check DATABASE_URL is required');
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const call = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS r`, args)).r;
const model = `cancel-${randomUUID().slice(0, 8)}`;
const users = [];
const cancel = (u, id) => call('cancel_user_job', u.auth, id);
const status = (u, id) => call('get_user_job_cancel', u.auth, id);
const job = id => one('SELECT * FROM public.jobs WHERE id=$1', [id]);
const dispatch = id => one('SELECT * FROM public.fal_dispatch WHERE job_id=$1', [id]);
const money = u => one('SELECT * FROM public.credit_balances WHERE user_id=$1', [u.id]);
const entries = u => q('SELECT * FROM public.ledger_entries WHERE user_id=$1 ORDER BY id', [u.id]);
const refunds = id => q("SELECT * FROM public.ledger_entries WHERE job_id=$1 AND reason LIKE 'refund:%'", [id]);
const claim = id => call('claim_fal_dispatch', id);
const record = (c, state, handle = null) => call('record_fal_dispatch', c.job_id, c.attempt_token, state, handle);
const recover = () => call('recover_fal_dispatch', 25);
async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
    const u = { auth, id: (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id };
    users.push(u); return u;
}
async function admit(u, free = false, inputs = { prompt: 'test' }) {
    const r = await call('admit_fal_dispatch', u.id, randomUUID(), model, inputs, { prompt: 'test' }, 'fal-ai/flux-2-pro', free);
    assert.equal(r.ok, true, JSON.stringify(r)); return r.job_id;
}
// Snapshot all cancellation-relevant data: GET may change only its read-quota row.
async function snapshot(u, id) {
    return { job: await job(id), dispatch: await dispatch(id), money: await money(u), ledger: await entries(u),
        claims: await q('SELECT * FROM public.model_free_allowance_claims WHERE user_id=$1 ORDER BY idempotency_key', [u.id]) };
}
async function advisory(u, id, expected) {
    const before = await snapshot(u, id), r = await status(u, id);
    assert.deepEqual(await snapshot(u, id), before, 'GET has no job/dispatch/money/allowance side effects');
    if (typeof expected === 'boolean') assert.deepEqual(r, { ok: true, cancellable: expected, credits: before.job.credits });
    else assert.deepEqual(r, { ok: false, code: expected });
    return r;
}
async function fresh(u, id, code = null) {
    await advisory(u, id, code === 'NOT_FOUND' ? code : code === null);
    const before = await entries(u), r = await cancel(u, id);
    if (code) {
        assert.deepEqual(r, { ok: false, code });
        assert.deepEqual(await entries(u), before, 'refusal changes no ledger row');
    } else assert.deepEqual(r, { ok: true, replayed: false, credits: (await job(id)).credits });
    return r;
}
// Current admission has a two-outstanding/ten-daily cap. Remove only synthetic
// capacity/outbox fixtures between cases, preserving all job/ledger rows for reconciliation.
async function clearIntents() {
    await q('DELETE FROM public.fal_capacity_reservations WHERE job_id IN (SELECT id FROM public.jobs WHERE model_id=$1)', [model]);
    await q('DELETE FROM public.fal_dispatch WHERE job_id IN (SELECT id FROM public.jobs WHERE model_id=$1)', [model]);
}
let checks = 0, policy, control;
async function check(name, run) {
    await clearIntents();
    await run(); checks++; console.log(`ok ${name}`);
}
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0359_job_cancel.sql', import.meta.url), 'utf8');
    await q(migration); await q(migration);
    policy = await one('SELECT * FROM public.fal_capacity_policy');
    control = await one('SELECT * FROM public.fal_admission_control');
    await q(`INSERT INTO public.model_catalog
        (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Cancel test','fal','fal-ai/flux-2-pro','text-to-image',2,0.03,'per_generation',false,true,1,10)`, [model]);
    await q("UPDATE public.fal_capacity_policy SET enabled=true,provider_account='local-cancel-fixture',model_id=$1", [model]);
    await q('UPDATE public.fal_admission_control SET paused=false');

    await check('queued cancellation, balance restored, single refund and replay', async () => {
        const u = await user(), before = await money(u), id = await admit(u);
        await fresh(u, id);
        assert.equal((await job(id)).state, 'REFUNDED');
        assert.equal((await job(id)).error_code, 'user_cancelled');
        assert.equal((await dispatch(id)).state, 'CLOSED');
        assert.ok((await dispatch(id)).resolved_at);
        assert.equal((await money(u)).balance, before.balance);
        assert.equal((await money(u)).free_balance, before.free_balance);
        assert.deepEqual((await refunds(id)).map(r => r.reason), ['refund:user_cancelled']);
        await advisory(u, id, false);
        const ledger = await entries(u);
        assert.deepEqual(await cancel(u, id), { ok: true, replayed: true, credits: 2 });
        assert.deepEqual(await entries(u), ledger);
        const simultaneous = await admit(u);
        await advisory(u, simultaneous, true);
        const results = await Promise.all(Array.from({ length: 8 }, () => cancel(u, simultaneous)));
        assert.ok(results.every(r => r.ok && r.credits === 2));
        assert.equal(results.filter(r => r.replayed === false).length, 1);
        assert.equal((await refunds(simultaneous)).length, 1);
    });
    await check('20 cancel/claim races have exactly one winner; cron cannot start a cancelled job', async () => {
        for (let i = 0; i < 20; i++) {
            await clearIntents();
            const u = await user(), id = await admit(u);
            const [r, c] = await Promise.all([cancel(u, id), claim(id)]);
            if (r.ok) {
                assert.equal(r.replayed, false);
                assert.ok(['BUSY', 'INELIGIBLE'].includes(c.disposition));
                assert.equal((await dispatch(id)).state, 'CLOSED');
                assert.equal((await refunds(id)).length, 1);
                assert.equal(await call('start_fal_dispatch'), null);
            } else {
                assert.equal(c.disposition, 'CLAIMED');
                assert.equal(r.code, 'JOB_STARTED');
                assert.equal((await refunds(id)).length, 0);
            }
        }
    });
    await check('started/unknown/accepted/rejected dispatches and legacy jobs cannot cancel', async () => {
        for (const state of ['STARTED', 'UNKNOWN', 'ACCEPTED', 'REJECTED']) {
            await clearIntents();
            const u = await user(), id = await admit(u), c = await claim(id);
            assert.equal(c.disposition, 'CLAIMED');
            if (state !== 'STARTED') assert.equal((await record(c, state, state === 'ACCEPTED' ? `req_${randomUUID()}` : null)).ok, true);
            if (state === 'ACCEPTED') { await recover(); assert.equal((await job(id)).state, 'SUBMITTED'); }
            await fresh(u, id, 'JOB_STARTED');
            assert.equal((await refunds(id)).length, 0);
        }
        const u = await user();
        // A non-fal catalog id avoids current reserved-only admission policy on the legacy path.
        const r = await call('ledger_debit', u.id, randomUUID(), 2, 'debit:generation', 'test-model', { prompt: 'legacy' });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(await dispatch(r.job_id), undefined);
        await fresh(u, r.job_id, 'JOB_STARTED');
    });
    await check('terminal and other noneligible job states refuse without ledger changes', async () => {
        for (const state of ['STORED', 'FAILED', 'REFUNDED', 'SUCCEEDED', 'SUBMITTED', 'FAILOVER', 'PRICED']) {
            await clearIntents();
            const u = await user(), id = await admit(u);
            if (state === 'REFUNDED') await call('ledger_refund', id, u.id, 2, 'refund:provider_failed');
            else await q('UPDATE public.jobs SET state=$2::public.job_state WHERE id=$1', [id, state]);
            await fresh(u, id, ['STORED', 'FAILED', 'REFUNDED'].includes(state) ? 'JOB_FINISHED' : 'JOB_STARTED');
        }
        await clearIntents();
        const u = await user(), id = await admit(u);
        await q("UPDATE public.jobs SET provider_job_id='unexpected-handle' WHERE id=$1", [id]);
        await fresh(u, id, 'JOB_STARTED');
    });
    await check('late submit, recovery, repeated refund and sweep leave cancellation intact', async () => {
        const u = await user(), id = await admit(u); await fresh(u, id);
        const before = await entries(u);
        assert.equal((await call('job_submitted', id, 'fal', 'req_x')).code, 'BAD_STATE_FOR_SUBMIT');
        await recover(); assert.equal((await job(id)).state, 'REFUNDED');
        assert.equal((await call('ledger_refund', id, u.id, 2, 'refund:provider_failed')).idempotent, true);
        await q("UPDATE public.jobs SET updated_at=now()-interval '16 minutes' WHERE id=$1", [id]);
        await call('sweep_stuck_jobs');
        assert.deepEqual(await entries(u), before);
        assert.equal((await job(id)).error_code, 'user_cancelled');
    });
    await check('sweep winning before cancellation answers finished with one refund', async () => {
        const u = await user(), id = await admit(u);
        await q("UPDATE public.jobs SET updated_at=now()-interval '16 minutes' WHERE id=$1", [id]);
        await call('sweep_stuck_jobs');
        assert.equal((await job(id)).state, 'REFUNDED');
        await fresh(u, id, 'JOB_FINISHED');
        assert.equal((await refunds(id)).length, 1);
    });
    await check('free allowance returned to today or its original day, without a ledger row', async () => {
        for (const yesterday of [false, true]) {
            await clearIntents();
            const u = await user(), id = await admit(u, true), j = await job(id);
            assert.equal(j.credits, 0); assert.equal(j.free_allowance, true);
            if (yesterday) await q("UPDATE public.model_free_allowance_claims SET day=(now() AT TIME ZONE 'UTC')::date-1 WHERE user_id=$1 AND idempotency_key=$2", [u.id, j.idempotency_key]);
            const original = await one('SELECT day FROM public.model_free_allowance_claims WHERE user_id=$1 AND idempotency_key=$2', [u.id, j.idempotency_key]);
            const before = await call('free_allowance_left', u.id), ledger = await entries(u);
            assert.equal((await fresh(u, id)).credits, 0);
            const after = await one('SELECT day,state FROM public.model_free_allowance_claims WHERE user_id=$1 AND idempotency_key=$2', [u.id, j.idempotency_key]);
            assert.equal(after.state, 'RETURNED'); assert.deepEqual(after.day, original.day);
            assert.equal((await call('free_allowance_left', u.id))[model], before[model] + (yesterday ? 0 : 1));
            assert.deepEqual(await entries(u), ledger);
            await advisory(u, id, false);
            assert.deepEqual(await cancel(u, id), { ok: true, replayed: true, credits: 0 });
        }
    });
    await check('subscription source restored; replaced cycle refund expires again', async () => {
        for (const replaced of [false, true]) {
            await clearIntents();
            const u = await user();
            const grant = days => call('subscription_grant', u.id, 20, new Date(Date.now() + days * 86400000).toISOString(), `in_${randomUUID().replaceAll('-', '')}`);
            assert.equal((await grant(20)).ok, true);
            const id = await admit(u);
            assert.equal((await money(u)).subscription_balance, 18);
            if (replaced) assert.equal((await grant(30)).ok, true);
            const before = await money(u), ledger = await entries(u);
            await fresh(u, id);
            const added = (await entries(u)).filter(row => !ledger.some(old => old.id === row.id));
            assert.deepEqual(added.filter(r => r.reason === 'refund:user_cancelled').map(r => [r.delta, r.subscription_delta]), [[2, 2]]);
            assert.equal(added.filter(r => r.reason === 'expire:subscription').length, replaced ? 1 : 0);
            assert.equal((await money(u)).balance, before.balance + (replaced ? 0 : 2));
            assert.equal((await money(u)).subscription_balance, before.subscription_balance + (replaced ? 0 : 2));
            assert.deepEqual(await q('SELECT * FROM public.reconcile_subscription_credits() WHERE user_id=$1', [u.id]), []);
        }
    });
    await check('ownership, deleted/chat/missing jobs, frozen account and strike hold', async () => {
        const u = await user(), other = await user(), id = await admit(u);
        await fresh(other, id, 'NOT_FOUND'); await fresh(u, randomUUID(), 'NOT_FOUND');
        assert.deepEqual(await status({ auth: randomUUID() }, id), { ok: false, code: 'NOT_FOUND' });
        assert.deepEqual(await cancel({ auth: randomUUID() }, id), { ok: false, code: 'NOT_FOUND' });
        // Delete through the owning RPC, never write deleted_at directly.
        await q("UPDATE public.jobs SET state='STORED' WHERE id=$1", [id]);
        await q("UPDATE public.fal_dispatch SET state='CLOSED' WHERE job_id=$1", [id]);
        assert.equal((await call('delete_user_job', u.auth, id)).ok, true);
        await fresh(u, id, 'NOT_FOUND');
        await clearIntents();
        const chat = await admit(u, false, { prompt: 'chat', kind: 'chat' });
        await fresh(u, chat, 'NOT_FOUND');
        await clearIntents();
        const frozen = await user(), frozenId = await admit(frozen);
        await call('freeze_account', frozen.id, 'test freeze', null);
        await fresh(frozen, frozenId, 'ACCOUNT_FROZEN');
        await clearIntents();
        const held = await user(), heldId = await admit(held);
        await q("UPDATE public.users SET hold_until=now()+interval '1 day' WHERE id=$1", [held.id]);
        await fresh(held, heldId);
    });
    await check('cancelled jobs never enqueue failure push; provider-refunded jobs still do', async () => {
        const u = await user(), id = await admit(u);
        const token = `ExponentPushToken[${randomUUID().replaceAll('-', '')}]`;
        assert.equal((await call('register_push_token', u.auth, token, 'ios', null, null, true)).ok, true);
        await fresh(u, id);
        const failed = await admit(u);
        await call('ledger_refund', failed, u.id, 2, 'refund:provider_failed');
        await fresh(u, failed, 'JOB_FINISHED');
        await call('push_enqueue_job_events', 1000);
        assert.deepEqual(await q('SELECT job_id,kind FROM public.push_outbox WHERE user_id=$1', [u.id]), [{ job_id: failed, kind: 'job_failed' }]);
    });
    await check('an earlier refund on a DEBITED job rolls back the entire cancellation', async () => {
        const u = await user(), id = await admit(u);
        await call('ledger_refund', id, u.id, 2, 'refund:provider_failed');
        // Deliberately inconsistent fixture: exercise the invariant without a raw ledger write.
        await q("UPDATE public.jobs SET state='DEBITED' WHERE id=$1", [id]);
        await advisory(u, id, true);
        const before = await snapshot(u, id);
        await assert.rejects(cancel(u, id), /JOB_CANCEL_REFUND_INVARIANT/);
        assert.deepEqual(await snapshot(u, id), before);
    });
    await check('read quota and grants protect both RPCs', async () => {
        const u = await user(), id = await admit(u);
        await q('INSERT INTO public.job_read_rate_limits(user_id,window_started_at,request_count) VALUES($1,now(),600)', [u.id]);
        const before = await snapshot(u, id);
        for (const fn of ['get_user_job_cancel', 'cancel_user_job']) {
            const r = await call(fn, u.auth, id); assert.equal(r.code, 'RATE_LIMITED');
            assert.ok(r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60);
            for (const role of ['anon', 'authenticated']) {
                const c = await pool.connect();
                try {
                    await c.query('BEGIN'); await c.query('SAVEPOINT r');
                    await c.query(`SET LOCAL ROLE ${role}`);
                    await assert.rejects(c.query(`SELECT public.${fn}($1,$2)`, [u.auth, id]), { code: '42501' });
                    await c.query('ROLLBACK TO SAVEPOINT r');
                } finally { await c.query('ROLLBACK'); c.release(); }
            }
            assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed', ['service_role', `public.${fn}(text,uuid)`])).allowed, true);
        }
        assert.deepEqual(await snapshot(u, id), before);
    });
    // Drain any push events this script's later fixtures created, so the next script in the workflow (test-push-tokens)
    // counts only its own jobs when it sweeps.
    await call('push_enqueue_job_events', 1000);
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id=ANY($1::uuid[])`, [users.map(u => u.id)]), [], fn);
    }
    const allowance = await q('SELECT * FROM public.reconcile_free_allowance()');
    assert.deepEqual(allowance.filter(r => r.ref.includes(model) || users.some(u => r.ref.includes(u.id)) || r.ref === 'all models'), []);
    console.log(`${checks} job cancel acceptance cases passed; reconciliation clean`);
} finally {
    await clearIntents();
    if (policy) await q('UPDATE public.fal_capacity_policy SET enabled=$1,provider_account=$2,model_id=$3 WHERE singleton', [policy.enabled, policy.provider_account, policy.model_id]);
    if (control) await q('UPDATE public.fal_admission_control SET paused=$1 WHERE singleton', [control.paused]);
    await q('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [users.map(u => u.auth)]);
    await q('UPDATE public.model_catalog SET active=false WHERE id=$1', [model]);
    await pool.end();
}
