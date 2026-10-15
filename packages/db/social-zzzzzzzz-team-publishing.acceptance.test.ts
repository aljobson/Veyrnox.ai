import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('actor-aware team publishing (0308)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    for (const file of ['0305_social_team_roles.sql', '0306_social_brand_access.sql', '0307_social_team_actions.sql', '0308_social_team_publishing.sql', '0311_social_post_cancel_restore.sql', '0312_social_report_templates.sql', '0313_social_customer_api.sql', '0314_social_customer_webhooks.sql', '0315_social_customer_api_logs.sql', '0317_social_scheduled_reports.sql']) {
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

  async function readyUpload(userId: string) {
    return value(`INSERT INTO public.social_uploads(id,user_id,r2_key,filename,mime_type,size_bytes,status)
      VALUES(gen_random_uuid(),$1,$2,'team-publish.jpg','image/jpeg',1024,'ready') RETURNING id value`,
      [userId, `social-uploads/team-${randomUUID()}.jpg`]);
  }

  async function createPost(auth: string, brand: string, account: string, upload: string, key = `team_${randomUUID()}`) {
    return value(`SELECT public.create_social_post($1,$2,now()+interval '2 hours','Team post',$3,$4,$5::jsonb) value`,
      [auth, brand, key, [account], JSON.stringify([{ media_type: 'image', upload_id: upload }])]);
  }

  it('lets paid editors publish, schedule, use presets and queues as themselves', async () => {
    const owner = await user('owner'); const editor = await user('editor'); const analyst = await user('analyst');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `team-publish-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'editor',$4),($1,$3,'analyst',$4)`, [brand, editor.id, analyst.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc,status)
      VALUES($1,'instagram',$2,'Team account',decode('00','hex'),'active') RETURNING id value`, [brand, `account-${randomUUID()}`]);
    const upload = await readyUpload(editor.id);

    const created = await createPost(editor.auth, brand, account, upload);
    assert.equal(created.ok, true);
    assert.equal(await value('SELECT created_by_user_id value FROM public.social_posts WHERE id=$1', [created.post_id]), editor.id);
    const scheduled = await value(`SELECT public.reschedule_social_post($1,$2,(SELECT scheduled_at FROM public.social_posts WHERE id=$2),now()+interval '3 hours') value`, [editor.auth, created.post_id]);
    assert.equal(scheduled.ok, true);

    const preset = await value(`SELECT public.save_social_content_preset($1,$2,NULL,'Campaign','Caption',$3) value`, [editor.auth, brand, [account]]);
    assert.equal(preset.ok, true);
    const slots = JSON.stringify(Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, minute: 720 })));
    const queue = await value(`SELECT public.save_social_publish_queue($1,$2,NULL,'Team queue','UTC',$3,$4,true) value`, [editor.auth, brand, [account], slots]);
    assert.equal(queue.ok, true);
    const reserved = await value(`SELECT public.reserve_social_publish_queue_slot($1,$2,$3,$4) value`, [editor.auth, brand, queue.queue_id, `reserve_${randomUUID()}`]);
    assert.equal(reserved.ok, true);
    const approval = await value(`SELECT public.create_social_post_approval(
      $1,$2,$3,now()+interval '4 hours','External review',$4,$5,$6::jsonb,'any',$7::jsonb,NULL) value`,
      [editor.auth, brand, randomUUID(), `approval_${randomUUID()}`, [account],
        JSON.stringify([{ media_type: 'image', upload_id: upload }]), JSON.stringify(['reviewer@example.com'])]);
    assert.equal(approval.ok, true);
    assert.equal(await value('SELECT requester_user_id value FROM public.social_approval_requests WHERE id=$1', [approval.request_id]), editor.id);

    const actions = await pool.query(`SELECT action FROM public.social_account_actions WHERE brand_id=$1 AND actor_id=$2`, [brand, editor.id]);
    for (const action of ['created_post', 'rescheduled_post', 'save_content_preset']) {
      assert.ok(actions.rows.some((row) => row.action === action), `${action} records the editor`);
    }
    assert.equal((await createPost(analyst.auth, brand, account, await readyUpload(analyst.id))).code, 'FORBIDDEN');
  });

  it('lets reviewers approve drafts and keeps editors out of review actions', async () => {
    const owner = await user('review-owner'); const editor = await user('review-editor'); const reviewer = await user('reviewer');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `review-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'editor',$4),($1,$3,'reviewer',$4)`, [brand, editor.id, reviewer.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [brand, `review-${randomUUID()}`]);
    const upload = await readyUpload(editor.id); const batch = randomUUID();
    const draft = await value(`SELECT public.create_social_post_draft($1,$2,$3,now()+interval '2 hours','Review me',$4,$5,$6::jsonb) value`,
      [editor.auth, brand, batch, `draft_${randomUUID()}`, [account], JSON.stringify([{ media_type: 'image', upload_id: upload }])]);
    assert.equal(draft.status, 'draft');
    assert.equal((await value('SELECT public.approve_social_post_batch($1,$2,$3) value', [editor.auth, brand, batch])).code, 'FORBIDDEN');
    const approved = await value('SELECT public.approve_social_post_batch($1,$2,$3) value', [reviewer.auth, brand, batch]);
    assert.equal(approved.ok, true); assert.equal(approved.approved, 1);
    assert.equal(await value(`SELECT count(*)::int value FROM public.social_account_actions
      WHERE brand_id=$1 AND actor_id=$2 AND action='approve_drafts' AND target_id=$3`, [brand, reviewer.id, batch]), 1);
  });

  it('preserves the owner free Post now path while delegated publishing needs Publish', async () => {
    const owner = await user('free-owner'); const editor = await user('free-editor');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'editor',$3)`, [brand, editor.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [brand, `free-${randomUUID()}`]);
    assert.equal((await createPost(owner.auth, brand, account, await readyUpload(owner.id))).ok, true);
    assert.equal((await createPost(editor.auth, brand, account, await readyUpload(editor.id))).code, 'PLAN_REQUIRED');
  });

  it('lets editors cancel untouched schedules and restore them without deleting provider posts', async () => {
    const owner = await user('cancel-owner'); const editor = await user('cancel-editor');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `cancel-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'editor',$3)`, [brand, editor.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [brand, `cancel-${randomUUID()}`]);
    const created = await createPost(editor.auth, brand, account, await readyUpload(editor.id));
    const initial = await one('SELECT updated_at::text updated_at,scheduled_at FROM public.social_posts WHERE id=$1', [created.post_id]);
    const canceled = await value('SELECT public.cancel_social_post($1,$2,$3) value', [editor.auth, created.post_id, initial.updated_at]);
    assert.equal(canceled.ok, true); assert.equal(canceled.idempotent, false);
    assert.equal(await value('SELECT status value FROM public.social_posts WHERE id=$1', [created.post_id]), 'canceled');
    const calendar = await value(`SELECT public.list_social_calendar($1,$2,now(),now()+interval '2 days',NULL,NULL,NULL,NULL) value`, [owner.auth, brand]);
    const listed = calendar.posts.find((post:any) => post.id === created.post_id);
    assert.equal(listed.can_cancel, false); assert.equal(listed.can_restore, true); assert.ok(listed.updated_at);
    const restoredAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const restored = await value('SELECT public.restore_social_post($1,$2,$3,$4) value', [editor.auth, created.post_id, canceled.updated_at, restoredAt]);
    assert.equal(restored.ok, true); assert.equal(restored.idempotent, false);
    const target = await one(`SELECT p.status,p.scheduled_at,t.next_attempt_at,t.publish_status,t.attempts,t.claimed_at
      FROM public.social_posts p JOIN public.social_post_targets t ON t.post_id=p.id WHERE p.id=$1`, [created.post_id]);
    assert.equal(target.status, 'scheduled'); assert.equal(target.scheduled_at.toISOString(), restoredAt); assert.equal(target.next_attempt_at.toISOString(), restoredAt);
    assert.equal(target.publish_status, 'pending'); assert.equal(target.attempts, 0); assert.equal(target.claimed_at, null);
    assert.equal(await value(`SELECT count(*)::int value FROM public.social_account_actions WHERE target_id=$1 AND action IN ('canceled_post','restored_post')`, [created.post_id]), 2);

    const started = await createPost(editor.auth, brand, account, await readyUpload(editor.id));
    const startedVersion = await value('SELECT updated_at::text value FROM public.social_posts WHERE id=$1', [started.post_id]);
    await pool.query("UPDATE public.social_post_targets SET attempts=1 WHERE post_id=$1", [started.post_id]);
    assert.equal((await value('SELECT public.cancel_social_post($1,$2,$3) value', [editor.auth, started.post_id, startedVersion])).code, 'POST_STARTED');
    assert.equal((await value('SELECT public.cancel_social_post($1,$2,$3) value', [editor.auth, created.post_id, initial.updated_at])).code, 'POST_CHANGED');
  });

  it('lets paid analysts manage branded report templates while viewers can run them', async () => {
    const owner = await user('report-owner'); const analyst = await user('report-analyst'); const viewer = await user('report-viewer'); const freeOwner = await user('free-report-owner');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const freeBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [freeOwner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `report-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'analyst',$4),($1,$3,'viewer',$4)`, [brand, analyst.id, viewer.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc,status)
      VALUES($1,'instagram',$2,'Report account',decode('00','hex'),'active') RETURNING id value`, [brand, `report-${randomUUID()}`]);
    const otherAccount = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [freeBrand, `other-${randomUUID()}`]);

    const saved = await value(`SELECT public.save_social_report_template($1,$2,NULL,'Monthly client report',$3,30,true,true,'Veyrnox performance','#38BDF8') value`, [analyst.auth, brand, account]);
    assert.equal(saved.ok, true);
    const listed = await value('SELECT public.list_social_report_templates($1,$2) value', [viewer.auth, brand]);
    assert.equal(listed.ok, true); assert.equal(listed.templates.length, 1);
    assert.equal(listed.templates[0].report_title, 'Veyrnox performance'); assert.equal(listed.templates[0].accent_color, '#38bdf8');
    const updated = await value(`SELECT public.save_social_report_template($1,$2,$3,'Quarterly client report',$4,90,false,false,NULL,'#112233') value`, [analyst.auth, brand, saved.template_id, account]);
    assert.equal(updated.ok, true);
    assert.equal((await value('SELECT public.list_social_report_templates($1,$2) value', [owner.auth, brand])).templates[0].range_days, 90);
    assert.equal((await value(`SELECT public.save_social_report_template($1,$2,NULL,'Wrong account',$3,30,false,true,NULL,'#112233') value`, [analyst.auth, brand, otherAccount])).code, 'INVALID_INPUT');
    assert.equal((await value(`SELECT public.save_social_report_template($1,$2,NULL,'Viewer edit',NULL,30,false,true,NULL,'#112233') value`, [viewer.auth, brand])).code, 'FORBIDDEN');
    assert.equal((await value(`SELECT public.save_social_report_template($1,$2,NULL,'Free report',NULL,30,false,true,NULL,'#112233') value`, [freeOwner.auth, freeBrand])).code, 'PLAN_REQUIRED');
    const scheduled = await value(`SELECT public.save_social_report_template_v2($1,$2,$3,'Quarterly client report',$4,90,false,false,NULL,'#112233','weekly',9,1,NULL) value`, [analyst.auth, brand, saved.template_id, account]);
    assert.equal(scheduled.ok, true); assert.ok(scheduled.next_delivery_at);
    await pool.query('UPDATE public.social_report_templates SET next_delivery_at=now()-interval \'1 minute\' WHERE id=$1', [saved.template_id]);
    const claimed = await value('SELECT public.claim_social_report_deliveries(10) value');
    assert.equal(claimed.reports.length, 1); assert.equal(claimed.reports[0].id, saved.template_id);
    assert.equal((await value('SELECT public.complete_social_report_delivery($1,$2,true,NULL,NULL) value', [saved.template_id, claimed.reports[0].claim_key])).ok, true);
    const ready = (await value('SELECT public.list_social_report_templates($1,$2) value', [viewer.auth, brand])).templates[0];
    assert.equal(ready.delivery_cadence, 'weekly'); assert.equal(ready.last_delivery_status, 'ready'); assert.ok(ready.next_delivery_at);
    assert.equal((await value('SELECT public.delete_social_report_template($1,$2,$3) value', [analyst.auth, brand, saved.template_id])).ok, true);
    assert.equal((await value('SELECT public.list_social_report_templates($1,$2) value', [viewer.auth, brand])).templates.length, 0);
    assert.equal(await value(`SELECT count(*)::int value FROM public.social_account_actions WHERE brand_id=$1 AND actor_id=$2 AND action IN ('save_report_template','delete_report_template')`, [brand, analyst.id]), 4);
  });

  it('issues scoped hash-only customer API keys and invalidates lost access', async () => {
    const owner = await user('api-owner'); const manager = await user('api-manager'); const viewer = await user('api-viewer'); const freeOwner = await user('api-free');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const freeBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [freeOwner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `api-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES
      ($1,$2,'manager',$4),($1,$3,'viewer',$4)`, [brand, manager.id, viewer.id, owner.id]);

    const created = await value(`SELECT public.create_social_api_key($1,$2,'Automation','vxpub_abcdefgh',$3,$4,now()+interval '90 days') value`,
      [owner.auth, brand, '11'.repeat(32), ['accounts:read','posts:write']]);
    assert.equal(created.ok, true);
    const listed = await value('SELECT public.list_social_api_keys($1,$2) value', [manager.auth, brand]);
    assert.equal(listed.keys[0].key_prefix, 'vxpub_abcdefgh'); assert.equal(Object.hasOwn(listed.keys[0], 'key_hash'), false);
    const authenticated = await value(`SELECT public.authenticate_social_api_key($1,'accounts:read','GET','/api/publish/v1/accounts') value`, ['11'.repeat(32)]);
    assert.equal(authenticated.auth_id, owner.auth);
    assert.equal((await value('SELECT public.complete_social_api_key_request($1,$2,200,NULL) value', [authenticated.request_id, created.key_id])).ok, true);
    const logs = await value(`SELECT public.list_social_api_request_logs($1,$2,'success','/api/publish/v1/accounts','Automation',25) value`, [manager.auth, brand]);
    assert.equal(logs.logs.length, 1); assert.equal(logs.logs[0].response_status, 200); assert.equal(Object.hasOwn(logs.logs[0], 'key_hash'), false);
    assert.equal((await value(`SELECT public.authenticate_social_api_key($1,'posts:read','GET','/api/publish/v1/posts') value`, ['11'.repeat(32)])).code, 'INSUFFICIENT_SCOPE');
    assert.equal((await value(`SELECT public.create_social_api_key($1,$2,'Viewer','vxpub_viewer123',$3,$4,now()+interval '30 days') value`, [viewer.auth, brand, '44'.repeat(32), ['accounts:read']])).code, 'FORBIDDEN');
    assert.equal((await value(`SELECT public.create_social_api_key($1,$2,'Free','vxpub_free12345',$3,$4,now()+interval '30 days') value`, [freeOwner.auth, freeBrand, '55'.repeat(32), ['accounts:read']])).code, 'PLAN_REQUIRED');

    assert.equal((await value(`SELECT public.create_social_api_key($1,$2,'Manager','vxpub_manager12',$3,$4,now()+interval '30 days') value`, [manager.auth, brand, '22'.repeat(32), ['accounts:read']])).ok, true);
    await pool.query('DELETE FROM public.social_brand_members WHERE brand_id=$1 AND user_id=$2', [brand, manager.id]);
    assert.equal((await value(`SELECT public.authenticate_social_api_key($1,'accounts:read','GET','/api/publish/v1/accounts') value`, ['22'.repeat(32)])).code, 'INVALID_API_KEY');

    assert.equal((await value('SELECT public.revoke_social_api_key($1,$2,$3) value', [owner.auth, brand, created.key_id])).ok, true);
    assert.equal((await value(`SELECT public.authenticate_social_api_key($1,'accounts:read','GET','/api/publish/v1/accounts') value`, ['11'.repeat(32)])).code, 'INVALID_API_KEY');

    const limited = await value(`SELECT public.create_social_api_key($1,$2,'Rate limited','vxpub_rate12345',$3,$4,now()+interval '30 days') value`, [owner.auth, brand, '33'.repeat(32), ['accounts:read']]);
    assert.equal(limited.ok, true);
    assert.equal((await value(`SELECT public.authenticate_social_api_key($1,'accounts:read','GET','/api/publish/v1/accounts') value`, ['33'.repeat(32)])).ok, true);
    await pool.query(`INSERT INTO public.social_api_key_requests(api_key_id) SELECT $1 FROM generate_series(1,119)`, [limited.key_id]);
    const rate = await value(`SELECT public.authenticate_social_api_key($1,'accounts:read','GET','/api/publish/v1/accounts') value`, ['33'.repeat(32)]);
    assert.equal(rate.code, 'RATE_LIMITED'); assert.ok(rate.retry_after_seconds >= 1);
    assert.equal(await value(`SELECT count(*)::int value FROM public.social_account_actions WHERE brand_id=$1 AND action IN ('create_api_key','revoke_api_key')`, [brand]), 4);
  });

  it('enqueues terminal post events once and audits webhook retries without exposing secrets', async () => {
    const owner = await user('webhook-owner'); const manager = await user('webhook-manager'); const freeOwner = await user('webhook-free');
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    const freeBrand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [freeOwner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `webhook-${randomUUID()}`]);
    await pool.query(`INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'manager',$3)`, [brand, manager.id, owner.id]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [brand, `webhook-${randomUUID()}`]);
    const secret = `\\x${'aa'.repeat(60)}`;
    const created = await value(`SELECT public.create_social_webhook_endpoint($1,$2,'Production','https://hooks.example.com/veyrnox',$3,$4) value`,
      [manager.auth, brand, secret, ['post.published','post.failed']]);
    assert.equal(created.ok, true);
    const listed = await value('SELECT public.list_social_webhook_endpoints($1,$2) value', [owner.auth, brand]);
    assert.equal(listed.endpoints[0].url, 'https://hooks.example.com/veyrnox'); assert.equal(Object.hasOwn(listed.endpoints[0], 'secret_enc'), false);
    assert.equal((await value(`SELECT public.create_social_webhook_endpoint($1,$2,'Free','https://hooks.example.com/free',$3,$4) value`, [freeOwner.auth, freeBrand, secret, ['post.failed']])).code, 'PLAN_REQUIRED');

    const post = await createPost(owner.auth, brand, account, await readyUpload(owner.id));
    const target = await value('SELECT id value FROM public.social_post_targets WHERE post_id=$1', [post.post_id]);
    await pool.query(`UPDATE public.social_post_targets SET publish_status='published',platform_post_id='ig-1',platform_post_url='https://instagram.example/p/1' WHERE id=$1`, [target]);
    await pool.query(`UPDATE public.social_post_targets SET publish_status='published' WHERE id=$1`, [target]);
    assert.equal(await value('SELECT count(*)::int value FROM public.social_webhook_outbox WHERE target_id=$1', [target]), 1);
    const claimed = await value('SELECT public.claim_social_webhook_deliveries(20) value');
    assert.equal(claimed.events.length, 1); assert.equal(Object.hasOwn(claimed.events[0], 'secret_enc'), true);
    const retried = await value('SELECT public.complete_social_webhook_delivery($1,$2,false,503,$3) value', [claimed.events[0].id, claimed.events[0].claim_key, 'http_503']);
    assert.equal(retried.outcome, 'retrying');
    const logs = await value('SELECT public.list_social_webhook_deliveries($1,$2,50) value', [manager.auth, brand]);
    assert.equal(logs.deliveries[0].last_error, 'http_503'); assert.equal(Object.hasOwn(logs.deliveries[0], 'payload'), false);
    assert.equal((await value('SELECT public.revoke_social_webhook_endpoint($1,$2,$3) value', [owner.auth, brand, created.endpoint_id])).ok, true);
    assert.equal(await value('SELECT failed_at IS NOT NULL value FROM public.social_webhook_outbox WHERE target_id=$1', [target]), true);
  });

  it('keeps every delegated publishing function service-only with locked search paths', async () => {
    for (const signature of [
      'social_brand_role_context(text,uuid,text[],boolean)', 'create_social_post(text,uuid,timestamptz,text,text,uuid[],jsonb)',
      'social_brand_contains_post(text,uuid,uuid)', 'reschedule_social_post(text,uuid,timestamptz,timestamptz)',
      'cancel_social_post(text,uuid,timestamptz)', 'restore_social_post(text,uuid,timestamptz,timestamptz)',
      'list_social_report_templates(text,uuid)', 'save_social_report_template(text,uuid,uuid,text,uuid,integer,boolean,boolean,text,text)',
      'save_social_report_template_v2(text,uuid,uuid,text,uuid,integer,boolean,boolean,text,text,text,integer,integer,integer)',
      'claim_social_report_deliveries(integer)', 'complete_social_report_delivery(uuid,uuid,boolean,text,text)',
      'delete_social_report_template(text,uuid,uuid)',
      'list_social_api_keys(text,uuid)', 'create_social_api_key(text,uuid,text,text,text,text[],timestamp with time zone)',
      'revoke_social_api_key(text,uuid,uuid)', 'authenticate_social_api_key(text,text)', 'authenticate_social_api_key(text,text,text,text)',
      'complete_social_api_key_request(bigint,uuid,integer,text)', 'list_social_api_request_logs(text,uuid,text,text,text,integer)',
      'list_social_webhook_endpoints(text,uuid)', 'create_social_webhook_endpoint(text,uuid,text,text,text,text[])',
      'revoke_social_webhook_endpoint(text,uuid,uuid)', 'list_social_webhook_deliveries(text,uuid,integer)',
      'claim_social_webhook_deliveries(integer)', 'complete_social_webhook_delivery(uuid,uuid,boolean,integer,text)',
      'save_social_content_preset(text,uuid,uuid,text,text,uuid[])', 'delete_social_content_preset(text,uuid,uuid)',
      'reserve_social_publish_queue_slot(text,uuid,uuid,text)', 'social_brand_contains_queue_assignment(text,uuid,uuid)',
      'confirm_social_publish_queue_slot(text,uuid,uuid)', 'approve_social_post_batch(text,uuid,uuid)',
      'discard_social_post_drafts(text,uuid,uuid,uuid)',
      'create_social_post_approval(text,uuid,uuid,timestamptz,text,text,uuid[],jsonb,text,jsonb,text)',
    ]) {
      for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).allowed, false);
      const config = await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure', [`public.${signature}`]);
      assert.ok(String(config).includes('search_path='));
    }
  });
});
