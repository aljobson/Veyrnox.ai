#!/usr/bin/env node
// Run after the complete migration replay on a disposable local rebuild_check.
// Every migration reapply, fixture and concurrent price update is rolled back.
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
const q = (sql, values = []) => client.query(sql, values);
const one = async (sql, values = []) => (await q(sql, values)).rows[0];
const model = `capped-${randomUUID().slice(0, 8)}`, endpoint = 'fal-ai/flux-2-pro';
const original = 'public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)';
const capped = 'public.admit_fal_dispatch_capped(uuid,text,text,jsonb,jsonb,text,boolean,integer)';
const migration = await readFile(new URL('../packages/db/schema/supabase/0440_fal_dispatch_max_charge.sql', import.meta.url), 'utf8');
let user, checks = 0;
const values = (max, { key = randomUUID(), free = true, modelId = model, inputs = { prompt: 'fixture' }, payload = inputs } = {}) =>
    [user, key, modelId, inputs, payload, endpoint, free, max];
const admit = async (max, options) => (await one('SELECT public.admit_fal_dispatch_capped($1,$2,$3,$4,$5,$6,$7,$8) r', values(max, options))).r;
const legacy = async options => (await one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$5,$6,$7) r', values(0, options).slice(0, 7))).r;
const snapshot = () => one(`SELECT
    (SELECT to_jsonb(b) FROM public.credit_balances b WHERE user_id=$1) balance,
    (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.jobs j WHERE user_id=$1) jobs,
    (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM public.ledger_entries l WHERE user_id=$1) ledger,
    (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY idempotency_key),'[]') FROM public.model_free_allowance_claims c WHERE user_id=$1) claims,
    (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY job_id),'[]') FROM public.fal_dispatch d) dispatch,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.fal_capacity_reservations r) reservations,
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.provider_spend_reservations s WHERE user_id=$1) spend,
    (SELECT to_jsonb(r) FROM public.generation_attempt_rate_limits r WHERE user_id=$1) rate`, [user]);
async function check(name, fn) {
    await q('SAVEPOINT scenario');
    try { await fn(); checks++; console.log(`ok ${name}`); }
    finally { await q('ROLLBACK TO SAVEPOINT scenario'); await q('RELEASE SAVEPOINT scenario'); }
}
async function exhaust() {
    assert.equal((await one('SELECT public.free_allowance_take($1,$2,$3) r', [user, model, randomUUID()])).r.taken, true);
}
async function seedUser() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
    user = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    assert.equal((await one("SELECT public.ledger_grant($1,100,'grant:capped-fixture',$2) r", [user, randomUUID()])).r.ok, true);
}

// PostgREST-shaped named-argument adapter: exercises the Worker's seven/eight
// JSON keys against the actual SQL signatures, without a live HTTP service.
// Schema-cache refresh and HTTP routing still require staging verification.
const namedCalls = {
    admit_fal_dispatch: 'SELECT public.admit_fal_dispatch(p_user_id=>$1,p_idempotency_key=>$2,p_model_id=>$3,p_inputs=>$4,p_payload=>$5,p_endpoint=>$6,p_allow_free=>$7) r',
    admit_fal_dispatch_capped: 'SELECT public.admit_fal_dispatch_capped(p_user_id=>$1,p_idempotency_key=>$2,p_model_id=>$3,p_inputs=>$4,p_payload=>$5,p_endpoint=>$6,p_allow_free=>$7,p_max_charge=>$8) r',
};
async function shapedRpc(name, input) {
    assert.ok(Object.hasOwn(namedCalls, name));
    const body = JSON.parse(JSON.stringify(input));
    const names = ['p_user_id','p_idempotency_key','p_model_id','p_inputs','p_payload','p_endpoint','p_allow_free',
        ...(name.endsWith('_capped') ? ['p_max_charge'] : [])];
    assert.deepEqual(Object.keys(body).sort(), [...names].sort());
    await q('SET LOCAL ROLE service_role');
    try { return (await one(namedCalls[name], names.map(n => body[n]))).r; }
    finally { await q('RESET ROLE'); }
}
const worker = (maxCharge, key) => admitFalDispatch({ userId: user, key, model: { id: model, provider_endpoint: endpoint },
    inputs: { prompt: 'fixture' }, jobInputs: { prompt: 'fixture' },
    record: { inputs: { prompt: {} }, rename: {}, media: {}, fixed: {} },
    free: false, maxCharge, cfg: {}, rpc: shapedRpc });

