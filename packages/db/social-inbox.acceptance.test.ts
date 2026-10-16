import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social inbox (0299)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  let fullReplay = false;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    fullReplay = await isFullSocialReplay(pool);
    if (fullReplay) return;
    await pool.query(`DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF;
    END LOOP; END $$`);
    // Acceptance CI starts from packages/db/schema only. Apply this migration's
    // Supabase dependency explicitly so the file also passes in isolation.
    const users = await readFile(new URL('./schema/supabase/0071_signup_grant_on_email_confirmation.sql', import.meta.url), 'utf8');
    const foundation = await readFile(new URL('./schema/supabase/0154_social_publish_foundation.sql', import.meta.url), 'utf8');
    const plans = await readFile(new URL('./schema/supabase/0293_social_publish_plans.sql', import.meta.url), 'utf8');
    const migration = await readFile(new URL('./schema/supabase/0299_social_inbox.sql', import.meta.url), 'utf8');
    await pool.query(users); await pool.query(users);
    await pool.query(foundation); await pool.query(foundation);
    await pool.query(plans); await pool.query(plans);
    await pool.query(migration); await pool.query(migration);
  });
  after(async () => { if (pool) await pool.end(); });

  async function fixture({ paid = true, scopes = ['instagram_business_manage_comments'] } = {}) {
    const auth = randomUUID();
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
    const userId = await value('SELECT public.provision_user($1,$2) AS value', [auth, `${auth}@test.veyrnox.ai`]);
    const brand = await value('SELECT public.get_or_create_default_social_brand($1) AS value', [auth]);
    const external = `ig-${randomUUID()}`;
    const accountId = (await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status)
      VALUES($1,'instagram',$2,'@publisher',$3,$4,'active') RETURNING id`, [brand.brand_id, external, scopes, Buffer.from('encrypted-token')])).id;
    if (paid) await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [userId, `inbox-${randomUUID()}`]);
    return { auth, userId, brandId: brand.brand_id, accountId, external };
  }
  const ingest = (f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) => value(
    `SELECT public.ingest_social_inbox_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS value`,
    ['instagram', f.external, 'comment-1', 'comment', 'comment-1', 'inbound', 'A customer question', JSON.stringify([]), 'visitor-1', 'Visitor', null,
      'Instagram comment', 'https://www.instagram.com/p/example/', true, new Date().toISOString()].map((item, index) => overrides[String(index)] ?? item),
  );
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const listInbox = (f: Fixture, state: string) => value(fullReplay
    ? `SELECT public.list_social_inbox(p_auth_id=>$1,p_brand_id=>$2,p_account_id=>NULL,
        p_state=>$3,p_kind=>NULL,p_search=>NULL,p_assignee=>NULL,p_priority=>NULL,p_tag=>NULL) AS value`
    : `SELECT public.list_social_inbox(p_auth_id=>$1,p_brand_id=>$2,p_account_id=>NULL,
        p_state=>$3,p_kind=>NULL,p_search=>NULL) AS value`, [f.auth, f.brandId, state]);
  const thread = (f: Fixture, id: string) => value(fullReplay
    ? 'SELECT public.get_social_inbox_thread(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3) AS value'
    : 'SELECT public.get_social_inbox_thread(p_auth_id=>$1,p_thread_id=>$2) AS value',
  fullReplay ? [f.auth, f.brandId, id] : [f.auth, id]);
  const updateThread = (f: Fixture, id: string, action: string) => value(fullReplay
    ? 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3,p_action=>$4) AS value'
    : 'SELECT public.update_social_inbox_thread(p_auth_id=>$1,p_thread_id=>$2,p_action=>$3) AS value',
  fullReplay ? [f.auth, f.brandId, id, action] : [f.auth, id, action]);
  const reply = (f: Fixture, id: string, body: string, key: string) => value(fullReplay
    ? 'SELECT public.create_social_inbox_reply(p_auth_id=>$1,p_brand_id=>$2,p_thread_id=>$3,p_body=>$4,p_idempotency_key=>$5) AS value'
    : 'SELECT public.create_social_inbox_reply(p_auth_id=>$1,p_thread_id=>$2,p_body=>$3,p_idempotency_key=>$4) AS value',
  fullReplay ? [f.auth, f.brandId, id, body, key] : [f.auth, id, body, key]);

  it('deduplicates provider events and exposes unified conversation summaries only to a paid owner', async () => {
    const owner = await fixture();
    const first = await ingest(owner); const duplicate = await ingest(owner);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual([first.idempotent, duplicate.idempotent], [false, true]);
    const listed = await listInbox(owner, 'unresolved');
    assert.deepEqual(listed.counts, { all: 1, unread: 1, unresolved: 1, resolved: 0 });
    assert.equal(listed.threads.length, 1);
    assert.deepEqual([listed.threads[0].network, listed.threads[0].kind, listed.threads[0].preview, listed.threads[0].can_reply],
      ['instagram', 'comment', 'A customer question', true]);

    const free = await fixture({ paid: false });
    assert.deepEqual(await listInbox(free, 'all'),
      { ok: false, code: 'PLAN_REQUIRED' });
    assert.deepEqual(await thread(free, first.thread_id),
      { ok: false, code: 'PLAN_REQUIRED' });
  });

  it('marks read and resolved, and queues an idempotent supported reply for provider delivery', async () => {
    const owner = await fixture(); const event = await ingest(owner);
    assert.deepEqual(await updateThread(owner, event.thread_id, 'read'), { ok: true });
    assert.equal((await thread(owner, event.thread_id)).thread.unread_count, 0);
    assert.deepEqual(await updateThread(owner, event.thread_id, 'resolve'), { ok: true });
    const key = `reply-${randomUUID()}`;
    const created = await reply(owner, event.thread_id, 'Thanks for your message.', key);
    assert.deepEqual([created.ok, created.idempotent, created.network, created.provider_thread_id], [true, false, 'instagram', 'comment-1']);
    assert.equal(created.access_token_enc, Buffer.from('encrypted-token').toString('hex'));
    const repeated = await reply(owner, event.thread_id, 'Different body is ignored', key);
    assert.deepEqual([repeated.idempotent, repeated.message_id], [true, created.message_id]);
    assert.deepEqual(await value('SELECT public.finish_social_inbox_reply($1,true,$2,NULL) AS value', [created.message_id, 'provider-reply-1']), { ok: true });
    const detail = await thread(owner, event.thread_id);
    assert.deepEqual(detail.messages.map((message: { direction: string; delivery_status: string }) => [message.direction, message.delivery_status]),
      [['inbound', 'received'], ['outbound', 'sent']]);
  });

  it('never enables replies without the exact provider permission and keeps browser roles closed', async () => {
    const owner = await fixture({ scopes: [] }); const event = await ingest(owner);
    assert.equal((await thread(owner, event.thread_id)).thread.can_reply, false);
    assert.deepEqual(await reply(owner, event.thread_id, 'Hello', `reply-${randomUUID()}`),
      { ok: false, code: 'REPLY_UNAVAILABLE' });
    for (const table of ['social_inbox_threads', 'social_inbox_messages', 'social_inbox_actions']) {
      for (const role of ['anon', 'authenticated']) {
        const row = await one(`SELECT has_table_privilege($1,$2,'SELECT') OR has_table_privilege($1,$2,'INSERT') AS allowed`, [role, `public.${table}`]);
        assert.equal(row.allowed, false, `${role} on ${table}`);
      }
    }
  });
});
