import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('team inbox workflow, analytics and contacts (0309, 0316, 0318, 0319, 0320)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    if (await isFullSocialReplay(pool)) return;
    for (const file of ['0071_signup_grant_on_email_confirmation.sql', '0154_social_publish_foundation.sql',
      '0293_social_publish_plans.sql', '0299_social_inbox.sql', '0305_social_team_roles.sql',
      '0306_social_brand_access.sql', '0307_social_team_actions.sql', '0308_social_team_publishing.sql',
      '0309_social_inbox_workflow.sql', '0316_social_inbox_analytics.sql', '0318_social_inbox_contacts.sql',
      '0319_social_contact_import.sql', '0320_social_inbox_workflows.sql']) {
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

  it('summarizes paid inbox volume, delivery and first-response time without crossing brands', async () => {
    const owner = await user('inbox-analytics-owner');
    const outsider = await user('inbox-analytics-outsider');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const outsideBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [outsider.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `inbox-analytics-${randomUUID()}`]);
    const external = `analytics-${randomUUID()}`;
    const outsideExternal = `outside-${randomUUID()}`;
    const account = (await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'instagram',$2,'@analytics',ARRAY['instagram_business_manage_comments'],decode('00','hex'),'active') RETURNING id`, [brand, external])).id;
    await pool.query(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'facebook',$2,'Outside',ARRAY['pages_manage_posts'],decode('00','hex'),'active')`, [outsideBrand, outsideExternal]);
    const receivedAt = new Date(Date.now() - 30 * 60 * 1000);
    const event = await value(`SELECT public.ingest_social_inbox_event(
      'instagram',$1,'analytics-thread','comment','analytics-inbound','inbound','Question','[]'::jsonb,
      'customer-analytics','Customer',NULL,'Question','https://instagram.com/p/analytics',true,$2) value`, [external, receivedAt]);
    await pool.query(`INSERT INTO public.social_inbox_messages(thread_id,direction,body,delivery_status,sent_at)
      VALUES($1,'outbound','Answer','sent',$2),($1,'outbound','Retry','failed',$3)`,
      [event.thread_id, new Date(receivedAt.getTime() + 120_000), new Date(receivedAt.getTime() + 180_000)]);
    await pool.query(`INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action,detail,created_at)
      VALUES($1,$2,$3,'read','{}'::jsonb,now())`, [brand, event.thread_id, owner.id]);
    await value(`SELECT public.ingest_social_inbox_event(
      'facebook',$1,'outside-thread','message','outside-inbound','inbound','Private','[]'::jsonb,
      'outside-customer','Outside',NULL,NULL,NULL,false,now()) value`, [outsideExternal]);

    const result = await value('SELECT public.get_social_inbox_analytics($1,$2,$3,30) value', [owner.auth, brand, account]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.summary, { conversations: 1, received: 1, sent: 1, failed: 1, read_actions: 1, median_response_seconds: 120 });
    assert.equal(result.platforms[0].network, 'instagram');
    assert.deepEqual([result.platforms[0].received, result.platforms[0].sent, result.platforms[0].failed], [1, 1, 1]);
    assert.equal(result.trend.reduce((sum: number, day: { received: number }) => sum + day.received, 0), 1);
    assert.equal(result.heatmap.reduce((sum: number, cell: { received: number }) => sum + cell.received, 0), 1);
    assert.equal((await value('SELECT public.get_social_inbox_analytics($1,$2,NULL,30) value', [outsider.auth, brand])).code, 'BRAND_NOT_FOUND');
    assert.equal((await value('SELECT public.get_social_inbox_analytics($1,$2,NULL,14) value', [owner.auth, brand])).code, 'INVALID_RANGE');
  });

  it('builds a paid contact directory from conversations and stores team context separately', async () => {
    const owner = await user('inbox-contact-owner'); const viewer = await user('inbox-contact-viewer');
    const outsider = await user('inbox-contact-outsider');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await value('SELECT public.get_or_create_default_social_brand($1) value', [outsider.auth]);
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `inbox-contacts-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'viewer',$3)`, [brand, viewer.id, owner.id]);
    const external = `contacts-${randomUUID()}`;
    const account = (await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'facebook',$2,'Veyrnox Page',ARRAY['pages_manage_posts'],decode('00','hex'),'active') RETURNING id`, [brand, external])).id;
    await value(`SELECT public.ingest_social_inbox_event(
      'facebook',$1,'contact-thread-one','message','contact-one','inbound','Hello','[]'::jsonb,
      'contact-42','Alex Customer',NULL,'First question',NULL,true,now()-interval '1 hour') value`, [external]);
    await value(`SELECT public.ingest_social_inbox_event(
      'facebook',$1,'contact-thread-two','comment','contact-two','inbound','Interested','[]'::jsonb,
      'contact-42','Alex Customer',NULL,'Second question',NULL,true,now()) value`, [external]);

    const initial = await value('SELECT public.list_social_inbox_contacts($1,$2,$3,NULL,NULL,NULL,NULL) value', [viewer.auth, brand, account]);
    assert.equal(initial.ok, true); assert.equal(initial.contacts.length, 1);
    assert.deepEqual([initial.contacts[0].thread_count, initial.contacts[0].message_count, initial.contacts[0].unread_count], [2, 2, 2]);
    assert.deepEqual([initial.contacts[0].subscription_status, initial.contacts[0].tags], ['unknown', []]);

    const updated = await value(`SELECT public.update_social_inbox_contact($1,$2,$3,'contact-42',$4::jsonb,'subscribed',$5) value`,
      [owner.auth, brand, account, JSON.stringify(['VIP', 'customer', 'vip']), 'Asked about annual pricing.']);
    assert.deepEqual(updated, { ok: true, tags: ['customer', 'vip'], subscription_status: 'subscribed' });
    const filtered = await value(`SELECT public.list_social_inbox_contacts($1,$2,NULL,'facebook','subscribed','alex','vip') value`, [viewer.auth, brand]);
    assert.equal(filtered.contacts.length, 1); assert.equal(filtered.contacts[0].notes, 'Asked about annual pricing.');
    const imported = await value(`SELECT public.import_social_inbox_contacts($1,$2,$3,'csv',$4::jsonb) value`, [owner.auth, brand, account,
      JSON.stringify([{ external_id: 'manual-7', name: 'Manual Contact', tags: ['lead'], subscription_status: 'unknown', notes: 'Imported.' }])]);
    assert.deepEqual(imported, { ok: true, imported: 1 });
    const directory = await value(`SELECT public.list_social_inbox_contacts($1,$2,$3,'facebook',NULL,NULL,NULL) value`, [viewer.auth, brand, account]);
    assert.equal(directory.contacts.length, 2);
    const manual = directory.contacts.find((contact: { external_id: string }) => contact.external_id === 'manual-7');
    assert.deepEqual([manual.name, manual.source, manual.thread_count, manual.message_count, manual.notes],
      ['Manual Contact', 'csv', 0, 0, 'Imported.']);
    assert.equal((await value(`SELECT public.import_social_inbox_contacts($1,$2,$3,'manual',$4::jsonb) value`,
      [viewer.auth, brand, account, JSON.stringify([{ external_id: 'denied', name: 'Denied' }])])).code, 'FORBIDDEN');
    assert.equal((await value(`SELECT public.update_social_inbox_contact($1,$2,$3,'contact-42','[]'::jsonb,'unknown',NULL) value`,
      [viewer.auth, brand, account])).code, 'FORBIDDEN');
    assert.equal((await value('SELECT public.list_social_inbox_contacts($1,$2,NULL,NULL,NULL,NULL,NULL) value', [outsider.auth, brand])).code, 'BRAND_NOT_FOUND');
  });

  it('matches inbound keywords into reviewable suggestions without sending replies', async () => {
    const owner = await user('keyword-owner'); const viewer = await user('keyword-viewer');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `keyword-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'viewer',$3)`, [brand, viewer.id, owner.id]);
    const external = `keyword-${randomUUID()}`;
    const account = (await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'instagram',$2,'@keyword',ARRAY['instagram_business_manage_comments'],decode('00','hex'),'active') RETURNING id`, [brand, external])).id;
    const saved = await value(`SELECT public.save_social_inbox_workflow($1,$2,NULL,'Pricing reply',$3,'comment','price','contains',$4,true) value`,
      [owner.auth, brand, account, 'Our plans start at $15.']);
    assert.equal(saved.ok, true); assert.equal(saved.created, true);
    const event = await value(`SELECT public.ingest_social_inbox_event(
      'instagram',$1,'keyword-thread','comment','keyword-message','inbound','What is the PRICE?','[]'::jsonb,
      'keyword-person','Customer',NULL,'Pricing question',NULL,true,now()) value`, [external]);
    assert.equal((await value('SELECT public.evaluate_social_inbox_workflows($1,$2) value', [event.thread_id, event.message_id])).matched, 1);
    assert.equal((await value('SELECT public.evaluate_social_inbox_workflows($1,$2) value', [event.thread_id, event.message_id])).matched, 0);
    const listed = await value('SELECT public.list_social_inbox_suggestions($1,$2,$3) value', [viewer.auth, brand, event.thread_id]);
    assert.equal(listed.suggestions.length, 1); assert.equal(listed.suggestions[0].suggested_reply, 'Our plans start at $15.');
    assert.equal((await one(`SELECT count(*)::int count FROM public.social_inbox_messages WHERE thread_id=$1 AND direction='outbound'`, [event.thread_id])).count, 0);
    assert.equal((await value(`SELECT public.decide_social_inbox_suggestion($1,$2,$3,$4,'use') value`,
      [viewer.auth, brand, event.thread_id, listed.suggestions[0].id])).code, 'FORBIDDEN');
    const used = await value(`SELECT public.decide_social_inbox_suggestion($1,$2,$3,$4,'use') value`,
      [owner.auth, brand, event.thread_id, listed.suggestions[0].id]);
    assert.equal(used.suggested_reply, 'Our plans start at $15.');
    assert.equal((await one(`SELECT count(*)::int count FROM public.social_inbox_messages WHERE thread_id=$1 AND direction='outbound'`, [event.thread_id])).count, 0);
  });

  it('keeps workflow tables and functions service-only', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one("SELECT has_table_privilege($1,'public.social_inbox_notes','SELECT') allowed", [role])).allowed, false);
      assert.equal((await one("SELECT has_table_privilege($1,'public.social_inbox_contact_profiles','SELECT') allowed", [role])).allowed, false);
      assert.equal((await one("SELECT has_table_privilege($1,'public.social_inbox_workflows','SELECT') allowed", [role])).allowed, false);
      assert.equal((await one("SELECT has_table_privilege($1,'public.social_inbox_suggestions','SELECT') allowed", [role])).allowed, false);
      for (const signature of ['list_social_inbox(text,uuid,uuid,text,text,text,text,text,text)',
        'get_social_inbox_thread(text,uuid,uuid)', 'update_social_inbox_thread(text,uuid,uuid,text)',
        'update_social_inbox_workflow(text,uuid,uuid,text,jsonb)', 'add_social_inbox_note(text,uuid,uuid,text)',
        'create_social_inbox_reply(text,uuid,uuid,text,text)', 'get_social_inbox_analytics(text,uuid,uuid,integer)',
        'list_social_inbox_contacts(text,uuid,uuid,text,text,text,text)',
        'update_social_inbox_contact(text,uuid,uuid,text,jsonb,text,text)',
        'import_social_inbox_contacts(text,uuid,uuid,text,jsonb)', 'list_social_inbox_workflows(text,uuid)',
        'save_social_inbox_workflow(text,uuid,uuid,text,uuid,text,text,text,text,boolean)',
        'delete_social_inbox_workflow(text,uuid,uuid)', 'evaluate_social_inbox_workflows(uuid,uuid)',
        'list_social_inbox_suggestions(text,uuid,uuid)', 'decide_social_inbox_suggestion(text,uuid,uuid,uuid,text)']) {
        assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
      }
    }
  });
});
