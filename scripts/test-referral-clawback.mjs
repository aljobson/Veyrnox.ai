#!/usr/bin/env node
// 0219 (ADR-0071 part 3): referral clawback after release. Runs against the full migration replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const sweep = () => rpc('public.referral_sweep()');
const problems = async () => (await c.query('SELECT * FROM public.reconcile_referrals()')).rows;
const makeDue = (referee) => c.query(`UPDATE public.referral_rewards SET eligible_at = now() - interval '1 minute' WHERE referee_user_id = $1`, [referee.id]);
const reward = (referee) => one('SELECT * FROM public.referral_rewards WHERE referee_user_id = $1', [referee.id]);
const balance = async (u) => Number((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [u.id])).balance);
const grantRows = async (u) => (await c.query(`SELECT * FROM public.ledger_entries WHERE user_id = $1 AND reason LIKE 'grant:referral%'`, [u.id])).rows;

async function account() {
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
async function buyPack(u, credits) {
    const packId = `rf-${randomUUID().slice(0, 8)}`, variant = String(randomInt(1e9, 2e9)), price = credits * 10;
    await c.query(`INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active) VALUES ($1, 'web', $2, $3, $4, true)`, [packId, credits, price, variant]);
    const pending = await rpc(`public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600)`, [u.auth, packId, `test-${randomUUID()}`]);
    assert.equal(pending.ok, true, JSON.stringify(pending));
    const order = String(randomInt(1e9, 2e9));
    const credited = await rpc(`public.credit_top_up($1, $2, $3, 'USD', $4)`, [pending.top_up_id, order, price, variant]);
    assert.equal(credited.ok, true, JSON.stringify(credited));
    return { topUpId: pending.top_up_id, order, price };
}
/** A referrer (or the given one) and a friend attributed to them, who then bought a first Pack. */
async function referred(referrer, credits = 100) {
    const r = referrer ?? await account();
    const f = await account();
    const code = (await rpc('public.referral_code_for($1)', [r.auth])).code;
    const att = await rpc('public.attach_referral($1, $2)', [f.auth, code]);
    assert.equal(att.ok, true, JSON.stringify(att));
    return { r, f, pack: await buyPack(f, credits) };
}

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0219_referral_clawback.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');
    const reverseRows = async (u) => (await c.query(`SELECT * FROM public.ledger_entries WHERE user_id = $1 AND reason = 'reverse:referral'`, [u.id])).rows;
    const released = async (credits = 100) => {
        const x = await referred(null, credits);
        await sweep(); await makeDue(x.f); await sweep();
        assert.equal((await reward(x.f)).status, 'released');
        return x;
    };
    const base = async (u) => (await one('SELECT balance, free_balance, subscription_balance FROM public.credit_balances WHERE user_id = $1', [u.id]));

    // ── A partial refund claws back the matching share; a later, larger one takes the difference; a replay takes nothing. ──
    const p = await released(100);                                   // reward 10
    const b0 = await balance(p.r);
    const half = await rpc('public.apply_top_up_refund($1, $2, $3)', [p.pack.order, p.pack.price / 2, p.pack.price]);
    assert.equal(half.ok, true, JSON.stringify(half));
    let s = await sweep();
    assert.equal(s.clawed_back, 5);
    let w = await reward(p.f);
    assert.deepEqual([w.status, w.clawed_back_credits, w.clawback_shortfall], ['released', 5, 0]);
    assert.equal(await balance(p.r), b0 - 5);
    let rows = await reverseRows(p.r);
    assert.deepEqual([rows.length, rows[0].delta, rows[0].free_delta], [1, -5, 0]);
    assert.equal((await sweep()).clawed_back, 0, 'replay takes nothing');
    assert.equal((await reverseRows(p.r)).length, 1);
    await rpc('public.apply_top_up_refund($1, $2, $3)', [p.pack.order, p.pack.price, p.pack.price]);
    assert.equal((await sweep()).clawed_back, 5);
    w = await reward(p.f);
    assert.deepEqual([w.clawed_back_credits, w.clawback_shortfall], [10, 0]);
    assert.equal(await balance(p.r), b0 - 10);
    assert.equal((await reverseRows(p.r)).length, 2);
    assert.equal((await sweep()).clawed_back, 0, 'fully clawed back: nothing more');
    assert.deepEqual(await problems(), []);

    // ── A dispute (Freeze tied to the Pack) after release claws back the whole reward. ──
    const d = await released(100);
    const db0 = await balance(d.r);
    const dp = await rpc(`public.apply_dispute_event($1, 'created', $2)`, [d.pack.order, `dsp_${randomInt(1e6, 9e6)}`]);
    assert.equal(dp.ok, true, JSON.stringify(dp));
    s = await sweep();
    assert.equal(s.clawed_back, 10);
    assert.deepEqual([(await reward(d.f)).clawed_back_credits, await balance(d.r)], [10, db0 - 10]);
    assert.deepEqual(await problems(), []);

    // ── A referrer who has already spent the Credits: only Pack Credits that remain are taken, never below zero, never Free Credits. ──
    const sp = await released(100);                                  // reward 10 on top of the signup Free Credits
    const before = await base(sp.r);
    const spend = before.free_balance + 5;                          // free first, then 5 of the 10 reward Credits
    const dr = await rpc(`public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb)`, [sp.r.id, randomUUID(), spend]);
    assert.equal(dr.ok, true, JSON.stringify(dr));
    await rpc(`public.apply_dispute_event($1, 'created', $2)`, [sp.pack.order, `dsp_${randomInt(1e6, 9e6)}`]);
    s = await sweep();
    w = await reward(sp.f);
    assert.deepEqual([w.clawed_back_credits, w.clawback_shortfall], [5, 5], 'took the 5 left, noted the 5 spent');
    const after = await base(sp.r);
    assert.deepEqual([after.balance, after.free_balance], [0, 0]);
    assert.equal(w.status, 'released', 'a clawed-back reward still counts toward the monthly cap');
    assert.equal((await sweep()).clawed_back, 0, 'the shortfall is not chased');
    assert.deepEqual(await problems(), []);

    // Spent everything: nothing to take, the whole reward is the shortfall, and the balance never goes negative.
    const all = await released(100);
    const bal = await base(all.r);
    await rpc(`public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb)`, [all.r.id, randomUUID(), bal.balance]);
    await rpc(`public.apply_dispute_event($1, 'created', $2)`, [all.pack.order, `dsp_${randomInt(1e6, 9e6)}`]);
    await sweep();
    w = await reward(all.f);
    assert.deepEqual([w.clawed_back_credits, w.clawback_shortfall], [0, 10]);
    assert.equal((await reverseRows(all.r)).length, 0, 'no ledger row when nothing was taken');
    assert.equal((await base(all.r)).balance, 0);
    assert.deepEqual(await problems(), []);

    // ── Reconcile sees a clawback row the rewards do not record, and the table refuses an over-recorded clawback. ──
    const stray = await account();
    await c.query(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id) VALUES ($1, -3, 0, 'reverse:referral', NULL)`, [stray.id]);
    assert.deepEqual((await problems()).map((x) => x.problem), ['clawback_ledger_mismatch']);
    const nightly = (await readFile(new URL('../packages/db/schema/supabase/0218_referral_rewards.sql', import.meta.url), 'utf8')).match(/\$cmd\$([\s\S]*?)\$cmd\$/)[1];
    await c.query('SAVEPOINT nightly');
    await assert.rejects(c.query(nightly), /referral problems/);
    await c.query('ROLLBACK TO SAVEPOINT nightly');
    await c.query('SAVEPOINT over');
    await assert.rejects(c.query(`UPDATE public.referral_rewards SET clawed_back_credits = 8, clawback_shortfall = 8 WHERE referee_user_id = $1`, [p.f.id]), { code: '23514' });
    await c.query('ROLLBACK TO SAVEPOINT over');

    // ── The sweep's access did not change. ──
    for (const sig of ['referral_sweep(integer)', 'reconcile_referrals()']) {
        const x = await one(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') AS auth,
            has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS svc`);
        assert.deepEqual(x, { anon: false, auth: false, svc: true }, sig);
    }
    await c.query('ROLLBACK');
    console.log('referral clawback: ok');
} finally {
    await c.end();
}
