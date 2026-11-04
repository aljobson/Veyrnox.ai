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
const promptBoundsMigration = await readFile(new URL('../packages/db/schema/supabase/0406_generation_prompt_payload_bounds.sql', import.meta.url), 'utf8');
const aspectMigration = await readFile(new URL('../packages/db/schema/supabase/0439_flux_aspect_image_size.sql', import.meta.url), 'utf8');
const defaultSize = {width:1024,height:768};
const sizes = [{width:960,height:960},defaultSize,{width:768,height:1024},{width:1024,height:576},{width:576,height:1024}];
let user, checks = 0;
const tally = () => one(`SELECT balance,free_balance,subscription_balance,
 (SELECT count(*)::int FROM public.jobs WHERE user_id=$1) jobs,
 (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1) ledger,
 (SELECT count(*)::int FROM public.model_free_allowance_claims WHERE user_id=$1) claims,
 (SELECT count(*)::int FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id WHERE j.user_id=$1) intents,
 (SELECT count(*)::int FROM public.fal_capacity_reservations r JOIN public.jobs j ON j.id=r.job_id WHERE j.user_id=$1) reservations
 FROM public.credit_balances WHERE user_id=$1`, [user]);
const reservations = async () => (await q('SELECT to_jsonb(r) row FROM public.fal_capacity_reservations r ORDER BY id')).rows;
const admit = (payload, free = false, key = randomUUID(), inputs = {prompt:'fixture'}) => one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,$7) r',
    [user,key,model,inputs,payload,'fal-ai/flux-2-pro',free]).then(x => x.r);
