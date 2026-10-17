#!/usr/bin/env node
// 0345 (ADR-0071 amendment): a deferred reward must not starve the rewards behind it. Runs against the full migration replay (ledger-tests.yml).
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
const reward = (referee) => one('SELECT * FROM public.referral_rewards WHERE referee_user_id = $1', [referee.id]);

async function account() {
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
async function referredWithPack(credits) {
    const r = await account(), f = await account();
    const code = (await rpc('public.referral_code_for($1)', [r.auth])).code;
    assert.equal((await rpc('public.attach_referral($1, $2)', [f.auth, code])).ok, true);
    const packId = `rf-${randomUUID().slice(0, 8)}`, variant = String(randomInt(1e9, 2e9)), price = credits * 10;
    await c.query(`INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active) VALUES ($1, 'web', $2, $3, $4, true)`, [packId, credits, price, variant]);
    const pending = await rpc(`public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600)`, [f.auth, packId, `test-${randomUUID()}`]);
    assert.equal(pending.ok, true, JSON.stringify(pending));
    const order = String(randomInt(1e9, 2e9));
    assert.equal((await rpc(`public.credit_top_up($1, $2, $3, 'USD', $4)`, [pending.top_up_id, order, price, variant])).ok, true);
    return { r, f };
}

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0345_referral_sweep_fairness.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');
    // Nothing else may be pending, or the one-row batches below would not mean what they say.
    await c.query(`UPDATE public.referral_rewards SET status = 'cancelled', cancel_reason = 'refunded' WHERE status = 'pending'`);

    const stuck = await referredWithPack(100);   // oldest, but its friend is frozen, so it is deferred every run
    const ready = await referredWithPack(100);   // newer and releasable
    await rpc('public.referral_sweep()');         // qualify both
    await c.query(`UPDATE public.referral_rewards SET eligible_at = now() - interval '2 days' WHERE referee_user_id = $1`, [stuck.f.id]);
    await c.query(`UPDATE public.referral_rewards SET eligible_at = now() - interval '1 minute' WHERE referee_user_id = $1`, [ready.f.id]);
    await c.query('UPDATE public.users SET frozen_at = now() WHERE id = $1', [stuck.f.id]);

    // A batch of one: the stuck reward is looked at first and deferred; the next batch must reach the other one.
    let s = await rpc('public.referral_sweep(1)');
    assert.deepEqual([s.released, s.deferred], [0, 1]);
    assert.ok((await reward(stuck.f)).last_swept_at, 'a deferred reward is stamped');
    s = await rpc('public.referral_sweep(1)');
    assert.equal(s.released, 1, 'the releasable reward is reached behind the deferred one');
    assert.equal((await reward(ready.f)).status, 'released');
    assert.equal((await reward(stuck.f)).status, 'pending');

    // Once the friend is unfrozen the old reward still releases.
    await c.query('UPDATE public.users SET frozen_at = NULL WHERE id = $1', [stuck.f.id]);
    s = await rpc('public.referral_sweep(1)');
    assert.equal(s.released, 1);
    assert.equal((await reward(stuck.f)).status, 'released');
    assert.deepEqual(await c.query('SELECT * FROM public.reconcile_referrals()').then((x) => x.rows), []);
    await c.query('ROLLBACK');
    console.log('referral sweep fairness: ok');
} finally {
    await c.end();
}
