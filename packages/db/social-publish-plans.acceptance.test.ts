import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social Publish Plan entitlement (0293)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    await pool.query(`DO $$ DECLARE r TEXT; BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
      END LOOP; END $$`);
    const migration = await readFile(new URL('./schema/supabase/0293_social_publish_plans.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
  });

  after(async () => { if (pool) await pool.end(); });

  async function user() {
    const auth = randomUUID();
    await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
    await one('SELECT public.provision_user($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
    return auth;
  }
  const start = (auth: string, key = randomUUID()) => value(
    'SELECT public.start_social_publish_subscription($1,$2,$3,$4,5,600) AS value',
    [auth, 'publish', key, 'publish-plan-2026-10-13'],
  );
  const entitlement = (auth: string) => value('SELECT public.read_social_publish_entitlement($1) AS value', [auth]);
  const apply = (event: string, stripeSub: string, publishId: string | null, status: string, at = new Date().toISOString()) => value(
    'SELECT public.apply_social_publish_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',
    [event, 'customer.subscription.updated', publishId, stripeSub, 'cus_publish', status,
      new Date(Date.now() + 31 * 86400000).toISOString(), false, at],
  );

  it('offers exactly the approved $15 monthly advanced plan and defaults to Free', async () => {
    const plans = await value('SELECT public.list_social_publish_plans() AS value');
    assert.deepEqual(plans, [{ id: 'publish', name: 'Publish Plan', billing_interval: 'month', price_usd_cents: 1500, analytics_days: 366, best_time_enabled: true }]);
    const auth = await user();
    const own = await entitlement(auth);
    assert.deepEqual([own.tier, own.account_limit, own.analytics_days, own.best_time_enabled, own.subscription], ['free', 5, 30, false, null]);
  });

  it('activates from a signed binding, grants advanced features, and ignores older events', async () => {
    const auth = await user();
    const suffix = randomUUID().replaceAll('-', '');
    const created = await start(auth, `publish-${suffix}`);
    assert.deepEqual([created.ok, created.status, created.price_usd_cents], [true, 'pending', 1500]);
    assert.equal((await start(auth, `publish-${suffix}`)).subscription_id, created.subscription_id);
    assert.equal((await start(auth, `publish-${suffix}`)).idempotent, true);
    const initialAt = new Date(Date.now() - 60_000).toISOString();
    const active = await apply(`evt_active_${suffix}`, `sub_${suffix}`, created.subscription_id, 'active', initialAt);
    assert.deepEqual([active.ok, active.status, active.flagged], [true, 'active', false]);
    const own = await entitlement(auth);
    assert.deepEqual([own.tier, own.analytics_days, own.best_time_enabled], ['publish', 366, true]);
    const stale = await apply(`evt_old_${suffix}`, `sub_${suffix}`, null, 'ended', new Date(Date.parse(initialAt) - 1000).toISOString());
    assert.deepEqual([stale.stale, stale.status], [true, 'active']);
    assert.equal((await entitlement(auth)).tier, 'publish');
  });

  it('keeps identity server-owned and subscription events append-only', async () => {
    const auth = await user();
    const stranger = await user();
    const suffix = randomUUID().replaceAll('-', '');
    const eventId = `evt_bound_${suffix}`;
    const created = await start(auth, `publish-${suffix}`);
    assert.equal((await value('SELECT public.record_social_publish_session($1,$2,$3) AS value', [stranger, created.subscription_id, `cs_${suffix}`])).code, 'SUBSCRIPTION_NOT_FOUND');
    assert.equal((await apply(eventId, `sub_${suffix}`, created.subscription_id, 'active')).ok, true);
    await assert.rejects(pool.query('UPDATE public.social_publish_subscription_events SET type=$1 WHERE stripe_event_id=$2', ['tampered', eventId]), /append-only/);
    for (const table of ['social_publish_plans', 'social_publish_subscriptions', 'social_publish_subscription_events']) {
      const row = await one('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]);
      assert.deepEqual([row.relrowsecurity, row.relforcerowsecurity], [true, true]);
    }
  });
});
