import { isFullSocialReplay } from './test-support/social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social content reuse (0301)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;
  before(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    if (await isFullSocialReplay(pool)) return;
    // Acceptance CI starts from packages/db/schema and runs files by name, so
    // the scheduler acceptance suite has not installed create_social_post yet.
    // Apply this feature's Supabase dependencies explicitly and prove replay.
    for (const file of ['0071_signup_grant_on_email_confirmation.sql', '0154_social_publish_foundation.sql']) {
      const migration = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
      await pool.query(migration); await pool.query(migration);
    }
    const schedulerReady = await one(`SELECT to_regprocedure('public.create_social_post(text,uuid,timestamptz,text,text,uuid[],jsonb)') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_post_media' AND column_name='source_upload_id') AS ready`);
    if (!schedulerReady.ready) {
      for (const file of [
        '0156_social_publish_scheduling.sql',
        '0160_social_publish_composer.sql',
        '0161_social_publish_async_engine.sql',
        '0168_social_publish_claim_guards.sql',
        '0223_social_device_uploads.sql',
      ]) {
        const migration = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
        await pool.query(migration);
      }
    }
    const migration = await readFile(new URL('./schema/supabase/0301_social_content_library.sql', import.meta.url), 'utf8');
    await pool.query(migration); await pool.query(migration);
  });
  after(async () => { if (pool) await pool.end(); });

  it('returns only owner-scoped reusable references and includes target account ids', async () => {
    const auth = randomUUID(); const email = `${auth}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]);
    const userId = await value('SELECT public.provision_user($1,$2) AS value', [auth, email]);
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) AS value', [auth])).brand_id;
    const account = (await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,$3,'active') RETURNING id`, [brand, `ig-${randomUUID()}`, Buffer.from('cipher')])).id;
    const job = (await one(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs)
      VALUES($1,$2,'content-reuse-fixture',1,'STORED','{}'::jsonb) RETURNING id`, [userId, `reuse-${randomUUID()}`])).id;
    await pool.query(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes)
      VALUES($1,$2,'image/png',10)`, [job, `reuse/${randomUUID()}.png`]);
    const made = await value('SELECT public.create_social_post($1,$2,now(),$3,$4,$5,$6) AS value',
      [auth, brand, 'Reusable caption', `reuse_${randomUUID()}`, [account], JSON.stringify([{ media_type: 'image', job_id: job }])]);
    assert.equal(made.ok, true, JSON.stringify(made));
    const listed = await value('SELECT public.list_social_posts($1,$2,50,NULL,NULL) AS value', [auth, brand]);
    assert.equal(listed.posts[0].global_text, 'Reusable caption');
    assert.deepEqual(listed.posts[0].media, [{ media_type: 'image', job_id: job }]);
    assert.equal(listed.posts[0].targets[0].account_id, account);

    const otherAuth = randomUUID(); const otherEmail = `${otherAuth}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [otherAuth, otherEmail]);
    await value('SELECT public.provision_user($1,$2) AS value', [otherAuth, otherEmail]);
    assert.deepEqual(await value('SELECT public.list_social_posts($1,$2,50,NULL,NULL) AS value', [otherAuth, brand]), { ok: false, code: 'BRAND_NOT_FOUND' });
  });

  it('keeps execution service-only and the function search path empty', async () => {
    for (const role of ['anon', 'authenticated']) assert.equal(await value(`SELECT has_function_privilege($1,'public.list_social_posts(text,uuid,integer,timestamptz,uuid)','EXECUTE') AS value`, [role]), false);
    assert.equal(await value(`SELECT proconfig = ARRAY['search_path=""']::text[] AS value FROM pg_proc WHERE oid='public.list_social_posts(text,uuid,integer,timestamptz,uuid)'::regprocedure`), true);
  });
});
