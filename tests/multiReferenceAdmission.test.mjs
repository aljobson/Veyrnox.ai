import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Opt-in DB proof. Namespaced fixtures and actual migration bodies are executed
// in a rolled-back transaction; no application tables/functions are replaced.
test('paid/free admission compares ordered identity; chat retries ignore search execution cost', {
  skip: !process.env.DATABASE_URL && 'DATABASE_URL is not set; run this DB proof in ledger-tests CI or against a disposable test database',
}, async () => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `multi_reference_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    const migration = readFileSync(new URL('../packages/db/schema/supabase/0396_multi_reference_identity.sql', import.meta.url), 'utf8');
    const setup = `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA ${schema};
SET LOCAL search_path = ${schema}, pg_catalog;
CREATE TABLE credit_balances (user_id uuid primary key, balance int, free_balance int, subscription_balance int, subscription_expires_at timestamptz, subscription_cycle int, updated_at timestamptz);
CREATE TABLE users (id uuid primary key, frozen_at timestamptz, hold_until timestamptz);
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), user_id uuid, idempotency_key text, model_id text, credits int, inputs jsonb, state text, free_allowance boolean, created_at timestamptz default now(), unique(user_id,idempotency_key));
CREATE TABLE ledger_entries (user_id uuid, delta int, free_delta int, subscription_delta int, subscription_cycle int, reason text, job_id uuid);
CREATE FUNCTION private.fal_admission_paused(text,boolean) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.free_allowance_take(uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true,"taken":true,"left":5}'::jsonb $$;
INSERT INTO credit_balances VALUES ('11111111-1111-4111-8111-111111111111',100,0,0,null,0,null);
INSERT INTO users(id) SELECT user_id FROM credit_balances;`;
    const assertions = `DO $$
DECLARE u uuid := '11111111-1111-4111-8111-111111111111'; result jsonb; mode text; key text;
inputs jsonb := '{"prompt":"p","references":[{"slot":"image","origin":"upload","key":"a"},{"slot":"image","origin":"asset","asset_id":"b"},{"slot":"image","origin":"upload","key":"c"}]}'; changed jsonb;
BEGIN
FOREACH mode IN ARRAY ARRAY['paid','free'] LOOP
 key := mode || '-same-key';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'model',inputs); END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'idempotent' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'first admission %',result; END IF;
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'model',inputs); END IF;
 IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'identical replay %',result; END IF;
 FOR changed IN SELECT jsonb_set(inputs,'{references}',jsonb_build_array(inputs->'references'->2,inputs->'references'->1,inputs->'references'->0))
 UNION ALL SELECT jsonb_set(inputs,'{references,1,asset_id}','"replacement"')
 UNION ALL SELECT jsonb_set(inputs,'{prompt}','"changed"') LOOP
  IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',changed);
  ELSE result := private.submit_free_job_for_admission(u,key,'model',changed); END IF;
  IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed replay %',result; END IF;
 END LOOP;
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','different-model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'different-model',inputs); END IF;
 IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'model replay %',result; END IF;
END LOOP;
result := private.ledger_debit_for_admission(u,'chat-key',5,'debit:chat','chat-model','{"kind":"chat","thread_id":"thread","request_hash":"hash","options":{"web":true},"search_cost_usd":0.01}');
result := private.ledger_debit_for_admission(u,'chat-key',5,'debit:chat','chat-model','{"kind":"chat","thread_id":"thread","request_hash":"hash","options":{"web":true},"search_cost_usd":0.02,"web_engine":"capped"}');
IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'chat execution metadata replay %',result; END IF;
IF (SELECT count(*) FROM jobs) <> 3 OR (SELECT count(*) FROM ledger_entries) <> 2 OR (SELECT balance FROM credit_balances WHERE user_id=u) <> 90 THEN RAISE EXCEPTION 'money changed on replay'; END IF;
IF private.generation_request_identity('{"prompt":"p","source_keys":{"image_url":"a"}}') IS DISTINCT FROM private.generation_request_identity('{"prompt":"p","references":[{"slot":"image","origin":"upload","key":"a"}]}') THEN RAISE EXCEPTION 'legacy identity changed'; END IF;
-- A pre-deploy chat row has no request_hash. Its missing hash is a wildcard,
-- while model/thread/options/references still bind both paid and free retries.
FOREACH mode IN ARRAY ARRAY['paid','free'] LOOP
 key := mode || '-legacy-chat';
 inputs := '{"kind":"chat","thread_id":"legacy-thread","options":{"web":true},"search_cost_usd":0.01}';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:chat','chat-model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'chat-model',inputs); END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'legacy chat admission %',result; END IF;
 changed := inputs || '{"request_hash":"new-hash","search_cost_usd":0.02,"web_engine":"different"}';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:chat','chat-model',changed);
 ELSE result := private.submit_free_job_for_admission(u,key,'chat-model',changed); END IF;
 IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'legacy chat replay %',result; END IF;
 FOR changed IN SELECT inputs || '{"request_hash":"new-hash","thread_id":"other"}'
 UNION ALL SELECT inputs || '{"options":{"web":false}}'
 UNION ALL SELECT inputs || '{"references":[{"slot":"image","origin":"upload","key":"different"}]}' LOOP
  IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:chat','chat-model',changed);
  ELSE result := private.submit_free_job_for_admission(u,key,'chat-model',changed); END IF;
  IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'legacy changed identity %',result; END IF;
 END LOOP;
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:chat','different-model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'different-model',inputs); END IF;
 IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'legacy model replay %',result; END IF;
