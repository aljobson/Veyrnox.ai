#!/usr/bin/env node
// Disposable local PostgreSQL only. Fixtures are committed and audit rows retained.
// Lock waits are observed through pg_stat_activity, never inferred from a delay.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated database required');
const a = new pg.Client({ connectionString: url }), b = new pg.Client({ connectionString: url });
await a.connect(); await b.connect();
const q = async (client, sql, args = []) => (await client.query(sql, args)).rows;
const one = async (client, sql, args = []) => (await q(client, sql, args))[0];
const value = async (client, sql, args = []) => (await one(client, sql, args)).value;
let pending;
const watch = promise => {
    const state = { done: false, result: null, error: null };
    pending = promise.then(result => { state.result = result; }, error => { state.error = error; }).finally(() => { state.done = true; });
    state.resultValue = async () => { await pending; if (state.error) throw state.error; return state.result; };
    return state;
};
const pid = (await one(b, 'SELECT pg_backend_pid() AS pid')).pid;
async function untilBlockedOrDone(state) {
    const deadline = Date.now() + 8000;
    while (!state.done) {
        await a.query('SELECT pg_stat_clear_snapshot()');
        const row = await one(a, "SELECT wait_event_type, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1", [pid]);
        if (row.wait_event_type === 'Lock' && row.blockers.length) return true;
        assert.ok(Date.now() < deadline, 'second connection neither completed nor reached a lock wait');
    }
    return false;
}
async function waitForLock(state) {
    assert.equal(await untilBlockedOrDone(state), true, `expected a lock wait; result=${JSON.stringify(state.result)}, error=${state.error?.message}`);
}
async function person(admin = false) {
    const auth = randomUUID();
    await a.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@test.invalid`]);
    const u = await one(a, 'UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id', [auth, admin]);
    return { auth, id: u.id };
}
async function image(user) {
    const id = randomUUID(), key = `hardening/${id}.png`;
    await a.query("INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,inputs) VALUES($1::uuid,$2,$1::text,'test-model',1,'STORED','{}')", [id, user.id]);
    await a.query("INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,$2,'image/png',100)", [id, key]);
    return { id, key };
}
async function target(user, job) {
    const brand = randomUUID(), account = randomUUID(), post = randomUUID(), id = randomUUID(), token = randomUUID();
    await a.query("INSERT INTO public.social_brands(id,owner_user_id,label) VALUES($1,$2,'hardening')", [brand, user.id]);
    await a.query("INSERT INTO public.social_accounts(id,brand_id,network,external_account_id,access_token_enc) VALUES($1::uuid,$2,'threads',$1::text,decode('01','hex'))", [account, brand]);
    await a.query("INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES($1::uuid,$2,$3,now(),$1::text)", [post, brand, user.id]);
    await a.query("INSERT INTO public.social_post_media(post_id,position,media_type,source_job_id) VALUES($1,0,'image',$2)", [post, job.id]);
    await a.query(`INSERT INTO public.social_post_targets(id,post_id,account_id,network,publish_status,claim_key,claimed_from_status,claimed_attempts,claimed_provider_state,attempts)
        VALUES($1,$2,$3,'threads','publishing',$4,'pending',0,'{}',1)`, [id, post, account, token]);
    return { id, token };
}
async function retained(job) {
    assert.equal((await one(a, 'SELECT count(*)::int AS n FROM public.assets WHERE job_id=$1', [job.id])).n, 1);
    assert.equal((await one(a, 'SELECT count(*)::int AS n FROM public.asset_reap_queue WHERE r2_key=$1', [job.key])).n, 0);
}
const clawback = (client, admin, user, key) => value(client,
    "SELECT public.admin_credit_clawback_guarded($1,'aal2',extract(epoch FROM clock_timestamp())::bigint,$2,1,'test correction',$3) AS value", [admin.auth, user.id, key]);
const balanceLock = user => a.query('SELECT 1 FROM public.credit_balances WHERE user_id=$1 FOR UPDATE', [user.id]);
const freeze = user => a.query("SELECT public.freeze_account($1,'test freeze',NULL)", [user.id]);
async function pair(left, right) {
    const results = await Promise.allSettled([left(), right()]);
    for (const r of results) {
        if (r.status === 'rejected') { assert.notEqual(r.reason.code, '40P01', 'lock-order regression'); throw r.reason; }
    }
    return results.map(r => r.value);
}
try {
    for (const client of [a, b]) await client.query("SET statement_timeout='12s'; SET lock_timeout='10s'");
    const admin = await person(true), user = await person();
    // R2a: SKIP LOCKED finishes while the other transaction still owns the asset.
    let job = await image(user);
    await a.query("UPDATE public.assets SET expires_at=now()-interval '1 day' WHERE job_id=$1", [job.id]);
    await a.query('BEGIN');
    await a.query('UPDATE public.assets SET held_at=now() WHERE job_id=$1', [job.id]);
    let state = watch(value(b, 'SELECT public.expire_assets(500) AS value'));
    assert.equal(await untilBlockedOrDone(state), false, 'expiry must skip the locked row, not wait');
    // The count covers every expired unheld asset in a shared database, so only this job's asset is asserted.
    assert.ok(Number.isInteger(await state.resultValue()));
    await a.query('COMMIT'); await retained(job);
    console.log('PASS R2 expiry: locked held asset skipped, no queue row');

    // R2b: delete_user_job rechecks after the asset-lock wait.
    job = await image(user);
    await a.query('BEGIN'); await a.query('UPDATE public.assets SET held_at=now() WHERE job_id=$1', [job.id]);
    state = watch(value(b, 'SELECT public.delete_user_job($1,$2) AS value', [user.auth, job.id]));
    await waitForLock(state); await a.query('COMMIT');
    assert.equal((await state.resultValue()).code, 'ON_HOLD'); await retained(job);
    console.log('PASS R2 job deletion: lock wait, ON_HOLD, asset retained');

    // R3: target writers hold the balance lock; the clawback reads after that wait.
    for (const mode of ['deleted', 'frozen']) {
        const recipient = await person(), key = randomUUID();
        await a.query("SELECT public.ledger_grant($1,100,'grant:hardening',$2)", [recipient.id, randomUUID()]);
        const before = await one(a, `SELECT (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) AS entries,
            (SELECT balance FROM public.credit_balances WHERE user_id=$1) AS balance`, [recipient.id]);
        let confirmation;
        if (mode === 'deleted') {
            const prepared = await value(a, 'SELECT public.prepare_account_deletion($1) AS value', [recipient.auth]);
            assert.equal(prepared.eligible, true); confirmation = prepared.confirmation_token;
        }
        await a.query('BEGIN'); await balanceLock(recipient);
        if (mode === 'deleted') {
            assert.equal((await value(a, 'SELECT public.erase_account($1,$2) AS value', [recipient.auth, confirmation])).ok, true);
        } else await freeze(recipient);
        state = watch(clawback(b, admin, recipient, key));
        await waitForLock(state); await a.query('COMMIT');
        assert.equal((await state.resultValue()).code, mode === 'deleted' ? 'ACCOUNT_DELETED' : 'ACCOUNT_FROZEN');
        assert.deepEqual(await one(a, `SELECT (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) AS entries,
            (SELECT balance FROM public.credit_balances WHERE user_id=$1) AS balance`, [recipient.id]), before);
        assert.equal((await one(a, 'SELECT count(*)::int AS n FROM public.account_actions WHERE idempotency_key=$1', [key])).n, 0);
        console.log(`PASS R3 ${mode}: lock wait, typed refusal, no clawback writes`);
    }

    // R5: a resolver waits on assets before the report, so release can finish.
    job = await image(user);
    await a.query('UPDATE public.assets SET held_at=now() WHERE job_id=$1', [job.id]);
    const report = randomUUID();
    await a.query("INSERT INTO public.content_reports(id,source,subject_kind,subject_id,category,details) VALUES($1,'scanner','job',$2,'other','test report')", [report, job.id]);
    await a.query('BEGIN'); await a.query('SELECT 1 FROM public.assets WHERE job_id=$1 ORDER BY id FOR UPDATE', [job.id]);
    state = watch(value(b, 'SELECT public.resolve_content_report($1,$2,$3) AS value', [admin.auth, report, 'test resolution']));
    await waitForLock(state);
    assert.equal((await value(a, 'SELECT public.release_content_hold($1,$2,$3) AS value', [admin.auth, job.id, 'test release'])).ok, true);
    await a.query('COMMIT');
    assert.equal((await state.resultValue()).replayed, true);
    assert.equal((await one(a, 'SELECT status FROM public.content_reports WHERE id=$1', [report])).status, 'resolved');
    assert.equal((await one(a, 'SELECT held_at FROM public.assets WHERE job_id=$1', [job.id])).held_at, null);
    console.log('PASS R5 resolution: assets before report, release completes, replay returned');

    // Account erasure is unchanged: DELETE rechecks held_at and the queued key is not reaped.
    const erasing = await person(); job = await image(erasing);
    const prepared = await value(a, 'SELECT public.prepare_account_deletion($1) AS value', [erasing.auth]);
    assert.equal(prepared.eligible, true);
    await a.query('BEGIN'); await a.query('UPDATE public.assets SET held_at=now() WHERE job_id=$1', [job.id]);
    state = watch(value(b, 'SELECT public.erase_account($1,$2) AS value', [erasing.auth, prepared.confirmation_token]));
    await waitForLock(state); await a.query('COMMIT');
    assert.equal((await state.resultValue()).ok, true);
    assert.equal((await one(a, 'SELECT held_at IS NOT NULL AS held FROM public.assets WHERE job_id=$1', [job.id])).held, true);
    assert.equal(await value(a, 'SELECT public.asset_reap_allowed($1) AS value', [job.key]), false);
    console.log('PASS unchanged account erasure: held asset retained and reaper refused');

    // Twenty concurrent pairs are a regression guard; the migration documents the order proof.
    const recipient = await person();
    await a.query("SELECT public.ledger_grant($1,100,'grant:hardening',$2)", [recipient.id, randomUUID()]);
    for (let i = 0; i < 20; i++) {
        const owner = await person(), source = await image(owner), social = await target(owner, source);
        const [authorized, escalated] = await pair(
            () => value(a, 'SELECT public.authorize_social_target_dispatch($1,$2) AS value', [social.id, social.token]),
            () => value(b, 'SELECT public.record_csam_escalation($1,$2,$3,$4,$5) AS value', [admin.auth, owner.id, source.id, 'test preservation', randomUUID()]));
        assert.ok(authorized.ok || authorized.code === 'MEDIA_EVIDENCE_HELD'); assert.equal(escalated.ok, true);
        // unfreeze_account itself takes balance before user, as the production path does.
        await a.query("SELECT public.unfreeze_account($1,'test operator','test iteration')", [recipient.id]);
        const [result] = await pair(
            () => clawback(a, admin, recipient, randomUUID()),
            async () => {
                await b.query('BEGIN');
                try {
                    await b.query('SELECT 1 FROM public.credit_balances WHERE user_id=$1 FOR UPDATE', [recipient.id]);
                    await b.query("SELECT public.freeze_account($1,'test freeze',NULL)", [recipient.id]);
                    await b.query('COMMIT');
                } catch (error) { await b.query('ROLLBACK'); throw error; }
            });
        assert.ok(result.ok || result.code === 'ACCOUNT_FROZEN');
    }
    for (const name of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
        assert.equal((await q(a, `SELECT * FROM public.${name}()`)).length, 0);
    }
    console.log('PASS lock-order guard: 20 authorize/escalate + 20 clawback/freeze pairs, no 40P01; reconcile 0/0/0');
} finally {
    await a.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await b.query('ROLLBACK').catch(() => {});
    await Promise.all([a.end(), b.end()]);
}
