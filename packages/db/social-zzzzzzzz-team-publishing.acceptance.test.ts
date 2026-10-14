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
    for (const file of ['0305_social_team_roles.sql', '0306_social_brand_access.sql', '0307_social_team_actions.sql', '0308_social_team_publishing.sql']) {
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

  it('keeps every delegated publishing function service-only with locked search paths', async () => {
    for (const signature of [
      'social_brand_role_context(text,uuid,text[],boolean)', 'create_social_post(text,uuid,timestamptz,text,text,uuid[],jsonb)',
      'social_brand_contains_post(text,uuid,uuid)', 'reschedule_social_post(text,uuid,timestamptz,timestamptz)',
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
