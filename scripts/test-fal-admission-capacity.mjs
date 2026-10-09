#!/usr/bin/env node
// Real concurrent transactions; refuses remote and non-disposable databases.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/(veyrnox_capacity|rebuild_check)$/.test(url.pathname)) {
    throw Error('a disposable local rebuild_check or veyrnox_capacity database is required');
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const model = `capacity-${randomUUID().slice(0,8)}`, endpoint = 'fal-ai/flux-2-pro';
let users = [], orphans = [], failures = 0;
const q = (sql, args = []) => pool.query(sql, args);
const admit = async (user, key = randomUUID(), free = false, payload = { prompt: 'test' }) =>
    (await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,$7) r', [user,key,model,{prompt:'test'},payload,endpoint,free])).r;
const balance = async user => (await one('SELECT balance FROM public.credit_balances WHERE user_id=$1',[user])).balance;
const counts = () => one('SELECT count(*)::int n, count(*) FILTER (WHERE released_at IS NULL)::int held, COALESCE(sum(cost_microusd),0)::int cost FROM public.fal_capacity_reservations');
async function user() {
    const id = randomUUID(); users.push(id);
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`${id}@example.invalid`]);
    return (await one('SELECT id FROM public.users WHERE auth_id=$1',[id])).id;
}
async function cleanup() {
    await q('DELETE FROM public.fal_capacity_reservations WHERE job_id IN (SELECT id FROM public.jobs WHERE model_id=$1) OR id=ANY($2::uuid[])',[model,orphans]);
    await q('DELETE FROM public.fal_dispatch WHERE job_id IN (SELECT id FROM public.jobs WHERE model_id=$1)',[model]);
    await q('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[users]);
    users=[]; orphans=[];
}
async function check(name, fn, { enabled = true } = {}) {
    try {
        await cleanup();
        await q('UPDATE public.fal_capacity_policy SET enabled=$1, provider_account=$2, model_id=$3, outstanding_limit=2, daily_limit=10, daily_budget_microusd=300000',[enabled,enabled?'local-fixture':null,model]);
        await fn(); console.log(`  ok ${name}`);
    } catch (error) { failures++; console.error(`  FAIL ${name}: ${error.message}`); }
}
try {
    // Earlier acceptance restores 0230. Reapply this slice before testing it.
    await q(await readFile(new URL('../packages/db/schema/supabase/0238_fal_admission_capacity.sql',import.meta.url),'utf8'));
    await q(await readFile(new URL('../packages/db/schema/supabase/0240_fal_reserved_only_admission.sql',import.meta.url),'utf8'));
    assert.equal((await one('SELECT enabled FROM public.fal_capacity_policy')).enabled,false);
    await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Capacity test','fal',$2,'text-to-image',2,0.03,'per_generation',false,true,3,10)`,[model,endpoint]);
    await check('default pause rejects before debit or free allowance', async () => {
        const u=await user(), before=await balance(u);
        for (const free of [false,true]) assert.equal((await admit(u,randomUUID(),free)).code,'PROVIDER_ADMISSION_PAUSED');
        assert.equal(await balance(u),before);
        assert.equal((await counts()).n,0);
        assert.equal((await one('SELECT count(*)::int n FROM public.jobs WHERE user_id=$1',[u])).n,0);
        assert.equal((await one('SELECT count(*)::int n FROM public.model_free_allowance_claims WHERE user_id=$1',[u])).n,0);
    },{enabled:false});
    await check('different-user admission races commit at most two debits', async () => {
        const uu=await Promise.all(Array.from({length:12},user));
        const before=await Promise.all(uu.map(balance));
        const rr=await Promise.all(uu.map(u=>admit(u)));
        assert.equal(rr.filter(r=>r.ok).length,2);
        assert.equal(rr.filter(r=>r.code==='PROVIDER_CAPACITY_UNAVAILABLE').length,10);
        for(let i=0;i<uu.length;i++) assert.equal(await balance(uu[i]),before[i]-(rr[i].ok?2:0));
        assert.deepEqual(await counts(),{n:2,held:2,cost:60000});
        const payload=(await one('SELECT payload FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id WHERE j.model_id=$1 LIMIT 1',[model])).payload;
        assert.deepEqual(payload,{prompt:'test',image_size:{width:1024,height:768}});
    });
    await check('free-admission races share the same provider cap without paid debits', async () => {
        const uu=await Promise.all(Array.from({length:12},user));
        const before=await Promise.all(uu.map(balance));
        const rr=await Promise.all(uu.map(u=>admit(u,randomUUID(),true)));
        assert.equal(rr.filter(r=>r.ok&&r.free).length,2);
        assert.equal(rr.filter(r=>r.code==='PROVIDER_CAPACITY_UNAVAILABLE').length,10);
        for(let i=0;i<uu.length;i++) assert.equal(await balance(uu[i]),before[i]);
        assert.deepEqual(await counts(),{n:2,held:2,cost:60000});
    });
    await check('equal replay at full/paused capacity reserves once; conflicts remain conflicts', async () => {
        const u=await user(), key=randomUUID(), first=await admit(u,key);
        assert.equal(first.ok,true);assert.equal((await admit(await user())).ok,true);
        for(const enabled of [true,false]) {
            await q('UPDATE public.fal_capacity_policy SET enabled=$1',[enabled]);
            const replay=await admit(u,key);assert.equal(replay.idempotent,true);assert.equal(replay.job_id,first.job_id);
            assert.equal((await admit(u,key,false,{prompt:'different'})).code,'IDEMPOTENCY_CONFLICT');
            assert.equal((await admit(u,key,false,{prompt:'test',num_images:99})).code,'IDEMPOTENCY_CONFLICT');
        }
        assert.equal((await counts()).n,2);
    });
    await check('last daily budget unit is serialized independently of outstanding slots', async () => {
        await q('UPDATE public.fal_capacity_policy SET daily_budget_microusd=30000');
        const uu=await Promise.all([user(),user()]);const rr=await Promise.all(uu.map(u=>admit(u)));
        assert.equal(rr.filter(r=>r.ok).length,1);assert.equal(rr.filter(r=>r.code==='PROVIDER_CAPACITY_UNAVAILABLE').length,1);
        assert.deepEqual(await counts(),{n:1,held:1,cost:30000});
    });
    await check('UNKNOWN remains held after refund and across UTC-day budget rollover', async () => {
        const u=await user(), job=await admit(u);
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'UNKNOWN',NULL)",[job.job_id,c.attempt_token]);
        await q("SELECT public.ledger_refund($1,$2,2,'refund:test')",[job.job_id,u]);
        await q("UPDATE public.fal_capacity_reservations SET admission_day=(now() AT TIME ZONE 'UTC')::date-1 WHERE job_id=$1",[job.job_id]);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,0);
        await q('UPDATE public.fal_capacity_policy SET outstanding_limit=1');
        assert.equal((await admit(await user())).code,'PROVIDER_CAPACITY_UNAVAILABLE');
        assert.equal((await counts()).held,1);
    });
    await check('definitive rejection releases once and never resets daily exposure', async () => {
        const first=await admit(await user());
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[first.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'REJECTED',NULL)",[first.job_id,c.attempt_token]);
        const rr=await Promise.all(Array.from({length:6},()=>one('SELECT public.release_fal_capacity() n')));
        assert.equal(rr.reduce((n,r)=>n+r.n,0),1);
        assert.deepEqual(await counts(),{n:1,held:0,cost:30000});
        await q('SELECT public.recover_fal_dispatch(25)');
        assert.equal((await admit(await user())).ok,true);
    });
    await check('accepted work stays held until matching STORED evidence; duplicate release is a no-op', async () => {
        const job=await admit(await user()), handle=randomUUID();
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'ACCEPTED',$3)",[job.job_id,c.attempt_token,handle]);
        await q('SELECT public.recover_fal_dispatch(25)');
        await q("SELECT public.job_succeeded($1,'fal')",[handle]);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,0);
        const stored=(await one("SELECT public.job_stored($1,'fal',$2,'image/png',100,NULL) r",[handle,`capacity/${randomUUID()}.png`])).r;
        assert.equal(stored.ok,true);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,1);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,0);
        assert.deepEqual(await counts(),{n:1,held:0,cost:30000});
    });
    await check('accepted work refunded without provider termination remains held', async () => {
        const u=await user(),job=await admit(u),handle=randomUUID();
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'ACCEPTED',$3)",[job.job_id,c.attempt_token,handle]);
        await q('SELECT public.recover_fal_dispatch(25)');
        await q("SELECT public.ledger_refund($1,$2,2,'refund:test')",[job.job_id,u]);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,0);
        assert.equal((await counts()).held,1);
    });
    await check('pre-claim closure releases occupancy but retains conservative exposure', async () => {
        const u=await user(),job=await admit(u);
        await q("SELECT public.ledger_refund($1,$2,2,'refund:test')",[job.job_id,u]);
        await q('SELECT public.recover_fal_dispatch(25)');
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,1);
        assert.equal((await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r.disposition,'INELIGIBLE');
        assert.deepEqual(await counts(),{n:1,held:0,cost:30000});
    });
    await check('daily count limit stays consumed after outstanding work releases', async () => {
        await q('UPDATE public.fal_capacity_policy SET daily_limit=1');
        const job=await admit(await user());
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'REJECTED',NULL)",[job.job_id,c.attempt_token]);
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,1);
        assert.equal((await admit(await user())).code,'PROVIDER_CAPACITY_UNAVAILABLE');
        assert.equal((await counts()).n,1);
    });
    await check('unreserved legacy replay keeps its original payload contract while paused', async () => {
        const u=await user(),key=randomUUID();
        await q('UPDATE public.fal_capacity_policy SET enabled=false');
        const legacy=(await one("SELECT public.ledger_debit($1,$2,2,'debit:generation',$3,$4,10,60) r",[u,key,model,{prompt:'test'}])).r;
        await q('INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES($1,$2,$3)',[legacy.job_id,endpoint,{prompt:'test'}]);
        await q('UPDATE public.fal_capacity_policy SET enabled=false');
        const replay=await admit(u,key);assert.equal(replay.idempotent,true);assert.equal(replay.job_id,legacy.job_id);
        assert.equal((await counts()).n,0);
    });
    await check('reservation insertion failure rolls back paid debit and free claim', async () => {
        await q("CREATE FUNCTION public.capacity_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation outage'; END $$; CREATE TRIGGER capacity_test_fail BEFORE INSERT ON public.fal_capacity_reservations FOR EACH ROW EXECUTE FUNCTION public.capacity_test_fail()");
        try {
            const u=await user(), before=await balance(u);
            for(const free of [false,true]) await assert.rejects(admit(u,randomUUID(),free),/injected reservation outage/);
            assert.equal(await balance(u),before);
            assert.equal((await counts()).n,0);
            assert.equal((await one('SELECT count(*)::int n FROM public.jobs WHERE user_id=$1',[u])).n,0);
            assert.equal((await one('SELECT count(*)::int n FROM public.model_free_allowance_claims WHERE user_id=$1',[u])).n,0);
        } finally { await q('DROP TRIGGER capacity_test_fail ON public.fal_capacity_reservations; DROP FUNCTION public.capacity_test_fail()'); }
    });
    await check('free jobs consume provider reservation/budget without a paid debit', async () => {
        const u=await user(),before=await balance(u),job=await admit(u,randomUUID(),true);
        assert.equal(job.free,true);assert.equal(await balance(u),before);
        assert.deepEqual(await counts(),{n:1,held:1,cost:30000});
        assert.equal((await one('SELECT count(*)::int n FROM public.ledger_entries WHERE job_id=$1',[job.job_id])).n,0);
    });
    await check('older unreserved UNKNOWN is counted instead of silently grandfathered', async () => {
        const u=await user(), job=await admit(u);
        const c=(await one('SELECT public.claim_fal_dispatch($1) r',[job.job_id])).r;
        await q("SELECT public.record_fal_dispatch($1,$2,'UNKNOWN',NULL)",[job.job_id,c.attempt_token]);
        await q('DELETE FROM public.fal_capacity_reservations WHERE job_id=$1',[job.job_id]);
        await q('UPDATE public.fal_capacity_policy SET outstanding_limit=1');
        assert.equal((await admit(await user())).code,'PROVIDER_CAPACITY_UNAVAILABLE');
    });
    await check('outbox deletion retains cost and unresolved provider occupancy', async () => {
        const u=await user(),job=await admit(u);
        const r=await one('SELECT id FROM public.fal_capacity_reservations WHERE job_id=$1',[job.job_id]);orphans.push(r.id);
        await q('DELETE FROM public.fal_dispatch WHERE job_id=$1',[job.job_id]);
        assert.deepEqual(await one('SELECT job_id,released_at,cost_microusd FROM public.fal_capacity_reservations WHERE id=$1',[r.id]),{job_id:null,released_at:null,cost_microusd:30000});
        assert.equal((await one('SELECT public.release_fal_capacity() n')).n,0);
    });
    await check('browser roles cannot read/write capacity or execute release', async () => {
        for(const role of ['anon','authenticated']) {
            for(const table of ['fal_capacity_policy','fal_capacity_reservations']) {
                assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') p",[role,`public.${table}`])).p,false);
                assert.equal((await one('SELECT relforcerowsecurity p FROM pg_class WHERE oid=$1::regclass',[`public.${table}`])).p,true);
            }
            assert.equal((await one("SELECT has_function_privilege($1,'public.release_fal_capacity(integer)','EXECUTE') p",[role])).p,false);
        }
    });
    for(const name of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) assert.equal((await q(`SELECT * FROM public.${name}()`)).rows.length,0,name);
} finally {
    await cleanup();
    await q("UPDATE public.fal_capacity_policy SET enabled=false,provider_account=NULL,model_id='flux-2-pro',outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000");
    await pool.end();
}
if(failures) process.exitCode=1;