async function refused(payload, free, code = 'MODEL_UNAVAILABLE') {
    const before = await tally(), rows = await reservations();
    assert.deepEqual(await admit(payload,free), {ok:false,code,
        ...(code.startsWith('PROVIDER_') ? {retry_after_seconds:60} : {})});
    assert.deepEqual(await tally(),before);
    assert.deepEqual(await reservations(),rows);
}
async function check(name, fn) {
    await q('SAVEPOINT scenario');
    try { await fn(); checks++; console.log(`ok ${name}`); }
    finally { await q('ROLLBACK TO SAVEPOINT scenario'); await q('RELEASE SAVEPOINT scenario'); }
}
try {
    const before = await one('SELECT to_jsonb(p) policy FROM public.fal_capacity_policy p');
    await q(migration); await q(migration); await q(promptBoundsMigration); await q(promptBoundsMigration);
    await q(aspectMigration);
    const definition = await one("SELECT pg_get_functiondef('public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) body");
    await q(aspectMigration);
    assert.deepEqual(await one("SELECT pg_get_functiondef('public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) body"),definition);
    assert.equal((definition.body.match(/262144/g) || []).length,3);
    assert.equal((await one("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admit_fal_dispatch'")).n,1);
    assert.deepEqual(await one('SELECT to_jsonb(p) policy FROM public.fal_capacity_policy p'), before);
    for (const [signature, serviceAllowed] of [
        ['public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)',true],
        ['private.fal_flux_admitted_payload(jsonb)',false]
    ]) {
        for (const [role, allowed] of [['service_role',serviceAllowed],['public',false],['anon',false],['authenticated',false]]) {
            const row = await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature]);
            assert.equal(row.allowed, allowed,`${role} on ${signature}`);
        }
    }
    await q('BEGIN');
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
    user = (await one('SELECT id FROM public.users WHERE auth_id=$1',[auth])).id;
    await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Payload fixture','fal','fal-ai/flux-2-pro','text-to-image',2,0.03,'per_generation',true,3,10)`,[model]);
    await q("UPDATE public.fal_capacity_policy SET enabled=true,provider_account='local-payload-fixture',model_id=$1",[model]);
    await q('UPDATE public.fal_admission_control SET paused=false');
    await check('pre-migration reserved job replays after 0439 without another effect',async()=>{
        await q(migration); await q(promptBoundsMigration);
        const payload={prompt:'legacy',seed:42},key=randomUUID();
        const legacy=await admit(payload,false,key);assert.equal(legacy.ok,true);
        const before=await tally(),rows=await reservations();
        await q(aspectMigration);await q(aspectMigration);
        for (const replayPayload of [payload,{...payload,image_size:defaultSize}]) {
            const replay=await admit(replayPayload,false,key);
            assert.equal(replay.idempotent,true);assert.equal(replay.job_id,legacy.job_id);
        }
        assert.deepEqual(await tally(),before);assert.deepEqual(await reservations(),rows);
    });
    for (const free of [false,true]) {
        // Send raw JSON text so JavaScript cannot normalize 1024.0 or exponent notation first.
        const equivalentPayloads = ['1024','1024.0','1.024e3'].map(width=>
            `{"prompt":"fixture","image_size":{"width":${width},"height":768}}`);
        for (const payload of equivalentPayloads) {
            await check(`${free?'free':'paid'} numeric size ${payload} stores canonically and replays every form`,async()=>{
                const key=randomUUID(),result=await admit(payload,free,key);
                assert.equal(result.ok,true);assert.equal(result.free,free);
                // Text equality catches retained numeric scale that JSONB equality (or JS parsing) hides.
                const stored=await one(`SELECT payload,
                    (payload->'image_size')::text = '{"width":1024,"height":768}'::jsonb::text canonical
                    FROM public.fal_dispatch WHERE job_id=$1`,[result.job_id]);
                assert.deepEqual(stored.payload,{prompt:'fixture',image_size:defaultSize});
                assert.equal(stored.canonical,true);
                const before=await tally(),rows=await reservations();
                for (const replayPayload of equivalentPayloads) {
                    const replay=await admit(replayPayload,free,key);
                    assert.equal(replay.idempotent,true);assert.equal(replay.job_id,result.job_id);
                }
                assert.deepEqual(await tally(),before);assert.deepEqual(await reservations(),rows);
            });
        }
        for (const image_size of [undefined,...sizes]) {
            await check(`${free?'free':'paid'} size ${JSON.stringify(image_size) || 'omitted'} stores and replays once`,async()=>{
                const payload={prompt:'fixture',...(image_size ? {image_size,seed:42} : {})},key=randomUUID();
                const before=await tally(),result=await admit(payload,free,key);
                assert.equal(result.ok,true);assert.equal(result.free,free);
                assert.deepEqual((await one('SELECT payload FROM public.fal_dispatch WHERE job_id=$1',[result.job_id])).payload,
                    {...payload,image_size:image_size || defaultSize});
                assert.deepEqual(await one('SELECT cost_microusd,released_at FROM public.fal_capacity_reservations WHERE job_id=$1',[result.job_id]),
                    {cost_microusd:30000,released_at:null});
                const after=await tally(),rows=await reservations();
                assert.equal(after.balance,before.balance-(free?0:2));
                for (const field of ['jobs','intents','reservations']) assert.equal(after[field],before[field]+1);
                assert.equal(after.ledger,before.ledger+(free?0:1));assert.equal(after.claims,before.claims+(free?1:0));
                const replay=await admit(payload,free,key);
                assert.equal(replay.idempotent,true);assert.equal(replay.job_id,result.job_id);
                const different=sizes.find(size=>JSON.stringify(size)!==JSON.stringify(image_size || defaultSize));
                assert.equal((await admit({...payload,image_size:different},free,key)).code,'IDEMPOTENCY_CONFLICT');
                assert.equal((await admit(payload,free,key,{prompt:'changed'})).code,'IDEMPOTENCY_CONFLICT');
                assert.equal((await admit({...payload,image_size:'invalid'},free,key)).code,'IDEMPOTENCY_CONFLICT');
                assert.equal((await admit({...payload,extra:true},free,key)).code,'IDEMPOTENCY_CONFLICT');
                assert.deepEqual(await tally(),after);assert.deepEqual(await reservations(),rows);
            });
        }
        for (const explicitFirst of [false,true]) {
            await check(`${free?'free':'paid'} omitted/default equivalence, explicit first=${explicitFirst}, survives pause`,async()=>{
                const omitted={prompt:'fixture',seed:42},explicit={...omitted,image_size:defaultSize},key=randomUUID();
                const result=await admit(explicitFirst?explicit:omitted,free,key);assert.equal(result.ok,true);
                const before=await tally(),rows=await reservations();
                await q('UPDATE public.fal_capacity_policy SET enabled=false');
                const replay=await admit(explicitFirst?omitted:explicit,free,key);
                assert.equal(replay.idempotent,true);assert.equal(replay.job_id,result.job_id);
                assert.deepEqual(await tally(),before);assert.deepEqual(await reservations(),rows);
            });
        }
        const invalidSizes = [
            {width:1024,height:1024},'landscape_16_9',{...defaultSize,extra:true},
            {width:1024.5,height:768},{width:1024,height:768.5},
            {width:'1024',height:768},{width:1024,height:'768'},
            {width:true,height:768},{width:1024,height:null},
            {width:[1024],height:768},{width:1024,height:{}},
            {width:1024},{height:768},{},null,[],[1024,768],42,true
        ];
        for (const image_size of invalidSizes) {
            await check(`${free?'free':'paid'} invalid size ${JSON.stringify(image_size)} has no effects`,async()=>{
                await refused({prompt:'fixture',image_size},free);
            });
        }
        await check(`${free?'free':'paid'} extra keys remain unavailable`,async()=>{
            for (const key of ['num_images','extra','width']) {
                await refused({prompt:'fixture',image_size:sizes[0],[key]:1},free);
            }
        });
        for (const limit of ['daily_budget_microusd','outstanding_limit','daily_limit']) {
            await check(`${free?'free':'paid'} non-default size honors exhausted ${limit}`,async()=>{
                const value=limit==='daily_budget_microusd'?30000:1;
                // Column names are the fixed local list above, never caller input.
                await q(`UPDATE public.fal_capacity_policy SET ${limit}=$1`,[value]);
                const result=await admit({prompt:'fixture',image_size:sizes[0]},free);
                assert.equal(result.ok,true);
                assert.equal((await one('SELECT cost_microusd FROM public.fal_capacity_reservations WHERE job_id=$1',[result.job_id])).cost_microusd,30000);
                await refused({prompt:'fixture',image_size:sizes[2]},free,'PROVIDER_CAPACITY_UNAVAILABLE');
                // Shape refusal wins over an exhausted budget/cap, just like an extra key.
                await refused({prompt:'fixture',image_size:'invalid'},free);
                await refused({prompt:'fixture',extra:true},free);
            });
        }
        await check(`${free?'free':'paid'} paused policy wins over invalid size and extra keys`,async()=>{
            await q('UPDATE public.fal_capacity_policy SET enabled=false');
            await refused({prompt:'fixture',image_size:'invalid'},free,'PROVIDER_ADMISSION_PAUSED');
            await refused({prompt:'fixture',extra:true},free,'PROVIDER_ADMISSION_PAUSED');
        });
        await check(`${free?'free':'paid'} refusal housekeeping matches historical extra-key refusal`,async()=>{
            const first=await admit({prompt:'fixture'});assert.equal(first.ok,true);
            const held=await admit({prompt:'fixture'});assert.equal(held.ok,true);
            const claim=(await one('SELECT public.claim_fal_dispatch($1) r',[first.job_id])).r;
            await q("SELECT public.record_fal_dispatch($1,$2,'REJECTED',NULL)",[first.job_id,claim.attempt_token]);
            const before=await tally(),rows=await reservations();
            // Compare from the same starting state, including a releasable reservation.
            await q('SAVEPOINT historical');
            await q(migration);await q(promptBoundsMigration);
            assert.deepEqual(await admit({prompt:'fixture',extra:true},free),{ok:false,code:'MODEL_UNAVAILABLE'});
            const historicalRows=await reservations();
            assert.deepEqual(await tally(),before);
            await q('ROLLBACK TO SAVEPOINT historical');await q('RELEASE SAVEPOINT historical');
            assert.deepEqual(await admit({prompt:'fixture',image_size:'invalid'},free),{ok:false,code:'MODEL_UNAVAILABLE'});
            assert.deepEqual(await tally(),before);assert.deepEqual(await reservations(),historicalRows);
            assert.notDeepEqual(historicalRows,rows);
            assert.equal(historicalRows.find(r=>r.row.job_id===first.job_id).row.release_reason,'REJECTED');
            assert.deepEqual(historicalRows.find(r=>r.row.job_id===held.job_id),rows.find(r=>r.row.job_id===held.job_id));
        });
    }
    const { max_prompt: max } = await one(`SELECT 262144-octet_length((jsonb_build_object('prompt','')||'{"image_size":{"width":1024,"height":768}}'::jsonb)::text) max_prompt`);
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
            assert.equal((await one('SELECT octet_length(payload::text) bytes FROM public.fal_dispatch WHERE job_id=$1',[result.job_id])).bytes,262144);
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
