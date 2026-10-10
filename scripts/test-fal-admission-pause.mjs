#!/usr/bin/env node
// Only disposable local databases; no provider calls or live policy writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost','127.0.0.1'].includes(url.hostname) || !/^\/(veyrnox_capacity|rebuild_check)$/.test(url.pathname)) {
    throw Error('disposable localhost rebuild_check or veyrnox_capacity required');
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const q = (sql,args=[]) => pool.query(sql,args);
const one = async(sql,args=[]) => (await q(sql,args)).rows[0];
const tag=randomUUID().slice(0,8), models={}, auth=randomUUID();
let user, cases=0;
const pause = value => q('UPDATE public.fal_admission_control SET paused=$1',[value]);
const paid = (model,key=randomUUID(),client=pool) => client.query('SELECT public.ledger_debit($1,$2,2,$3,$4,$5) r',
    [user,key,'debit:generation',model,{prompt:'test'}]).then(r=>r.rows[0].r);
const free = (model,key=randomUUID()) => one('SELECT public.submit_free_job($1,$2,$3,$4) r',[user,key,model,{prompt:'test'}]).then(r=>r.r);
const tally = () => one(`SELECT (SELECT balance FROM public.credit_balances WHERE user_id=$1) balance,
    (SELECT count(*)::int FROM public.jobs WHERE user_id=$1) jobs,
    (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) ledger,
    (SELECT count(*)::int FROM public.model_free_allowance_claims WHERE user_id=$1) claims`,[user]);
