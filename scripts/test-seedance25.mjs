#!/usr/bin/env node
// Run after scripts/replay-migrations.mjs against a disposable local database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || /supabase\.(co|com)/.test(url)) throw new Error('A disposable local DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
    await c.query('BEGIN');
    // ledger-tests.yml disables this trigger on rebuild_check for the legacy accounting fixtures that run before this
    // script. The checks below need the real guard, so switch it on inside this transaction (rolled back at the end).
    await c.query('ALTER TABLE public.jobs ENABLE TRIGGER jobs_provider_spend_guard');
    // Replays cannot commit the test transaction or leave older function definitions installed.
    const migration = (await readFile(new URL('../packages/db/schema/supabase/0595_seedance25_edit_extend_standby.sql', import.meta.url), 'utf8'))
        .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
    const otherRows = async () => (await c.query("SELECT * FROM public.model_routes WHERE model_id NOT IN ('seedance-2.5-edit','seedance-2.5-extend') ORDER BY id")).rows;
    const before = await otherRows();
    await c.query(migration); await c.query(migration);
    assert.deepEqual(await otherRows(), before, 'other offers and routes untouched');
    const rows = (await c.query("SELECT c.id,c.active,c.gated_flag,c.credits_5s,r.state,r.provenance FROM public.model_catalog c JOIN public.model_routes r ON r.model_id=c.id WHERE c.id LIKE 'seedance-2.5-%' ORDER BY c.id")).rows;
    assert.deepEqual(rows, [
        { id:'seedance-2.5-edit',active:false,gated_flag:true,credits_5s:76,state:'standby',provenance:'licensed_reseller' },
        { id:'seedance-2.5-extend',active:false,gated_flag:true,credits_5s:78,state:'standby',provenance:'licensed_reseller' },
    ]);
    const parity=(await c.query("SELECT parity_record FROM public.model_routes WHERE model_id IN ('seedance-2.5-edit','seedance-2.5-extend')")).rows;
    for(const row of parity)for(const id of ['56f01a0a-3be4-4574-987e-c87bdaa6af42','a0e30731-2552-47fd-91ae-f15a0f0395b0'])assert.ok(row.parity_record.includes(id));
    for (const [task, unit, cost] of [['edit',76,1348000],['extend',78,1388000]]) {
        for (const seconds of (task==='edit' ? [4,5,5.055,10] : [4,5,5.055,6])) {
            const units = task==='edit' ? Math.ceil(seconds/5) : 1, credits=unit*units;
            const inputs={seedance25_billing:{source_seconds:seconds,units,credits}};
            const result=(await c.query('SELECT * FROM private.provider_spend_model_cost($1,$2,$3)',[`seedance-2.5-${task}`,inputs,credits])).rows[0];
            assert.deepEqual(result,{provider:'crun',purpose:'job',cost_microusd:String(cost*units)});
        }
        for (const inputs of [{duration_seconds:5},{seedance25_billing:{source_seconds:11,units:1,credits:unit}},
            {seedance25_billing:{source_seconds:5.055,units:99,credits:unit}},
            {seedance25_billing:{source_seconds:task==='edit'?10.1:6.1,units:1,credits:unit}},
            {seedance25_billing:{source_seconds:5,units:1,credits:'forged'}}]) {
            await c.query('SAVEPOINT invalid_bill');
            await assert.rejects(c.query('SELECT * FROM private.provider_spend_model_cost($1,$2,$3)',[`seedance-2.5-${task}`,inputs,unit]), /PROVIDER_SPEND_LIMIT:closed:60/);
            await c.query('ROLLBACK TO SAVEPOINT invalid_bill');
        }
    }
    const fixture=(await c.query("INSERT INTO public.users(id,auth_id,email) VALUES(gen_random_uuid(),gen_random_uuid()::text,'seedance25-acceptance@example.test') RETURNING id,auth_id")).rows[0];
    await c.query('INSERT INTO public.credit_balances(user_id,balance) VALUES($1,1000) ON CONFLICT(user_id) DO UPDATE SET balance=1000',[fixture.id]);
    // Quote attempts have their own durable, bounded counter, not generation's.
    const generationCounter=async()=> (await c.query('SELECT * FROM public.generation_attempt_rate_limits WHERE user_id=$1',[fixture.id])).rows;
    const beforeQuotes=await generationCounter();
    for(let i=0;i<20;i++) assert.equal((await c.query('SELECT public.consume_seedance25_quote_request($1) AS result',[fixture.auth_id])).rows[0].result.ok,true);
    for(let i=0;i<10;i++) assert.equal((await c.query('SELECT public.consume_seedance25_quote_request($1) AS result',[fixture.auth_id])).rows[0].result.code,'RATE_LIMITED');
    assert.deepEqual(await generationCounter(),beforeQuotes,'quotes do not consume generation attempts');
    assert.equal((await c.query('SELECT public.check_generation_rate_limit($1,10,60) AS result',[fixture.auth_id])).rows[0].result.ok,true);
    assert.equal((await c.query('SELECT request_count FROM public.seedance25_quote_rate_limits WHERE user_id=$1',[fixture.id])).rows[0].request_count,21);
    await c.query("UPDATE public.seedance25_quote_rate_limits SET window_started_at=now()-interval '61 seconds' WHERE user_id=$1",[fixture.id]);
    assert.equal((await c.query('SELECT public.consume_seedance25_quote_request($1) AS result',[fixture.auth_id])).rows[0].result.ok,true);
    for(const role of ['anon','authenticated','service_role']) {
        assert.equal((await c.query("SELECT has_function_privilege($1,'public.consume_seedance25_quote_request(text)','execute') AS allowed",[role])).rows[0].allowed,role==='service_role');
        assert.equal((await c.query("SELECT has_table_privilege($1,'public.seedance25_quote_rate_limits','SELECT,INSERT,UPDATE,DELETE') AS allowed",[role])).rows[0].allowed,false);
    }
    for(const task of ['edit','extend']) {
        const unchanged=async()=>({
            balance:(await c.query('SELECT balance FROM public.credit_balances WHERE user_id=$1',[fixture.id])).rows,
            ledger:(await c.query('SELECT * FROM public.ledger_entries WHERE user_id=$1 ORDER BY id',[fixture.id])).rows,
            jobs:(await c.query('SELECT * FROM public.jobs WHERE user_id=$1 ORDER BY id',[fixture.id])).rows,
        });
        const before=await unchanged();
        await c.query('SAVEPOINT missing_basis');
        await assert.rejects(c.query("SELECT private.ledger_debit_for_admission($1,$2,$3,'debit:generation',$4,'{}'::jsonb)",[fixture.id,`missing-${task}`,task==='edit'?76:78,`seedance-2.5-${task}`]),/PROVIDER_SPEND_LIMIT:closed:60/);
        await c.query('ROLLBACK TO SAVEPOINT missing_basis');
        assert.deepEqual(await unchanged(),before,'missing basis leaves no debit or stranded job');
        await c.query('SAVEPOINT missing_basis_reservation');
        await assert.rejects(c.query("SELECT public.provider_spend_admit_model($1,$2,$3,'{}'::jsonb,$4)",[fixture.id,`reservation-${task}`,`seedance-2.5-${task}`,task==='edit'?76:78]),/PROVIDER_SPEND_LIMIT:closed:60/);
        await c.query('ROLLBACK TO SAVEPOINT missing_basis_reservation');

        const credits=task==='edit'?76:78;
        const inputs={seedance25_billing:{source_seconds:5,units:1,credits}};
        const job=(await c.query("INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state,provider,provider_job_id) VALUES($1,$2,$3,$4,$5,'SUBMITTED','crun',$2) RETURNING id",[fixture.id,`seedance25-${task}`,`seedance-2.5-${task}`,credits,inputs])).rows[0];
        const status=(await c.query('SELECT public.get_user_job_cancel($1,$2) AS result',[fixture.auth_id,job.id])).rows[0].result;
        assert.equal(status.cancellable,false);
        const cancelled=(await c.query('SELECT public.cancel_user_job($1,$2) AS result',[fixture.auth_id,job.id])).rows[0].result;
        assert.equal(cancelled.code,'JOB_STARTED');
    }
    for(const role of ['anon','authenticated','service_role']) {
        const row=(await c.query("SELECT has_function_privilege($1,'private.provider_spend_model_cost(text,jsonb,integer)','execute') AS allowed",[role])).rows[0];
        assert.equal(row.allowed,false);
    }
    console.log('Seedance 2.5: double migration replay, standby rows, source billing/spend, forged billing, grants and submitted cancellation PASS');
} finally { await c.query('ROLLBACK'); await c.end(); }