END LOOP;
-- New jobs bind their stored hash; the wildcard must not become symmetric.
result := private.ledger_debit_for_admission(u,'chat-key',5,'debit:chat','chat-model','{"kind":"chat","thread_id":"thread","request_hash":"changed","options":{"web":true}}');
IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed new chat hash %',result; END IF;
result := private.ledger_debit_for_admission(u,'chat-key',5,'debit:chat','chat-model','{"kind":"chat","thread_id":"thread","options":{"web":true}}');
IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'missing incoming chat hash %',result; END IF;
IF (SELECT count(*) FROM jobs) <> 5 OR (SELECT count(*) FROM ledger_entries) <> 3 OR (SELECT balance FROM credit_balances WHERE user_id=u) <> 85 THEN RAISE EXCEPTION 'legacy replay changed money'; END IF;
FOREACH mode IN ARRAY ARRAY['paid','free'] LOOP
 key := mode || '-legacy-map';
 inputs := '{"prompt":"p","source_keys":{"endImage_url":"upload-end"},"source_assets":{"image_url":"library-start"}}';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'model',inputs); END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'legacy map admission %',result; END IF;
 changed := '{"prompt":"p","references":[{"slot":"image","origin":"asset","asset_id":"library-start"},{"slot":"endImage","origin":"upload","key":"upload-end"}]}';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',changed);
 ELSE result := private.submit_free_job_for_admission(u,key,'model',changed); END IF;
 IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'legacy cross-origin order replay %',result; END IF;
 FOR changed IN SELECT jsonb_set(changed,'{references,1,key}','"replacement"')
 UNION ALL SELECT jsonb_set(changed,'{references}',(changed->'references') || jsonb_build_array(changed->'references'->0))
 UNION ALL SELECT jsonb_set(changed,'{references,0,slot}','"endImage"') LOOP
  IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','model',changed);
  ELSE result := private.submit_free_job_for_admission(u,key,'model',changed); END IF;
  IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'legacy multiset changed %',result; END IF;
 END LOOP;
 -- Clip Editor's resolved edit is deterministic; identity still binds changed cuts.
 key := mode || '-edit';
 inputs := '{"edit":{"clips":[{"key":"jobs/clip.mp4","in_s":2,"out_s":8.5,"whole":false,"aspect":"0.56"}],"audio":null,"captions":null,"output_s":6.5}}';
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','clip-edit',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'clip-edit',inputs); END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'edit admission %',result; END IF;
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','clip-edit',inputs);
 ELSE result := private.submit_free_job_for_admission(u,key,'clip-edit',inputs); END IF;
 IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'edit replay %',result; END IF;
 changed := jsonb_set(inputs,'{edit,clips,0,in_s}','3');
 IF mode = 'paid' THEN result := private.ledger_debit_for_admission(u,key,5,'debit:generation','clip-edit',changed);
 ELSE result := private.submit_free_job_for_admission(u,key,'clip-edit',changed); END IF;
 IF result->>'code' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed edit replay %',result; END IF;
END LOOP;
IF (SELECT count(*) FROM jobs) <> 9 OR (SELECT count(*) FROM ledger_entries) <> 5 OR (SELECT balance FROM credit_balances WHERE user_id=u) <> 75 THEN RAISE EXCEPTION 'legacy/edit replay changed money'; END IF;
RAISE NOTICE 'multi-reference-admission-passed';
END $$;`;
    const namespace = sql => sql.replace(/\b(?:public|private)\./g, `${schema}.`);
    await client.query(namespace(setup));
    await client.query(namespace(migration));
    const notices = [];
    client.on('notice', notice => notices.push(notice.message));
    await client.query(namespace(assertions));
    assert.ok(notices.includes('multi-reference-admission-passed'));
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
