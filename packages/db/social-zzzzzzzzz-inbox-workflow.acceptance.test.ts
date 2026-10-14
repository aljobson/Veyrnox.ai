import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('team inbox workflow (0309)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    for (const file of ['0071_signup_grant_on_email_confirmation.sql', '0154_social_publish_foundation.sql',
      '0293_social_publish_plans.sql', '0299_social_inbox.sql', '0305_social_team_roles.sql',
      '0306_social_brand_access.sql', '0307_social_team_actions.sql', '0308_social_team_publishing.sql',
      '0309_social_inbox_workflow.sql']) {
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

  it('lets the paid team triage one unified conversation with assignment, tags and notes', async () => {
    const owner = await user('inbox-owner'); const editor = await user('inbox-editor');
    const reviewer = await user('inbox-reviewer'); const viewer = await user('inbox-viewer');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `inbox-workflow-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'editor',$5),($1,$3,'reviewer',$5),($1,$4,'viewer',$5)`, [brand, editor.id, reviewer.id, viewer.id, owner.id]);
    const external = `ig-${randomUUID()}`;
    await pool.query(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'instagram',$2,'@team-inbox',ARRAY['instagram_business_manage_comments'],decode('00','hex'),'active')`, [brand, external]);
    const event = await value(`SELECT public.ingest_social_inbox_event(
      'instagram',$1,'comment-workflow','comment','message-workflow','inbound','Please help','[]'::jsonb,
      'customer-1','Customer',NULL,'Help request','https://instagram.com/p/example',true,now()) value`, [external]);
    assert.equal(event.ok, true);

    assert.deepEqual(await value(`SELECT public.update_social_inbox_workflow($1,$2,$3,'assign',$4::jsonb) value`,
      [editor.auth, brand, event.thread_id, JSON.stringify({ user_id: reviewer.id })]), { ok: true });
    assert.deepEqual(await value(`SELECT public.update_social_inbox_workflow($1,$2,$3,'priority',$4::jsonb) value`,
      [reviewer.auth, brand, event.thread_id, JSON.stringify({ priority: 'urgent' })]), { ok: true });
    assert.deepEqual(await value(`SELECT public.update_social_inbox_workflow($1,$2,$3,'tags',$4::jsonb) value`,
      [reviewer.auth, brand, event.thread_id, JSON.stringify({ tags: ['Sales', 'vip', 'sales'] })]), { ok: true });
    const noted = await value('SELECT public.add_social_inbox_note($1,$2,$3,$4) value',
      [reviewer.auth, brand, event.thread_id, 'Follow up before Friday.']);
    assert.equal(noted.note.actor_email, reviewer.email);
    assert.deepEqual(await value("SELECT public.update_social_inbox_thread($1,$2,$3,'resolve') value",
      [reviewer.auth, brand, event.thread_id]), { ok: true });

    const detail = await value('SELECT public.get_social_inbox_thread($1,$2,$3) value', [viewer.auth, brand, event.thread_id]);
    assert.deepEqual([detail.thread.assigned_user_id, detail.thread.priority, detail.thread.status], [reviewer.id, 'urgent', 'resolved']);
    assert.deepEqual(detail.thread.tags, ['sales', 'vip']);
    assert.equal(detail.notes[0].body, 'Follow up before Friday.');
    const listed = await value(`SELECT public.list_social_inbox($1,$2,NULL,'resolved',NULL,NULL,$3,'urgent','vip') value`,
      [viewer.auth, brand, reviewer.id]);
    assert.equal(listed.threads.length, 1);
    assert.ok(listed.members.some((member: { user_id: string }) => member.user_id === reviewer.id));

    assert.equal((await value(`SELECT public.update_social_inbox_workflow($1,$2,$3,'priority',$4::jsonb) value`,
      [viewer.auth, brand, event.thread_id, JSON.stringify({ priority: 'normal' })])).code, 'FORBIDDEN');
    assert.equal((await value('SELECT public.create_social_inbox_reply($1,$2,$3,$4,$5) value',
      [reviewer.auth, brand, event.thread_id, 'Thanks', `reply-${randomUUID()}`])).code, 'FORBIDDEN');
  });

  it('keeps workflow tables and functions service-only', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one("SELECT has_table_privilege($1,'public.social_inbox_notes','SELECT') allowed", [role])).allowed, false);
      for (const signature of ['list_social_inbox(text,uuid,uuid,text,text,text,text,text,text)',
        'get_social_inbox_thread(text,uuid,uuid)', 'update_social_inbox_thread(text,uuid,uuid,text)',
        'update_social_inbox_workflow(text,uuid,uuid,text,jsonb)', 'add_social_inbox_note(text,uuid,uuid,text)',
        'create_social_inbox_reply(text,uuid,uuid,text,text)']) {
        assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
      }
    }
  });
});
