import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('actor-aware social team actions (0307)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  let fullReplay = false;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    fullReplay = await isFullSocialReplay(pool);
    if (fullReplay) return;
    for (const file of ['0305_social_team_roles.sql', '0306_social_brand_access.sql', '0307_social_team_actions.sql']) {
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

  it('lets editors operate shared inbox, queue and SmartLink while recording their identity', async () => {
    const owner = await user('owner'); const editor = await user('editor'); const analyst = await user('analyst');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `team-actions-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'editor',$4),($1,$3,'analyst',$4)`, [brand, editor.id, analyst.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc)
      VALUES($1,'instagram',$2,'Test account',decode('00','hex')) RETURNING id value`, [brand, `account-${randomUUID()}`]);
    const thread = await value(`INSERT INTO public.social_inbox_threads(brand_id,account_id,provider_thread_id,kind,can_reply,latest_message_at)
      VALUES($1,$2,$3,'comment',true,now()) RETURNING id value`, [brand, account, `thread-${randomUUID()}`]);

    assert.equal((await value(fullReplay
      ? 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3,p_action=>$4) value'
      : 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_thread_id=>$2,p_action=>$3) value',
    fullReplay ? [editor.auth, brand, thread, 'resolve'] : [editor.auth, thread, 'resolve'])).ok, true);
    const replyKey = `reply:${randomUUID()}`;
    const reply = await value(fullReplay
      ? 'SELECT public.create_social_inbox_reply(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3,p_body=>$4,p_idempotency_key=>$5) value'
      : 'SELECT public.create_social_inbox_reply(p_auth_id=>$1,p_thread_id=>$2,p_body=>$3,p_idempotency_key=>$4) value',
    fullReplay ? [editor.auth, brand, thread, 'Thanks!', replyKey] : [editor.auth, thread, 'Thanks!', replyKey]);
    assert.equal(reply.ok, true); assert.equal(reply.idempotent, false);
    const queue = await value(`SELECT public.save_social_publish_queue($1,$2,NULL,'Editorial','UTC',$3,$4,true) value`,
      [editor.auth, brand, [account], JSON.stringify([{ weekday: 2, minute: 600 }])]);
    assert.equal(queue.ok, true);
    const smartlink = await value(`SELECT public.save_social_smartlink($1,$2,$3,'Studio',NULL,NULL,'midnight',false,'[]'::jsonb) value`,
      [editor.auth, brand, `studio-${randomUUID().slice(0, 8)}`]);
    assert.equal(smartlink.ok, true);
    assert.equal((await value(`SELECT count(*)::int value FROM public.social_inbox_actions WHERE brand_id=$1 AND actor_id=$2`, [brand, editor.id])), 2);
    assert.equal((await value(`SELECT count(*)::int value FROM public.social_account_actions WHERE brand_id=$1 AND actor_id=$2 AND action IN ('save_publish_queue','save_smartlink')`, [brand, editor.id])), 2);

    assert.equal((await value(fullReplay
      ? 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3,p_action=>$4) value'
      : 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_thread_id=>$2,p_action=>$3) value',
    fullReplay ? [analyst.auth, brand, thread, 'reopen'] : [analyst.auth, thread, 'reopen'])).code, 'FORBIDDEN');
    assert.equal((await value(`SELECT public.save_social_smartlink($1,$2,'blocked','Blocked',NULL,NULL,'midnight',false,'[]'::jsonb) value`, [analyst.auth, brand])).code, 'FORBIDDEN');
  });

  it('gives owners and managers a unified immutable activity view', async () => {
    const owner = await user('activity-owner'); const manager = await user('activity-manager');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `activity-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'manager',$3)`, [brand, manager.id, owner.id]);
    await pool.query(`INSERT INTO public.social_team_events(brand_id,actor_user_id,member_user_id,action,detail) VALUES($1,$2,$2,'accepted','{}')`, [brand, manager.id]);
    const result = await value('SELECT public.list_social_publish_activity($1,$2,50) value', [manager.auth, brand]);
    assert.equal(result.ok, true); assert.equal(result.actor_role, 'manager'); assert.equal(result.events[0].actor_email, manager.email);
  });

  it('keeps delegated functions service-only with locked search paths', async () => {
    const inboxSignatures = fullReplay
      ? ['update_social_inbox_thread(text,uuid,uuid,text)', 'create_social_inbox_reply(text,uuid,uuid,text,text)']
      : ['update_social_inbox_thread(text,uuid,text)', 'create_social_inbox_reply(text,uuid,text,text)'];
    for (const signature of [...inboxSignatures,
      'save_social_publish_queue(text,uuid,uuid,text,text,uuid[],jsonb,boolean)', 'delete_social_publish_queue(text,uuid,uuid)',
      'save_social_smartlink(text,uuid,text,text,text,text,text,boolean,jsonb)', 'list_social_publish_activity(text,uuid,integer)']) {
      for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
      const config = await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure', [`public.${signature}`]);
      assert.ok(String(config).includes('search_path='));
    }
  });
});
