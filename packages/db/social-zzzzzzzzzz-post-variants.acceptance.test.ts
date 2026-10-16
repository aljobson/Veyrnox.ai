import { isFullSocialReplay } from './test-support/social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('per-platform post copy (0310)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    if (await isFullSocialReplay(pool)) return;
    for (const file of ['0301_social_content_library.sql','0302_social_content_presets.sql','0303_social_publish_queues.sql','0304_social_approvals.sql','0305_social_team_roles.sql','0306_social_brand_access.sql','0307_social_team_actions.sql','0308_social_team_publishing.sql','0309_social_inbox_workflow.sql','0310_social_post_variants.sql']) {
      const migration = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
      await pool.query(migration); await pool.query(migration);
    }
  });
  after(async () => { if (pool) await pool.end(); });

  async function fixture() {
    const auth = randomUUID(), email = `variants-${randomUUID()}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth,email]);
    const user = await value('SELECT public.provision_user($1,$2) value', [auth,email]);
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [user,`variants-${randomUUID()}`]);
    const instagram = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,decode('00','hex'),'active') RETURNING id value`, [brand,`ig-${randomUUID()}`]);
    const twitter = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'twitter',$2,decode('00','hex'),'active') RETURNING id value`, [brand,`x-${randomUUID()}`]);
    const upload = await value(`INSERT INTO public.social_uploads(id,user_id,r2_key,filename,mime_type,size_bytes,status)
      VALUES(gen_random_uuid(),$1,$2,'variant.jpg','image/jpeg',1024,'ready') RETURNING id value`, [user,`social-uploads/${randomUUID()}.jpg`]);
    return {auth,brand,instagram,twitter,upload};
  }

  it('stores and returns exact copy for each selected platform', async () => {
    const f = await fixture();
    const variants = {instagram:'Instagram version',twitter:'X version'};
    const created = await value(`SELECT public.create_social_post_with_options($1,$2,now()+interval '2 hours','Fallback',$3,$4,$5::jsonb,$6::jsonb,NULL) value`,
      [f.auth,f.brand,`variant_${randomUUID()}`,[f.instagram,f.twitter],JSON.stringify([{media_type:'image',upload_id:f.upload}]),JSON.stringify(variants)]);
    assert.equal(created.ok,true);
    const targets = await pool.query('SELECT network,text_override FROM public.social_post_targets WHERE post_id=$1 ORDER BY network',[created.post_id]);
    assert.deepEqual(targets.rows,[{network:'instagram',text_override:'Instagram version'},{network:'twitter',text_override:'X version'}]);
    const listed = await value('SELECT public.list_social_posts($1,$2) value',[f.auth,f.brand]);
    assert.deepEqual(Object.fromEntries(listed.posts[0].targets.map((target: {network:string;text_override:string})=>[target.network,target.text_override])),variants);
  });

  it('rejects unselected networks and exposes review copy per destination', async () => {
    const f = await fixture();
    const invalid = await value(`SELECT public.create_social_post_with_options($1,$2,now()+interval '2 hours','Fallback',$3,$4,$5::jsonb,$6::jsonb,NULL) value`,
      [f.auth,f.brand,`invalid_${randomUUID()}`,[f.instagram],JSON.stringify([{media_type:'image',upload_id:f.upload}]),JSON.stringify({twitter:'Not selected'})]);
    assert.equal(invalid.code,'INVALID_NETWORK_TEXT');
    const approval = await value(`SELECT public.create_social_post_approval_with_variants($1,$2,$3,now()+interval '3 hours','Fallback',$4,$5,$6::jsonb,'all',$7::jsonb,NULL,$8::jsonb) value`,
      [f.auth,f.brand,randomUUID(),`review_${randomUUID()}`,[f.instagram,f.twitter],JSON.stringify([{media_type:'image',upload_id:f.upload}]),JSON.stringify(['reviewer@example.com']),JSON.stringify({instagram:'Review IG',twitter:'Review X'})]);
    assert.equal(approval.ok,true);
    const review = await value('SELECT public.get_social_approval_review($1) value',[approval.reviewers[0].id]);
    assert.deepEqual(review.targets,[{network:'instagram',text:'Review IG'},{network:'twitter',text:'Review X'}]);
  });

  it('keeps variant entry points service-only with locked search paths', async () => {
    for (const signature of [
      'create_social_post_with_options(text,uuid,timestamptz,text,text,uuid[],jsonb,jsonb,text)',
      'create_social_post_approval_with_variants(text,uuid,uuid,timestamptz,text,text,uuid[],jsonb,text,jsonb,text,jsonb)',
    ]) {
      for (const role of ['anon','authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${signature}`])).allowed,false);
      assert.ok(String(await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure',[`public.${signature}`])).includes('search_path='));
    }
  });
});
