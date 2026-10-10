#!/usr/bin/env node
// Only a disposable local database; never calls providers or applies live policy.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { admitFalDispatch } from '../lib/falDispatch.js';
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/rebuild_check') {
    throw Error('disposable localhost rebuild_check required');
}
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const q = (sql, args = []) => client.query(sql, args);
const one = async (sql, args = []) => (await q(sql, args)).rows[0];
const model = `payload-${randomUUID().slice(0,8)}`, auth = randomUUID();
const migration = await readFile(new URL('../packages/db/schema/supabase/0243_fal_pinned_payload_validation.sql', import.meta.url), 'utf8');
let user, checks = 0;
const tally = () => one(`SELECT balance,free_balance,subscription_balance,
 (SELECT count(*)::int FROM public.jobs WHERE user_id=$1) jobs,
 (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) ledger,
 (SELECT count(*)::int FROM public.model_free_allowance_claims WHERE user_id=$1) claims,
 (SELECT count(*)::int FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id WHERE j.user_id=$1) intents,
 (SELECT count(*)::int FROM public.fal_capacity_reservations r JOIN public.jobs j ON j.id=r.job_id WHERE j.user_id=$1) reservations
 FROM public.credit_balances WHERE user_id=$1`, [user]);
const admit = (payload, free = false, key = randomUUID()) => one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,$7) r',
    [user,key,model,{prompt:'fixture'},payload,'fal-ai/flux-2-pro',free]).then(x => x.r);
async function check(name, fn) {
    await q('SAVEPOINT scenario');
    try { await fn(); checks++; console.log(`ok ${name}`); }
    finally { await q('ROLLBACK TO SAVEPOINT scenario'); await q('RELEASE SAVEPOINT scenario'); }
}
try {
    const before = await one('SELECT to_jsonb(p) policy FROM public.fal_capacity_policy p');
    await q(migration); await q(migration);
    assert.deepEqual(await one('SELECT to_jsonb(p) policy FROM public.fal_capacity_policy p'), before);
    for (const [role, allowed] of [['service_role',true],['anon',false],['authenticated',false]]) {
        const row = await one("SELECT has_function_privilege($1,'public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)','EXECUTE') allowed",[role]);
        assert.equal(row.allowed, allowed);
    }
    await q('BEGIN');
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
    user = (await one('SELECT id FROM public.users WHERE auth_id=$1',[auth])).id;
    await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Payload fixture','fal','fal-ai/flux-2-pro','text-to-image',2,0.03,'per_generation',true,3,10)`,[model]);
    await q("UPDATE public.fal_capacity_policy SET enabled=true,provider_account='local-payload-fixture',model_id=$1",[model]);
    await q('UPDATE public.fal_admission_control SET paused=false');
    const { max_prompt: max } = await one(`SELECT 16384-octet_length((jsonb_build_object('prompt','')||'{"image_size":{"width":1024,"height":768}}'::jsonb)::text) max_prompt`);
    for (const free of [false,true]) {
        await check(`over-limit ASCII payload rejects without ${free?'free claim':'paid debit'}`,async()=>{
            const before=await tally();
            assert.deepEqual(await admit({prompt:'x'.repeat(max+1)},free),{ok:false,code:'INVALID_INPUTS'});
            assert.deepEqual(await tally(),before);
        });
        await check(`HTTP admission returns 400 without publication for ${free?'free':'paid'} oversize input`,async()=>{
            const before=await tally();let published=0;
            const response=await admitFalDispatch({userId:user,key:randomUUID(),model:{id:model,provider_endpoint:'fal-ai/flux-2-pro'},
                record:{inputs:{prompt:{}},rename:{},media:{},fixed:{}},inputs:{prompt:'x'.repeat(max+1)},jobInputs:{prompt:'fixture'},free,cfg:{},
                rpc:async(_name,args)=>(await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,$7) r',
                    [args.p_user_id,args.p_idempotency_key,args.p_model_id,args.p_inputs,args.p_payload,args.p_endpoint,args.p_allow_free])).r,
                onCommitted:async()=>{published++;}});
            assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid_inputs'});
            assert.equal(published,0);assert.deepEqual(await tally(),before);
        });
        await check(`UTF-8 bytes reject without ${free?'free claim':'paid debit'}`,async()=>{
            const before=await tally();
            const payload={prompt:'é'.repeat(Math.floor(max/2)+1)};
            assert.ok(payload.prompt.length<max);
            assert.deepEqual(await admit(payload,free),{ok:false,code:'INVALID_INPUTS'});
            assert.deepEqual(await tally(),before);
        });
        await check(`exact byte limit accepts and replays one ${free?'free claim':'paid debit'}`,async()=>{
            const payload={prompt:'x'.repeat(max)},key=randomUUID(),before=await tally();
            const result=await admit(payload,free,key);assert.equal(result.ok,true);assert.equal(result.free,free);
            const after=await tally();assert.equal(after.balance,before.balance-(free?0:2));
            assert.equal(after.ledger,before.ledger+(free?0:1));assert.equal(after.claims,before.claims+(free?1:0));
            assert.equal(after.jobs,before.jobs+1);assert.equal(after.intents,before.intents+1);assert.equal(after.reservations,before.reservations+1);
            assert.equal((await one('SELECT octet_length(payload::text) bytes FROM public.fal_dispatch WHERE job_id=$1',[result.job_id])).bytes,16384);
            const replay=await admit(payload,free,key);assert.equal(replay.idempotent,true);assert.equal(replay.job_id,result.job_id);
            assert.deepEqual(await tally(),after);
            assert.equal((await admit({prompt:'changed'},free,key)).code,'IDEMPOTENCY_CONFLICT');
            assert.deepEqual(await tally(),after);
        });
    }
    console.log(`${checks} pinned payload cases passed; migration replay and grants preserved`);
} finally {
    await q('ROLLBACK').catch(()=>{});
    await client.end();
}
