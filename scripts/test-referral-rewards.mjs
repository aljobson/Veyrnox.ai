#!/usr/bin/env node
// 0218 (ADR-0071 part 2): referral rewards. Runs against the full migration replay (ledger-tests.yml). Every fixture is rolled back.
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
    const migration = await readFile(new URL('../packages/db/schema/supabase/0218_referral_rewards.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');

    // ── Qualify: 10% of the friend's first credited Pack, rounded down, eligible 14 days after it was credited. ──
    const a = await referred(null, 100);
    let s = await sweep();
    assert.equal(s.qualified, 1);
    let w = await reward(a.f);
    assert.deepEqual([w.status, w.credits, w.referrer_user_id], ['pending', 10, a.r.id]);
    const credited = (await one('SELECT credited_at FROM public.top_ups WHERE id = $1', [a.pack.topUpId])).credited_at;
    assert.ok(Math.abs(new Date(w.eligible_at) - (new Date(credited).getTime() + 14 * 864e5)) < 60e3, 'eligible 14 days after credited');
    assert.equal(w.top_up_id, a.pack.topUpId);
    // A Pack too small to earn a whole Credit earns nothing and makes no row.
    const tiny = await referred(null, 9);
    assert.equal((await sweep()).qualified, 0);
    assert.equal(await reward(tiny.f), undefined);
    const nineteen = await referred(null, 19);
    await sweep();
    assert.equal((await reward(nineteen.f)).credits, 1, '19 credits -> 1 (rounded down)');

    // ── Not yet due: nothing moves. ──
    assert.equal(s.released, 0);
    assert.equal((await grantRows(a.r)).length, 0);

    // ── Due: released once, through ledger_grant, as Pack credits (not Free). ──
    const before = await balance(a.r);
    await makeDue(a.f);
    s = await sweep();
    assert.equal(s.released >= 1, true, JSON.stringify(s));
    w = await reward(a.f);
    assert.equal(w.status, 'released');
    const rows = await grantRows(a.r);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].delta, rows[0].free_delta, rows[0].reason], [10, 0, `grant:referral#referral-${a.f.id}`]);
    assert.equal(w.ledger_entry_id, rows[0].id);
    assert.equal(await balance(a.r), before + 10);
    assert.deepEqual(await problems(), []);
    // Replay mints nothing.
    const again = await sweep();
    assert.equal(again.released, 0);
    assert.equal((await grantRows(a.r)).length, 1);
    assert.equal(await balance(a.r), before + 10);
    // One reward per friend, ever: a second Pack changes nothing.
    await buyPack(a.f, 500);
    assert.equal((await sweep()).qualified, 0);
    assert.equal((await c.query('SELECT 1 FROM public.referral_rewards WHERE referee_user_id = $1', [a.f.id])).rowCount, 1);

    // ── A refund before release cancels it. ──
    const refunded = await referred(null, 100);
    await sweep();
    const rf = await rpc('public.apply_top_up_refund($1, $2, $3)', [refunded.pack.order, refunded.pack.price, refunded.pack.price]);
    assert.equal(rf.ok, true, JSON.stringify(rf));
    await makeDue(refunded.f);
    s = await sweep();
    assert.deepEqual([(await reward(refunded.f)).status, (await reward(refunded.f)).cancel_reason], ['cancelled', 'refunded']);
    assert.equal((await grantRows(refunded.r)).length, 0);
    assert.equal(s.cancelled >= 1, true);

    // ── A dispute (a Freeze tied to the Pack) before release cancels it too. ──
    const disputed = await referred(null, 100);
    await sweep();
    const dp = await rpc(`public.apply_dispute_event($1, 'created', $2)`, [disputed.pack.order, `dsp_${randomInt(1e6, 9e6)}`]);
    assert.equal(dp.ok, true, JSON.stringify(dp));
    await makeDue(disputed.f);
    await sweep();
    assert.deepEqual([(await reward(disputed.f)).status, (await reward(disputed.f)).cancel_reason], ['cancelled', 'disputed']);
    assert.equal((await grantRows(disputed.r)).length, 0);

    // ── A frozen account waits; it is released when the freeze clears. ──
    const fz = await referred(null, 100);
    await sweep(); await makeDue(fz.f);
    await c.query('UPDATE public.users SET frozen_at = now() WHERE id = $1', [fz.f.id]); // fixture only, rolled back
    s = await sweep();
    assert.equal((await reward(fz.f)).status, 'pending'); assert.equal(s.deferred >= 1, true);
    await c.query('UPDATE public.users SET frozen_at = NULL WHERE id = $1', [fz.f.id]);
    await c.query('UPDATE public.users SET frozen_at = now() WHERE id = $1', [fz.r.id]);
    await sweep();
    assert.equal((await reward(fz.f)).status, 'pending', 'a frozen referrer waits too');
    await c.query('UPDATE public.users SET frozen_at = NULL WHERE id = $1', [fz.r.id]);
    await sweep();
    assert.equal((await reward(fz.f)).status, 'released');

    // ── An unconfirmed referrer (no signup grant) waits. ──
    const authU = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, NULL)', [authU, `${authU}@example.invalid`]);
    const unconfirmed = { auth: authU, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [authU])).id };
    const uc = await referred(unconfirmed, 100);
    await sweep(); await makeDue(uc.f); await sweep();
    assert.equal((await reward(uc.f)).status, 'pending');

    // ── Monthly caps: 20 rewards, and 2,000 reward Credits, per referrer per UTC month; the rest waits for the next month. ──
    const boss = await account();
    const batch = [];
    for (let i = 0; i < 21; i += 1) batch.push(await referred(boss, 100));
    await sweep();
    for (const b of batch) await makeDue(b.f);
    await sweep();
    const statuses = await Promise.all(batch.map(async (b) => (await reward(b.f)).status));
    assert.equal(statuses.filter((x) => x === 'released').length, 20);
    assert.equal(statuses.filter((x) => x === 'pending').length, 1);
    assert.deepEqual(await problems(), []);
    const waiting = batch[statuses.indexOf('pending')];
    await c.query(`UPDATE public.referral_rewards SET released_at = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 day'
                   WHERE referrer_user_id = $1 AND status = 'released'`, [boss.id]);
    await sweep();
    assert.equal((await reward(waiting.f)).status, 'released', 'released once the month rolls over');
    assert.deepEqual(await problems(), []);

    const whale = await account();
    const w1 = await referred(whale, 10000), w2 = await referred(whale, 10000), w3 = await referred(whale, 10000);
    await sweep(); for (const x of [w1, w2, w3]) await makeDue(x.f);
    await sweep();
    const wst = (await Promise.all([w1, w2, w3].map(async (x) => (await reward(x.f)).status))).sort();
    assert.deepEqual(wst, ['pending', 'released', 'released'], '2 x 1,000 = 2,000 reaches the Credit cap; the third waits');
    assert.equal((await grantRows(whale)).reduce((n, r) => n + r.delta, 0), 2000);

    // ── Reconcile sees drift: a stray referral grant, and a reward that is not 10% of its Pack. ──
    assert.deepEqual(await problems(), []);
    const stray = await account();
    const g = await rpc(`public.ledger_grant($1, 5, 'grant:referral', $2)`, [stray.id, `referral-${randomUUID()}`]);
    assert.equal(g.ok, true);
    assert.deepEqual((await problems()).map((p) => p.problem), ['ledger_entry_without_released_reward']);
    // The nightly job's own command (the seventh check) raises on it, and not when healthy.
    const cmd = migration.match(/\$cmd\$([\s\S]*?)\$cmd\$/)[1];
    await c.query('SAVEPOINT nightly');
    await assert.rejects(c.query(cmd), /referral problems/);
    await c.query('ROLLBACK TO SAVEPOINT nightly');
    await c.query('SAVEPOINT bad');
    const bumped = await c.query(`UPDATE public.referral_rewards SET credits = 1001 WHERE referrer_user_id = $1 AND status = 'pending'`, [whale.id]);
    assert.equal(bumped.rowCount, 1, 'exactly one waiting reward to corrupt');
    assert.ok((await problems()).some((p) => p.problem === 'reward_not_ten_percent_of_first_pack'));
    await c.query('ROLLBACK TO SAVEPOINT bad');

    // ── Access: service role only, nothing for browser roles, table locked down. ──
    const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.referral_rewards'::regclass`);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    assert.equal((await c.query(`SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'referral_rewards' AND grantee IN ('anon','authenticated','PUBLIC','service_role')`)).rowCount, 0);
    for (const sig of ['referral_sweep(integer)', 'reconcile_referrals()']) {
        const x = await one(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') AS auth,
            has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS svc`);
        assert.deepEqual(x, { anon: false, auth: false, svc: true }, sig);
    }
    await c.query('ROLLBACK');
    console.log('referral rewards: ok');
} finally {
    await c.end();
}