try {
    await q('BEGIN');
    const innerBefore = (await one('SELECT pg_get_functiondef($1::regprocedure) body', [original])).body;
    await q(migration);
    const first = await one('SELECT pg_get_functiondef($1::regprocedure) body', [capped]);
    await q(migration);
    assert.deepEqual(await one('SELECT pg_get_functiondef($1::regprocedure) body', [capped]), first);
    assert.equal((await one('SELECT pg_get_functiondef($1::regprocedure) body', [original])).body, innerBefore);
    const definitions = (await q(`SELECT proname,pronargs,pronargdefaults,prosecdef,proconfig FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname IN ('admit_fal_dispatch','admit_fal_dispatch_capped') ORDER BY proname`)).rows;
    assert.equal(definitions.length, 2);
    assert.equal(definitions[0].pronargs, 7);
    assert.equal(definitions[1].pronargs, 8);
    assert.equal(definitions[1].pronargdefaults, 0);
    assert.equal(definitions[1].prosecdef, true);
    assert.ok(definitions[1].proconfig.includes('search_path=""'));
    for (const signature of [original, capped]) for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).allowed,
            role === 'service_role', `${role} on ${signature}`);
    }
    for (const role of ['anon', 'authenticated']) {
        await q('SAVEPOINT denied_role');
        await q(role === 'anon' ? 'SET LOCAL ROLE anon' : 'SET LOCAL ROLE authenticated');
        await assert.rejects(admit(0), error => error.code === '42501');
        await q('ROLLBACK TO SAVEPOINT denied_role');
        await q('RELEASE SAVEPOINT denied_role');
    }
    console.log('ok migration reapply, unchanged inner body, distinct signatures and privileges'); checks++;
    await seedUser();
    await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,active,gated_flag,free_allowance_per_day,free_allowance_daily_budget)
        VALUES($1,'Capped fixture','fal',$2,'text-to-image',7,0.03,'per_generation',true,false,1,10)`, [model, endpoint]);
    await q("UPDATE public.fal_capacity_policy SET enabled=true,provider_account='local-capped-fixture',model_id=$1,outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000", [model]);
    await q('UPDATE public.fal_admission_control SET paused=false');
    for (const max of [7, 10]) await check(`exhausted allowance admits paid at ceiling ${max}`, async () => {
        await exhaust();
        const before = await snapshot(), result = await admit(max), after = await snapshot();
        assert.equal(result.ok, true); assert.equal(result.free, false);
        assert.equal(after.balance.balance, before.balance.balance - 7);
        for (const field of ['jobs', 'ledger', 'dispatch', 'reservations']) assert.equal(after[field].length, before[field].length + 1, field);
        assert.deepEqual(after.claims, before.claims);
        assert.equal(after.jobs.at(-1).credits, 7);
    });
    for (const max of [0, 6]) await check(`exhausted allowance breach ${max} rolls back every row and balance`, async () => {
        await exhaust();
        const before = await snapshot();
        assert.deepEqual(await admit(max), { ok: false, code: 'PRICE_EXCEEDS_CEILING', expected_credits: 7 });
        assert.deepEqual(await snapshot(), before);
    });
    await check('available allowance fits ceiling zero and consumes one claim', async () => {
        const before = await snapshot(), result = await admit(0), after = await snapshot();
        assert.equal(result.ok, true); assert.equal(result.free, true);
        assert.deepEqual(after.balance, before.balance); assert.deepEqual(after.ledger, before.ledger);
        for (const field of ['jobs', 'claims', 'dispatch', 'reservations']) assert.equal(after[field].length, before[field].length + 1, field);
    });
    for (const max of [null, -1]) await check(`invalid ceiling ${max} has no effects`, async () => {
        const before = await snapshot();
        assert.deepEqual(await admit(max), { ok: false, code: 'INVALID_MAX_CHARGE' });
        assert.deepEqual(await snapshot(), before);
    });
    for (const free of [false, true]) await check(`replay ignores lower ceiling and increased price; free=${free}`, async () => {
        const key = randomUUID(), result = await admit(7, { key, free }); assert.equal(result.ok, true);
        await q('UPDATE public.model_catalog SET credits_5s=99 WHERE id=$1', [model]);
        const before = await snapshot(), replay = await admit(0, { key, free });
        assert.equal(replay.idempotent, true); assert.equal(replay.job_id, result.job_id);
        assert.equal((await admit(0, { key, free, inputs: { prompt: 'changed' } })).code, 'IDEMPOTENCY_CONFLICT');
        assert.deepEqual(await snapshot(), before);
    });
    const setups = {
        PROVIDER_ADMISSION_PAUSED: () => q('UPDATE public.fal_capacity_policy SET enabled=false'),
        ACCOUNT_FROZEN: () => q("SELECT public.freeze_account($1,'capped-fixture',NULL)", [user]),
        ACCOUNT_ON_HOLD: () => q("UPDATE public.users SET hold_until=now()+interval '1 hour' WHERE id=$1", [user]),
        INSUFFICIENT_BALANCE: () => q('UPDATE public.model_catalog SET credits_5s=1000000 WHERE id=$1', [model]),
        MODEL_UNAVAILABLE: () => q('UPDATE public.model_catalog SET active=false WHERE id=$1', [model]),
        RATE_LIMITED: async () => {
            // Historical finished jobs exercise the existing jobs-based limiter.
            // No debit or ledger fixture writes: zero-credit allowance jobs only.
            for (let i = 0; i < 10; i++) await q(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state,free_allowance)
                VALUES($1,$2,$3,0,'{}','FAILED',true)`, [user, randomUUID(), model]);
        },
    };
    for (const [code, setup] of Object.entries(setups)) await check(`inner refusal ${code} passes through unchanged`, async () => {
        await setup();
        const options = { free: false, key: randomUUID() };
        await q('SAVEPOINT compare_legacy');
        const expected = await legacy(options);
        await q('ROLLBACK TO SAVEPOINT compare_legacy'); await q('RELEASE SAVEPOINT compare_legacy');
        assert.equal(expected.code, code);
        assert.deepEqual(await admit(0, options), expected);
    });
    await check('missing model preserves inner MODEL_UNAVAILABLE', async () => {
        assert.deepEqual(await admit(0, { modelId: 'missing-capped-fixture' }), { ok: false, code: 'MODEL_UNAVAILABLE' });
    });
    await check('unrelated exceptions propagate and roll back instead of becoming price_changed', async () => {
        await q(`CREATE FUNCTION public.capped_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='capped fixture failure'; END $$;
            CREATE TRIGGER capped_fixture_fail BEFORE INSERT ON public.fal_capacity_reservations FOR EACH ROW EXECUTE FUNCTION public.capped_fixture_fail()`);
        const before = await snapshot();
        await q('SAVEPOINT failure');
        await assert.rejects(admit(0, { free: false }), error => error.code === 'P0001' && error.message === 'capped fixture failure');
        await q('ROLLBACK TO SAVEPOINT failure'); await q('RELEASE SAVEPOINT failure');
        assert.deepEqual(await snapshot(), before);
    });
    for (const max of [undefined, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER]) await check(`named JSON RPC admits and replays ceiling ${max}`, async () => {
        const key = randomUUID(), before = await snapshot();
        const response = await worker(max, key); assert.equal(response.status, 202);
        const body = await response.json(), after = await snapshot();
        assert.equal(after.balance.balance, before.balance.balance - 7);
        const replay = await worker(max, key); assert.equal(replay.status, 200);
        assert.equal((await replay.json()).job_id, body.job_id);
        assert.deepEqual(await snapshot(), after);
    });
    await check('seven-key legacy admission replays through capped eight-key RPC', async () => {
        const key = randomUUID(), response = await worker(undefined, key), body = await response.json();
        assert.equal(response.status, 202);
        const before = await snapshot(), replay = await worker(0, key);
        assert.equal(replay.status, 200); assert.equal((await replay.json()).job_id, body.job_id);
        assert.deepEqual(await snapshot(), before);
    });

    // Use an existing committed model so the second connection can see it;
    // do not UPDATE it on this connection (that would mask the FOR SHARE test).
    const committedModel = await one("SELECT id,credits_5s FROM public.model_catalog WHERE id='flux-2-pro'");
    assert.ok(committedModel);
    await q('UPDATE public.fal_capacity_policy SET model_id=$1', [committedModel.id]);
    const result = await admit(committedModel.credits_5s, { modelId: committedModel.id, free: false });
    assert.equal(result.ok, true);
    assert.equal((await one('SELECT credits FROM public.jobs WHERE id=$1', [result.job_id])).credits, committedModel.credits_5s);
    const updater = new pg.Client({ connectionString: url.toString() });
    await updater.connect();
    let pending;
    try {
        await updater.query('BEGIN'); await updater.query("SET LOCAL statement_timeout='5s'");
        const pid = (await updater.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const holder = (await one('SELECT pg_backend_pid() pid')).pid;
        pending = updater.query('UPDATE public.model_catalog SET credits_5s=credits_5s+1 WHERE id=$1 RETURNING credits_5s', [committedModel.id]);
        // Attach a handler immediately so a failed assertion cannot leak a rejection.
        pending.catch(() => {});
        let blocked = false;
        for (let n = 0; n < 100; n++) {
            blocked = (await one('SELECT $1::integer=ANY(pg_blocking_pids($2)) blocked', [holder, pid])).blocked;
            if (blocked) break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true, 'price UPDATE must block on the wrapper transaction');
        await q('ROLLBACK');
        assert.equal((await pending).rows[0].credits_5s, committedModel.credits_5s + 1);
        checks++; console.log('ok concurrent price update waits for wrapper transaction; debit uses locked price');
    } finally {
        await q('ROLLBACK');
        if (pending) await pending.catch(() => {});
        await updater.query('ROLLBACK'); await updater.end();
    }
    console.log(`${checks} capped SQL cases passed; all migration and fixture changes rolled back`);
} finally {
    await q('ROLLBACK').catch(() => {});
    await client.end();
}
