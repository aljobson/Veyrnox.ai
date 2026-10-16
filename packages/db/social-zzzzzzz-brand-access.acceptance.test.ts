import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social brand access (0306)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    if (await isFullSocialReplay(pool)) return;
    for (const file of ['0305_social_team_roles.sql', '0306_social_brand_access.sql']) {
      const migration = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
      await pool.query(migration); await pool.query(migration);
    }
  });
  after(async () => { if (pool) await pool.end(); });

  async function user(prefix: string) {
    const auth = randomUUID(); const email = `${prefix}-${randomUUID()}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]);
    const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]);
    return { auth, email, id };
  }

  it('lists owned and shared brands without exposing owner identities', async () => {
    const owner = await user('owner'); const member = await user('member');
    const owned = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const memberBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [member.auth])).brand_id;
    await pool.query('INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,$3,$4)', [owned, member.id, 'analyst', owner.id]);
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `brand-access-${randomUUID()}`]);

    const listed = await value('SELECT public.list_social_brand_access($1) value', [member.auth]);
    assert.equal(listed.ok, true); assert.equal(listed.brands.length, 2);
    assert.equal(listed.brands.find((entry: { id: string }) => entry.id === owned).role, 'analyst');
    assert.equal(listed.brands.find((entry: { id: string }) => entry.id === owned).paid, true);
    assert.equal(JSON.stringify(listed).includes(owner.auth), false);

    const access = await value('SELECT public.get_social_brand_access($1,$2) value', [member.auth, owned]);
    assert.deepEqual([access.ok, access.role, access.owner_auth_id], [true, 'analyst', owner.auth]);
    assert.equal((await value('SELECT public.get_social_brand_access($1,$2) value', [(await user('outsider')).auth, owned])).code, 'BRAND_NOT_FOUND');
    assert.equal((await value('SELECT public.get_social_brand_access($1,$2) value', [member.auth, memberBrand])).role, 'owner');
  });

  it('checks that owner writes target a post in the selected brand', async () => {
    const owner = await user('post-owner'); const outsider = await user('post-outsider');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const post = randomUUID();
    await pool.query(`INSERT INTO public.social_posts(id,brand_id,created_by_user_id,status,scheduled_at,global_text,idempotency_key)
      VALUES($1,$2,$3,'scheduled',now()+interval '1 day','test',$4)`, [post, brand, owner.id, `brand-post-${randomUUID()}`]);
    assert.deepEqual(await value('SELECT public.social_brand_contains_post($1,$2,$3) value', [owner.auth, brand, post]), { ok: true });
    assert.equal((await value('SELECT public.social_brand_contains_post($1,$2,$3) value', [outsider.auth, brand, post])).code, 'BRAND_NOT_FOUND');
    assert.equal((await value('SELECT public.social_brand_contains_post($1,$2,$3) value', [owner.auth, brand, randomUUID()])).code, 'POST_NOT_FOUND');
  });

  it('keeps access helpers service-role-only with locked search paths', async () => {
    for (const signature of ['list_social_brand_access(text)', 'get_social_brand_access(text,uuid)', 'social_brand_contains_post(text,uuid,uuid)', 'social_brand_contains_queue_assignment(text,uuid,uuid)']) {
      for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
      const config = await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure', [`public.${signature}`]);
      assert.ok(String(config).includes('search_path='));
    }
  });
});