const migration = await readFile(new URL('../packages/db/schema/supabase/0239_fal_admission_pause.sql',import.meta.url),'utf8');
const reservedMigration = await readFile(new URL('../packages/db/schema/supabase/0240_fal_reserved_only_admission.sql',import.meta.url),'utf8');
async function check(name,fn) { await fn(); cases++; console.log(`  ok ${name}`); }
try {
    // Earlier suites reapply predecessor RPCs; restore this slice before testing.
    await q(migration);
    await q(reservedMigration);
    assert.equal((await one('SELECT paused FROM public.fal_admission_control')).paused,false);
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
    user=(await one('SELECT id FROM public.users WHERE auth_id=$1',[auth])).id;
    for (const provider of ['fal','veyrnox','kie']) {
        models[provider]=`pause-${provider}-${tag}`;
        await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,
            provider_cost_per_unit,cost_unit,gated_flag,active,free_allowance_per_day,free_allowance_daily_budget)
            VALUES($1,'Pause fixture',$2,$3,'text-to-image',2,0.03,'per_generation',false,true,3,10)`,
            [models[provider],provider,provider==='fal'?'fal-ai/flux-2-pro':'fixture:v1']);
    }
    await check('inactive control preserves admission; migration replay preserves operator pause',async()=>{
        assert.equal((await paid(models.fal)).ok,true);
        await pause(true); await q(migration); await q(reservedMigration);
        assert.equal((await one('SELECT paused FROM public.fal_admission_control')).paused,true);
    });
    await check('paid and free fal/composite admissions stop without any job, debit or allowance effect',async()=>{
        const before=await tally();
        const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?free:paid)(i%3?models.fal:models.veyrnox)));
        assert.ok(results.every(r=>r.ok===false&&r.code==='PROVIDER_ADMISSION_PAUSED'&&r.retry_after_seconds===60));
        assert.deepEqual(await tally(),before);
    });
    await check('unrelated providers still admit paid and free jobs while fal is paused',async()=>{
        assert.equal((await paid(models.kie)).ok,true);
        const result=await free(models.kie);assert.equal(result.ok,true);assert.equal(result.taken,true);
    });
    await check('paid and free same-key replay works while paused without another effect',async()=>{
        await pause(false);
        const paidKey=randomUUID(), freeKey=randomUUID();
        const a=await paid(models.veyrnox,paidKey),b=await free(models.fal,freeKey);
        assert.equal(a.ok,true);assert.equal(b.taken,true);await pause(true);
        const before=await tally(),aa=await paid(models.veyrnox,paidKey),bb=await free(models.fal,freeKey);
        assert.equal(aa.idempotent,true);assert.equal(aa.job_id,a.job_id);
        assert.equal(bb.idempotent,true);assert.equal(bb.job_id,b.job_id);
        assert.deepEqual(await tally(),before);
    });
    await check('durable admission honors independent pause, replays and existing claims still drain',async()=>{
        await pause(false);
        await q("UPDATE public.fal_capacity_policy SET enabled=true,provider_account='pause-fixture',model_id=$1,outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000",[models.fal]);
        const admit=(key,allowFree=false)=>one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,$6) r',
            [user,key,models.fal,{prompt:'test'},'fal-ai/flux-2-pro',allowFree]).then(r=>r.r);
        const key=randomUUID(),first=await admit(key);assert.equal(first.ok,true);
        await pause(true);const before=await tally();
        for(const f of [false,true]) assert.equal((await admit(randomUUID(),f)).code,'PROVIDER_ADMISSION_PAUSED');
        assert.equal((await admit(key)).job_id,first.job_id);assert.deepEqual(await tally(),before);
        assert.equal((await one('SELECT count(*)::int n FROM public.fal_capacity_reservations WHERE job_id IN (SELECT id FROM public.jobs WHERE user_id=$1)',[user])).n,1);
        const claim=(await one('SELECT public.claim_fal_dispatch($1) r',[first.job_id])).r;
        assert.equal(claim.disposition,'CLAIMED');assert.ok(claim.attempt_token);
        await q("SELECT public.record_fal_dispatch($1,$2,'REJECTED',NULL)",[first.job_id,claim.attempt_token]);
        assert.equal((await one('SELECT public.recover_fal_dispatch(25) r')).r.ok,true);
        assert.ok((await one('SELECT projected_at FROM public.fal_dispatch WHERE job_id=$1',[first.job_id])).projected_at);
        assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1',[first.job_id])).state,'REFUNDED');
    });
    await check('pause commit waits for an in-flight admission; later admissions stop',async()=>{
        await q('UPDATE public.fal_capacity_policy SET enabled=false');
        await pause(false);
        const admission=await pool.connect(),operator=await pool.connect();
        let update;
        try {
            await admission.query('BEGIN');
            const admitted=await paid(models.fal,randomUUID(),admission);assert.equal(admitted.ok,true);
            const pid=(await admission.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            const operatorPid=(await operator.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            update=operator.query('UPDATE public.fal_admission_control SET paused=true');
            let blocked=false;
            for(let i=0;i<50&&!blocked;i++) {
                blocked=(await one('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[pid,operatorPid])).blocked;
                if(!blocked) await new Promise(resolve=>setTimeout(resolve,10));
            }
            assert.equal(blocked,true,'operator must wait for the admission transaction');
            await admission.query('COMMIT');await update;
            assert.equal((await paid(models.fal)).code,'PROVIDER_ADMISSION_PAUSED');
        } finally {
            await admission.query('ROLLBACK');if(update) await update;
            admission.release();operator.release();
        }
    });
    await check('missing control row fails closed for fal and composites',async()=>{
        const client=await pool.connect();
        try {
            await client.query('BEGIN');await client.query('DELETE FROM public.fal_admission_control');
            for(const model of [models.fal,models.veyrnox]) assert.equal((await paid(model,randomUUID(),client)).code,'PROVIDER_ADMISSION_PAUSED');
        } finally { await client.query('ROLLBACK');client.release(); }
    });
    await check('forced RLS and RPC/table privileges keep policy private and operator-only',async()=>{
        assert.deepEqual(await one("SELECT relrowsecurity rls,relforcerowsecurity forced FROM pg_class WHERE oid='public.fal_admission_control'::regclass"),{rls:true,forced:true});
        for(const role of ['anon','authenticated','service_role']) {
            assert.equal((await one("SELECT has_table_privilege($1,'public.fal_admission_control','UPDATE') yes",[role])).yes,false);
            assert.equal((await one("SELECT has_function_privilege($1,'private.fal_admission_paused(text)','EXECUTE') yes",[role])).yes,false);
            if(role!=='service_role') assert.equal((await one("SELECT has_table_privilege($1,'public.fal_admission_control','SELECT') yes",[role])).yes,false);
        }
    });
    for(const name of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) {
        assert.equal((await q(`SELECT * FROM public.${name}()`)).rows.length,0,name);
    }
    console.log(`${cases} fal admission pause checks passed; all credit reconciliation checks clean`);
} finally {
    await q('DELETE FROM public.fal_capacity_reservations WHERE job_id IN (SELECT id FROM public.jobs WHERE user_id=$1)',[user]);
    await q('DELETE FROM public.fal_dispatch WHERE job_id IN (SELECT id FROM public.jobs WHERE user_id=$1)',[user]);
    await q("UPDATE public.fal_capacity_policy SET enabled=false,provider_account=NULL,model_id='flux-2-pro',outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000");
    await pause(false);await q('DELETE FROM auth.users WHERE id=$1',[auth]);await pool.end();
}
