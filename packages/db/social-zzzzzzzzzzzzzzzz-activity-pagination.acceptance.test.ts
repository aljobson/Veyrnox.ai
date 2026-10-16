import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('complete brand activity pagination (0328)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    if (await isFullSocialReplay(pool)) return;
    const migration = await readFile(new URL('./schema/supabase/0328_social_activity_pagination.sql', import.meta.url), 'utf8');
    await pool.query(migration); await pool.query(migration);
  });
  after(async () => { if (pool) await pool.end(); });

  async function user() {
    const auth = randomUUID(), email = `activity-page-${randomUUID()}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]);
    const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]);
    return { auth, email, id };
  }

  it('retrieves more than 100 same-time events without repeats, source collisions or foreign-brand data', async () => {
    const owner = await user(), manager = await user(), analyst = await user(), stranger = await user();
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const foreignBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [stranger.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `activity-page-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'manager',$4),($1,$3,'analyst',$4)`, [brand, manager.id, analyst.id, owner.id]);
    await pool.query(`INSERT INTO public.social_account_actions(brand_id,actor_id,action,created_at)
      SELECT $1,$2,'save_smartlink','2026-10-14T12:00:00Z'::timestamptz FROM generate_series(1,121)`, [brand, manager.id]);
    const collision = randomUUID();
    await pool.query(`INSERT INTO public.social_account_actions(id,brand_id,actor_id,action,created_at)
      VALUES($1,$2,$3,'save_smartlink','2026-10-14T12:00:00Z')`, [collision, brand, manager.id]);
    await pool.query(`INSERT INTO public.social_team_events(id,brand_id,actor_user_id,member_user_id,action,created_at)
      VALUES($1,$2,$3,$3,'accepted','2026-10-14T12:00:00Z')`, [collision, brand, manager.id]);
    const foreignEvent = await value(`INSERT INTO public.social_account_actions(brand_id,actor_id,action,created_at)
      VALUES($1,$2,'save_smartlink','2026-10-14T12:00:00Z') RETURNING id value`, [foreignBrand, stranger.id]);
    const events: { id: string; source: string; actor_email: string }[] = [];
    let cursor: { created_at: string; id: string; source: string } | null = null;
    let pages = 0;
    do {
      const result = await value('SELECT public.list_social_publish_activity_page($1,$2,25,$3,$4,$5) value', [manager.auth, brand, cursor?.created_at || null, cursor?.id || null, cursor?.source || null]);
      assert.equal(result.ok, true); assert.equal(result.actor_role, 'manager');
      events.push(...result.events); cursor = result.next_cursor;
      pages += 1;
      assert.ok(pages < 10, 'pagination must terminate');
    } while (cursor);
    assert.equal(events.length, 123);
    assert.equal(new Set(events.map((event) => `${event.source}:${event.id}`)).size, 123);
    assert.equal(events.filter((event) => event.id === collision).length, 2);
    assert.ok(events.every((event) => event.actor_email === manager.email));
    assert.ok(events.every((event) => event.id !== foreignEvent));
    const denied = await value('SELECT public.list_social_publish_activity_page($1,$2) value', [analyst.auth, brand]);
    assert.equal(denied.code, 'FORBIDDEN');
    assert.equal((await value('SELECT public.list_social_publish_activity_page($1,$2) value', [stranger.auth, brand])).ok, false);
    assert.equal((await value('SELECT public.list_social_publish_activity_page($1,$2,25,NULL,$3,NULL) value', [owner.auth, brand, collision])).code, 'INVALID_CURSOR');
  });

  it('keeps the paginated reader service-only with a locked search path', async () => {
    const signature = 'public.list_social_publish_activity_page(text,uuid,integer,timestamp with time zone,uuid,text)';
    for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).allowed, false);
    assert.equal((await one("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed", [signature])).allowed, true);
    assert.ok(String(await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure', [signature])).includes('search_path='));
  });
});
