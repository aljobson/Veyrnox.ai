import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const url = process.env.EDITOR_MANUAL_COMMIT_TEST_DATABASE_URL;
const migration = await readFile(new URL('../packages/db/schema/supabase/0623_editor_manual_commit_credits.sql', import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const otherActor = '99999999-9999-4999-8999-999999999999';
const otherUser = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project = '33333333-3333-4333-8333-333333333333';
const projectTwo = '44444444-4444-4444-8444-444444444444';
const projectConcurrent = '55555555-5555-4555-8555-555555555555';
const projectUnion = '66666666-6666-4666-8666-666666666666';
const projectNull = '77777777-7777-4777-8777-777777777777';
const projectStatus = '88888888-8888-4888-8888-888888888888';
const projectCrossRoute = '12121212-1212-4212-8212-121212121212';
const projectOverlap = '13131313-1313-4313-8313-131313131313';
const projectSwept = '14141414-1414-4414-8414-141414141414';
const projectMfa = '15151515-1515-4515-8515-151515151515';

async function psql(sql) {
  const { stdout } = await run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
const doc = (ids, fail = false) => JSON.stringify({ schema_version: 3, fail, timeline: {
  media: Object.fromEntries(ids.map(id => [id, { id, kind: 'video' }])),
  video: ids.map((id, index) => ({ id: `clip-${index}`, mediaId: id })), audio: [],
} }).replaceAll("'", "''");
const saveSql = (target, expected, content, key, credits) => `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.save_paid_project_document('${target}',${expected},'${content}'::jsonb,'${key}',${credits}); COMMIT;`;
const beginSql = (target, key) => `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.begin_manual_editor_delivery('${target}','${key}'); COMMIT;`;
const finalizeSql = (target, key) => `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.begin_manual_editor_delivery('${target}','${key}'); SELECT public.finalize_manual_editor_commit('${target}','${key}'); COMMIT;`;
const cancelSql = (target, key) => `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.cancel_manual_editor_commit('${target}','${key}'); COMMIT;`;

test('manual editor debit migration is atomic, idempotent and invisible', { skip: !url }, async t => {
  assert.match(url, /(?:localhost|127\.0\.0\.1|\/tmp)/, 'use a disposable local Postgres database');
  await psql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE TABLE auth.mfa_factors(user_id uuid NOT NULL,factor_type text NOT NULL,status text NOT NULL);
    GRANT USAGE ON SCHEMA private TO authenticated;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.users(id uuid PRIMARY KEY,auth_id text UNIQUE NOT NULL,frozen_at timestamptz,hold_until timestamptz);
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id));
    CREATE TABLE public.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),idempotency_key text NOT NULL,
      credits integer NOT NULL,reason text,model_id text,inputs jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'DEBITED',provider text,
      provider_job_id text,error_code text,free_allowance boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,idempotency_key));
    CREATE TABLE public.crun_dispatch(job_id uuid PRIMARY KEY REFERENCES public.jobs(id),state text);
    CREATE TABLE public.provider_spend_reservations(user_id uuid,effect_key text);
    CREATE TABLE public.assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES public.jobs(id));
    CREATE TABLE public.project_document_versions(project_id uuid NOT NULL REFERENCES public.projects(id),revision integer NOT NULL,actor_id uuid NOT NULL,
      request_key text NOT NULL,expected_revision integer NOT NULL,document jsonb NOT NULL,restored_from integer,created_at timestamptz DEFAULT now(),
      PRIMARY KEY(project_id,revision),UNIQUE(project_id,actor_id,request_key));
    CREATE OR REPLACE FUNCTION private.reject_project_document_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'PROJECT_DOCUMENT_VERSION_IMMUTABLE'; END $$;
    CREATE TRIGGER project_document_versions_immutable BEFORE UPDATE OR DELETE ON public.project_document_versions
      FOR EACH ROW EXECUTE FUNCTION private.reject_project_document_version_mutation();
    CREATE TABLE public.credit_balances(user_id uuid PRIMARY KEY REFERENCES public.users(id),balance integer NOT NULL,free_balance integer NOT NULL,
      subscription_balance integer NOT NULL DEFAULT 0,subscription_expires_at timestamptz,subscription_cycle integer NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.ledger_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),delta integer NOT NULL,
      free_delta integer NOT NULL,subscription_delta integer NOT NULL,subscription_cycle integer,reason text NOT NULL,job_id uuid NOT NULL REFERENCES public.jobs(id));
    CREATE OR REPLACE FUNCTION public.ledger_refund(p_job uuid,p_user uuid,p_credits integer,p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE current_state text; entry uuid; BEGIN
      SELECT state INTO current_state FROM public.jobs WHERE id=p_job AND user_id=p_user FOR UPDATE;
      IF current_state='REFUNDED' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
      IF current_state<>'DEBITED' THEN RETURN jsonb_build_object('ok',false,'code','JOB_SUCCEEDED'); END IF;
      INSERT INTO public.ledger_entries(user_id,delta,free_delta,subscription_delta,reason,job_id)
        VALUES(p_user,p_credits,p_credits,0,p_reason,p_job) RETURNING id INTO entry;
      UPDATE public.credit_balances SET balance=balance+p_credits,free_balance=free_balance+p_credits WHERE user_id=p_user;
      UPDATE public.jobs SET state='REFUNDED',updated_at=now() WHERE id=p_job;
      RETURN jsonb_build_object('ok',true,'idempotent',false,'entry_id',entry); END $$;
    CREATE OR REPLACE FUNCTION public.delete_user_job(p_auth text,p_job uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
      UPDATE public.jobs j SET inputs='{}'::jsonb,deleted_at=now(),updated_at=now()
       FROM public.users u WHERE j.id=p_job AND j.user_id=u.id AND u.auth_id=p_auth AND j.state IN ('STORED','FAILED','REFUNDED');
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
      RETURN jsonb_build_object('ok',true,'replayed',false); END $$;
    CREATE TABLE public.ai_limit_policy(singleton boolean PRIMARY KEY DEFAULT true,gen_limit_per_window integer);
    CREATE TABLE public.user_ai_controls(user_id uuid PRIMARY KEY REFERENCES public.users(id),ai_disabled boolean NOT NULL DEFAULT false,gen_limit_per_window integer);
    CREATE TABLE public.generation_attempt_rate_limits(user_id uuid PRIMARY KEY REFERENCES public.users(id),window_started_at timestamptz NOT NULL,request_count integer NOT NULL);
    CREATE OR REPLACE FUNCTION private.project_role(p_project uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT CASE WHEN EXISTS(SELECT 1 FROM public.projects p JOIN public.users u ON u.id=p.user_id
        WHERE p.id=p_project AND u.auth_id=auth.uid()::text) THEN 'OWNER' END $$;
    CREATE OR REPLACE FUNCTION private.project_document_within_bounds(p_content jsonb,p_project uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT jsonb_typeof(p_content)='object' AND jsonb_typeof(p_content->'timeline')='object'
        AND (NOT (p_content ? 'project_id') OR p_content->>'project_id'=p_project::text) $$;
    CREATE OR REPLACE FUNCTION private.enforce_user_inflight_on_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE OR REPLACE FUNCTION private.enforce_provider_spend_on_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE OR REPLACE FUNCTION private.fal_admission_paused(text,boolean) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION private.generation_request_matches(jsonb,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
    CREATE OR REPLACE FUNCTION private.save_project_document(p_project uuid,p_expected integer,p_content jsonb,p_key text,p_unused jsonb)
    RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE current_revision integer; next_revision integer; existing public.project_document_versions; BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,34));
      PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
      SELECT * INTO existing FROM public.project_document_versions WHERE project_id=p_project AND actor_id=auth.uid() AND request_key=p_key;
      IF FOUND THEN
        IF existing.expected_revision<>p_expected OR existing.document IS DISTINCT FROM p_content THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
        RETURN jsonb_build_object('ok',true,'revision',existing.revision,'idempotent',true);
      END IF;
      SELECT coalesce(max(revision),0) INTO current_revision FROM public.project_document_versions WHERE project_id=p_project;
      IF current_revision<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
      IF coalesce((p_content->>'fail')::boolean,false) THEN RAISE EXCEPTION 'SAVE_FAILED'; END IF;
      next_revision:=current_revision+1;
      INSERT INTO public.project_document_versions(project_id,revision,actor_id,request_key,expected_revision,document)
        VALUES(p_project,next_revision,auth.uid(),p_key,p_expected,p_content);
      RETURN jsonb_build_object('ok',true,'revision',next_revision,'idempotent',false); END $$;
  `);
  await psql(migration);
  await psql(`CREATE OR REPLACE FUNCTION public.ledger_debit(p_user uuid,p_key text,p_credits integer,p_reason text,p_model text,p_inputs jsonb,p_a integer,p_b integer)
    RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
      IF p_inputs->>'project_id'='${projectCrossRoute}' THEN PERFORM pg_sleep(0.4); END IF;
      RETURN private.ledger_debit_for_admission(p_user,p_key,p_credits,p_reason,p_model,p_inputs,p_a,p_b,false); END $$;`);
  await psql(migration);
  await psql(`INSERT INTO public.users(id,auth_id) VALUES('${user}','${actor}'),('${otherUser}','${otherActor}');
    INSERT INTO public.projects(id,user_id) VALUES('${project}','${user}'),('${projectTwo}','${user}'),('${projectConcurrent}','${user}'),
      ('${projectUnion}','${user}'),('${projectNull}','${user}'),('${projectStatus}','${user}'),('${projectCrossRoute}','${user}'),
      ('${projectOverlap}','${user}'),('${projectSwept}','${user}'),('${projectMfa}','${user}');
    INSERT INTO public.credit_balances(user_id,balance,free_balance,subscription_balance,subscription_expires_at,subscription_cycle)
      VALUES('${user}',20,20,0,now()+interval '1 month',1);`);

  await t.test('feature is fail-closed until the disposable database explicitly enables it', async () => {
    const quote = `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${project}','${doc(['camera-a'])}'::jsonb); COMMIT;`;
    const status = `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${project}','disabled-status'); COMMIT;`;
    await assert.rejects(psql(quote), /FEATURE_DISABLED/);
    await assert.rejects(psql(saveSql(project, 0, doc(['camera-a']), 'disabled-save', 5)), /FEATURE_DISABLED/);
    await assert.rejects(psql(status), /FEATURE_DISABLED/);
    await assert.rejects(psql(finalizeSql(project, 'disabled-save')), /FEATURE_DISABLED/);
    await assert.rejects(psql(cancelSql(project, 'disabled-save')), /FEATURE_DISABLED/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.project_document_versions)||'|'||
      (SELECT count(*) FROM public.jobs)||'|'||(SELECT count(*) FROM public.editor_manual_commit_receipts)
      FROM public.credit_balances WHERE user_id='${user}';`), '20|0|0|0');
  });
  await psql(`UPDATE public.editor_manual_commit_config SET enabled=true,updated_at=now() WHERE singleton;`);

  await t.test('an enrolled account cannot bypass AAL2 through the granted PostgREST functions', async () => {
    await psql(`INSERT INTO auth.mfa_factors(user_id,factor_type,status) VALUES('${actor}','totp','verified');`);
    await assert.rejects(psql(saveSql(projectMfa, 0, doc(['mfa-source']), 'mfa-save-key', 5)), /MFA_REQUIRED/);
    await assert.rejects(psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${projectMfa}','mfa-save-key'); COMMIT;`), /MFA_REQUIRED/);
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT set_config('request.jwt.claims','{"aal":"aal2"}',true);
      SELECT public.save_paid_project_document('${projectMfa}',0,'${doc(['mfa-source'])}'::jsonb,'mfa-save-key',5); COMMIT;`), /"pending": true/);
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT set_config('request.jwt.claims','{"aal":"aal2"}',true);
      SELECT public.cancel_manual_editor_commit('${projectMfa}','mfa-save-key'); COMMIT;`), /"canceled": true/);
    await psql(`DELETE FROM auth.mfa_factors WHERE user_id='${actor}';`);
  });

  await t.test('authenticated grants work and non-members remain hidden', async () => {
    assert.equal(await psql(`SELECT has_function_privilege('authenticated','public.save_paid_project_document(uuid,integer,jsonb,text,integer)','EXECUTE')||'|'||
      has_function_privilege('anon','public.save_paid_project_document(uuid,integer,jsonb,text,integer)','EXECUTE');`), 'true|false');
    assert.match(await psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${project}','${doc(['member-source'])}'::jsonb); COMMIT;`), /"credits": 5/);
    await assert.rejects(psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${otherActor}',true);
      SELECT public.quote_manual_editor_commit('${project}','${doc(['member-source'])}'::jsonb); COMMIT;`), /NOT_FOUND/);
    await assert.rejects(psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${project}','[]'::jsonb); COMMIT;`), /INVALID_DOCUMENT/);
  });

  await t.test('Save then Export charges once and hides the accounting job', async () => {
    assert.match(await psql(saveSql(project, 0, doc(['camera-a']), 'save-key-1', 5)), /"credits": 5/);
    const replay = await psql(saveSql(project, 0, doc(['camera-a']), 'save-key-1', 5));
    assert.match(replay, /"credits": 5/);
    assert.match(replay, /"idempotent": true/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.project_document_versions WHERE project_id='${project}')||'|'||
      (SELECT count(*) FROM public.jobs WHERE inputs->>'project_id'='${project}') FROM public.credit_balances WHERE user_id='${user}';`), '15|1|1');
    assert.match(await psql(finalizeSql(project, 'save-key-1')), /"committed": true/);
    const quote = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.quote_manual_editor_commit('${project}','${doc(['camera-a'])}'::jsonb); COMMIT;`);
    assert.match(quote, /"credits": 0/);
    assert.match(await psql(saveSql(project, 1, doc(['camera-a']), 'export-1', 0)), /"credits": 0/);
    assert.match(await psql(finalizeSql(project, 'export-1')), /"committed": true/);
    assert.equal(await psql(`SELECT b.balance||'|'||
      (SELECT count(*) FROM public.editor_manual_commit_receipts r WHERE r.project_id='${project}')||'|'||
      (SELECT count(*) FROM public.jobs j JOIN public.editor_manual_commit_operations o ON o.job_id=j.id
        WHERE o.project_id='${project}' AND j.deleted_at IS NULL)||'|'||
      (SELECT bool_and(j.provider='local' AND j.state='STORED') FROM public.jobs j
        JOIN public.editor_manual_commit_operations o ON o.job_id=j.id WHERE o.project_id='${project}')
      FROM public.credit_balances b WHERE b.user_id='${user}';`), '15|1|0|true');
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${project}','save-key-1'); COMMIT;`), /"committed": true.*"revision": 1|"revision": 1.*"committed": true/);
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${project}','missing-key'); COMMIT;`), /"committed": false/);
  });

  await t.test('version conflict rolls back debit, job and receipt', async () => {
    await assert.rejects(psql(saveSql(project, 0, doc(['camera-a','camera-b']), 'conflict-1', 5)), /VERSION_CONFLICT/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.jobs j JOIN public.editor_manual_commit_operations o ON o.job_id=j.id
      WHERE o.project_id='${project}')||'|'||
      (SELECT count(*) FROM public.editor_manual_commit_receipts WHERE project_id='${project}')
      FROM public.credit_balances WHERE user_id='${user}';`), '15|1|1');
  });

  await t.test('insufficient balance writes nothing', async () => {
    await psql(`UPDATE public.credit_balances SET balance=0,free_balance=0 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectTwo, 0, doc(['camera-z']), 'insufficient-1', 5)), /INSUFFICIENT_BALANCE/);
    assert.equal(await psql(`SELECT (SELECT count(*) FROM public.project_document_versions WHERE project_id='${projectTwo}')||'|'||
      (SELECT count(*) FROM public.editor_manual_commit_receipts WHERE project_id='${projectTwo}')||'|'||
      (SELECT count(*) FROM public.jobs WHERE inputs->>'project_id'='${projectTwo}');`), '0|0|0');
  });

  await t.test('acknowledged delivery settles immediately and cannot be canceled or swept', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectTwo, 0, doc(['camera-lease']), 'delivery-lease', 5)), /"pending": true/);
    assert.match(await psql(beginSql(projectTwo, 'delivery-lease')), /"authorized": true/);
    const settledAt = await psql(`SELECT updated_at::text FROM public.editor_manual_commit_operations WHERE project_id='${projectTwo}';`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(await psql(beginSql(projectTwo, 'delivery-lease')), /"authorized": true/);
    assert.equal(await psql(`SELECT updated_at::text FROM public.editor_manual_commit_operations WHERE project_id='${projectTwo}';`), settledAt);
    assert.match(await psql(cancelSql(projectTwo, 'delivery-lease')), /ALREADY_COMMITTED/);
    await psql(`UPDATE public.jobs j SET updated_at=now()-interval '2 days' FROM public.editor_manual_commit_operations o
      WHERE o.job_id=j.id AND o.project_id='${projectTwo}';`);
    assert.match(await psql(`SELECT public.sweep_stuck_jobs(0,0,200,0);`), /"refunded": 0/);
    assert.equal(await psql(`SELECT j.state||'|'||o.state||'|'||(j.deleted_at IS NOT NULL) FROM public.jobs j
      JOIN public.editor_manual_commit_operations o ON o.job_id=j.id WHERE o.project_id='${projectTwo}';`), 'STORED|COMMITTED|true');
    assert.equal(await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`), '15');
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.finalize_manual_editor_commit('${projectTwo}','delivery-lease'); COMMIT;`), /"committed": true/);
  });

  await t.test('concurrent same-source commits never double-debit', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    await Promise.allSettled([
      psql(saveSql(projectConcurrent, 0, doc(['camera-concurrent']), 'concurrent-a', 5)),
      psql(saveSql(projectConcurrent, 0, doc(['camera-concurrent']), 'concurrent-b', 5)),
    ]);
    await Promise.allSettled([psql(finalizeSql(projectConcurrent, 'concurrent-a')), psql(finalizeSql(projectConcurrent, 'concurrent-b'))]);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.editor_manual_commit_receipts WHERE project_id='${projectConcurrent}')
      FROM public.credit_balances WHERE user_id='${user}';`), '15|1');
  });

  await t.test('an overlapping source set cannot reserve before the first delivery establishes coverage', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectOverlap, 0, doc(['camera-a','camera-b']), 'overlap-ab', 5)), /"pending": true/);
    assert.match(await psql(saveSql(projectOverlap, 1, doc(['camera-a']), 'overlap-a', 5)), /COMMIT_PENDING/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.jobs WHERE inputs->>'project_id'='${projectOverlap}')||'|'||
      (SELECT count(*) FROM public.project_document_versions WHERE project_id='${projectOverlap}') FROM public.credit_balances WHERE user_id='${user}';`), '15|1|1');
    await psql(finalizeSql(projectOverlap, 'overlap-ab'));
    assert.match(await psql(saveSql(projectOverlap, 1, doc(['camera-a']), 'overlap-a-covered', 0)), /"credits": 0/);
    assert.equal(await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`), '15');
  });

  await t.test('a swept refund releases the project reservation for a fresh key', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectSwept, 0, doc(['camera-retry']), 'swept-old', 5)), /"pending": true/);
    await psql(`UPDATE public.jobs SET state='REFUNDED',updated_at=now() WHERE inputs->>'project_id'='${projectSwept}';
      UPDATE public.credit_balances SET balance=balance+5,free_balance=free_balance+5 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectSwept, 1, doc(['camera-retry']), 'swept-new', 5)), /"pending": true/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.editor_manual_commit_operations WHERE project_id='${projectSwept}' AND state='REFUNDED')||'|'||
      (SELECT count(*) FROM public.editor_manual_commit_operations WHERE project_id='${projectSwept}' AND state='PENDING') FROM public.credit_balances WHERE user_id='${user}';`), '15|1|1');
  });

  await t.test('paid and free routes serialize the same request key before debit', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    const paid = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      saveSql(projectCrossRoute, 0, doc(['cross-route']), 'cross-route-key', 5)]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const free = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT private.save_project_document('${projectCrossRoute}',0,'${doc(['cross-route'])}'::jsonb,'cross-route-key',NULL::jsonb); COMMIT;`]);
    const [paidResult, freeResult] = await Promise.all([paid, free]);
    assert.match(paidResult.stdout, /"idempotent": false/);
    assert.match(freeResult.stdout, /"idempotent": true/);
    assert.equal(await psql(`SELECT b.balance||'|'||o.credits||'|'||(SELECT count(*) FROM public.jobs WHERE inputs->>'project_id'='${projectCrossRoute}')
      FROM public.credit_balances b CROSS JOIN public.editor_manual_commit_operations o
      WHERE b.user_id='${user}' AND o.project_id='${projectCrossRoute}';`), '15|5|1');
  });

  await t.test('all referenced local media are chargeable despite client-controlled metadata', async () => {
    const builtIn = JSON.stringify({ schema_version: 3, timeline: {
      media: {
        'l-pack': { id: 'l-pack', attribution: { credit: 'catalog' } },
        'l-preset': { id: 'l-preset', originalAudio: { version: 1, presetId: 'preset' } },
        'l-mask': { id: 'l-mask' },
      },
      video: [{ id: 'pack', mediaId: 'l-pack', semanticMask: { mediaId: 'l-mask' } }],
      audio: [{ id: 'preset', mediaId: 'l-preset' }],
    } }).replaceAll("'", "''");
    const quote = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${projectUnion}','${builtIn}'::jsonb); COMMIT;`);
    assert.match(quote, /"credits": 5/);
  });

  await t.test('receipts cover the union of previously paid imported source sets', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectUnion, 0, doc(['camera-a']), 'union-a1', 5)), /"credits": 5/);
    await psql(finalizeSql(projectUnion, 'union-a1'));
    assert.match(await psql(saveSql(projectUnion, 1, doc(['camera-b']), 'union-b1', 5)), /"credits": 5/);
    await psql(finalizeSql(projectUnion, 'union-b1'));
    const quote = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${projectUnion}','${doc(['camera-a','camera-b'])}'::jsonb); COMMIT;`);
    assert.match(quote, /"credits": 0/);
  });

  await t.test('NULL price confirmation is rejected without a debit', async () => {
    const before = await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectNull, 0, doc(['camera-null']), 'null-price', 'NULL')), /PRICE_CHANGED/);
    assert.equal(await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`), before);
  });

  await t.test('exact-key status is read-only during an in-flight reservation and sees it after commit', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    const committing = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.save_paid_project_document('${projectStatus}',0,'${doc(['status-source'])}'::jsonb,'status-commit-key',5); SELECT pg_sleep(0.4); COMMIT;`]);
    await new Promise(resolve => setTimeout(resolve, 80));
    const started = Date.now();
    const status = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.manual_editor_commit_status('${projectStatus}','status-commit-key'); COMMIT;`);
    assert.ok(Date.now() - started < 250, 'status must not lock or wait behind the paid transaction');
    assert.match(status, /"pending": false/);
    await committing;
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.manual_editor_commit_status('${projectStatus}','status-commit-key'); COMMIT;`), /"pending": true/);
  });

  await t.test('failed delivery refunds a reservation and prevents later finalization', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectNull, 0, doc(['camera-refund']), 'refund-key', 5)), /"pending": true/);
    assert.match(await psql(cancelSql(projectNull, 'refund-key')), /"canceled": true/);
    assert.equal(await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`), '20');
    assert.match(await psql(finalizeSql(projectNull, 'refund-key')), /COMMIT_CANCELED/);
  });

  await t.test('exact-key status does not wait behind an unrelated rollback', async () => {
    const rollingBack = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT pg_advisory_xact_lock(hashtextextended('${actor}',34)); SELECT pg_sleep(0.4); ROLLBACK;`]);
    await new Promise(resolve => setTimeout(resolve, 80));
    const started = Date.now();
    const status = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.manual_editor_commit_status('${projectStatus}','status-rollback-key'); COMMIT;`);
    assert.ok(Date.now() - started < 250, 'status must remain a read-only observation');
    assert.match(status, /"committed": false/);
    await rollingBack;
  });

  await t.test('hidden manual accounting rows do not consume a generation rate-limit slot', async () => {
    assert.match(await psql(`SELECT public.check_generation_rate_limit('${actor}',1,60);`), /"ok": true/);
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    const debit = await psql(`SELECT private.ledger_debit_for_admission('${user}','generation-after-manual',1,'debit:generation','test-model','{}',1,60,false);`);
    assert.match(debit, /"ok": true/);
    await psql(`UPDATE public.jobs SET deleted_at=now() WHERE idempotency_key='generation-after-manual';`);
    const limited = await psql(`SELECT private.ledger_debit_for_admission('${user}','generation-after-deleted-generation',1,'debit:generation','test-model','{}',1,60,false);`);
    assert.match(limited, /RATE_LIMITED/);
  });
});
