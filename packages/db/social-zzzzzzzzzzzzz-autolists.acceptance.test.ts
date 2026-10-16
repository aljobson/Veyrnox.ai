import { isFullSocialReplay } from './test-support/social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('RSS Autolists (0322)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;
  before(async () => { pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });if (await isFullSocialReplay(pool)) return; const migration = await readFile(new URL('./schema/supabase/0322_social_publish_autolists.sql', import.meta.url), 'utf8'); await pool.query(migration); await pool.query(migration); });
  after(async () => { if (pool) await pool.end(); });
  async function user(prefix: string) { const auth = randomUUID(), email = `${prefix}-${randomUUID()}@test.veyrnox.ai`; await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]); const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]); return { auth, id }; }
  async function fixture() { const owner = await user('autolist-owner'), viewer = await user('autolist-viewer'), outsider = await user('autolist-outsider'); const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id; const outsiderBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [outsider.auth])).brand_id; await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end) VALUES($1,'publish',$2,1500,'publish-plan-2026-10-14','active',now()+interval '30 days')`, [owner.id, `autolist-${randomUUID()}`]); await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'viewer',$3)`, [brand, viewer.id, owner.id]); const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc,status) VALUES($1,'instagram',$2,'Autolist account',decode('00','hex'),'active') RETURNING id value`, [brand, `autolist-${randomUUID()}`]); const slots = JSON.stringify(Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, minute: 720 }))); const queue = await value(`SELECT public.save_social_publish_queue($1,$2,NULL,'Autolist queue','UTC',$3,$4,true) value`, [owner.auth, brand, [account], slots]); return { owner, viewer, outsider, brand, outsiderBrand, account, queueId: queue.queue_id }; }

  it('imports unique feed items and schedules them into distinct queue slots', async () => {
    const f = await fixture(); const saved = await value(`SELECT public.save_social_publish_autolist($1,$2,NULL,$3,'News','https://example.com/feed.xml','{{title}} — {{link}}',30,true,true) value`, [f.owner.auth, f.brand, f.queueId]); assert.equal(saved.ok, true);
    const items = JSON.stringify([{ external_id: 'one', title: 'First', link: 'https://example.com/one', summary: 'Summary', published_at: '2026-10-13T10:00:00Z' }, { external_id: 'two', title: 'Second', link: 'https://example.com/two', summary: null, published_at: '2026-10-13T11:00:00Z' }]);
    assert.equal((await value('SELECT public.record_social_publish_autolist_refresh($1,$2,$3,$4,false) value', [saved.autolist_id, items, '"etag"', 'Tue, 13 Oct 2026 12:00:00 GMT'])).added, 2);
    assert.equal((await value('SELECT public.record_social_publish_autolist_refresh($1,$2,NULL,NULL,false) value', [saved.autolist_id, items])).added, 0);
    const scheduled = await value('SELECT public.schedule_social_publish_autolist_items($1,10) value', [saved.autolist_id]); assert.equal(scheduled.scheduled, 2);
    const posts = await pool.query(`SELECT p.global_text,p.scheduled_at,count(t.id)::int targets FROM public.social_posts p JOIN public.social_post_targets t ON t.post_id=p.id WHERE p.id IN (SELECT post_id FROM public.social_publish_autolist_items WHERE autolist_id=$1) GROUP BY p.id ORDER BY p.scheduled_at`, [saved.autolist_id]);
    assert.equal(posts.rows.length, 2); assert.equal(posts.rows[0].targets, 1); assert.match(posts.rows[0].global_text, /^First — https:\/\/example\.com\/one/); assert.notEqual(posts.rows[0].scheduled_at.toISOString(), posts.rows[1].scheduled_at.toISOString());
    const listed = await value('SELECT public.list_social_publish_autolists($1,$2) value', [f.viewer.auth, f.brand]); assert.equal(listed.autolists[0].items.length, 2); assert.equal(listed.autolists[0].items[0].status, 'scheduled');
    assert.equal((await value(`SELECT public.save_social_publish_autolist($1,$2,NULL,$3,'Blocked','https://example.com/feed','{{unknown}}',30,true,false) value`, [f.owner.auth, f.brand, f.queueId])).code, 'INVALID_AUTOLIST');
    assert.equal((await value(`SELECT public.save_social_publish_autolist($1,$2,NULL,$3,'Viewer','https://example.com/feed','{{title}}',30,true,false) value`, [f.viewer.auth, f.brand, f.queueId])).code, 'FORBIDDEN');
    assert.equal((await value('SELECT public.list_social_publish_autolists($1,$2) value', [f.outsider.auth, f.brand])).code, 'BRAND_NOT_FOUND');
  });

  it('keeps Autolist tables and functions service-only', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['social_publish_autolists', 'social_publish_autolist_items']) assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT') allowed", [role, `public.${table}`])).allowed, false);
      for (const signature of ['list_social_publish_autolists(text,uuid)', 'save_social_publish_autolist(text,uuid,uuid,uuid,text,text,text,integer,boolean,boolean)', 'delete_social_publish_autolist(text,uuid,uuid)', 'claim_due_social_publish_autolists(integer)', 'record_social_publish_autolist_refresh(uuid,jsonb,text,text,boolean)', 'fail_social_publish_autolist_refresh(uuid,text)', 'schedule_social_publish_autolist_items(uuid,integer)']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
    }
  });
});
