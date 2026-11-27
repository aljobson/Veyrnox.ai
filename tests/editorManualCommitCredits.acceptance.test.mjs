import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const url = process.env.EDITOR_MANUAL_COMMIT_TEST_DATABASE_URL;
const migration = await readFile(new URL('../packages/db/schema/supabase/0622_editor_manual_commit_credits.sql', import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const projectTwo = '44444444-4444-4444-8444-444444444444';
const projectConcurrent = '55555555-5555-4555-8555-555555555555';
const projectUnion = '66666666-6666-4666-8666-666666666666';
const projectNull = '77777777-7777-4777-8777-777777777777';
const projectStatus = '88888888-8888-4888-8888-888888888888';

async function psql(sql) {
  const { stdout } = await run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
const doc = (ids, fail = false) => JSON.stringify({ schema_version: 3, fail, timeline: {
  media: Object.fromEntries(ids.map(id => [id, { id, kind: 'video' }])),
  video: ids.map((id, index) => ({ id: `clip-${index}`, mediaId: id })), audio: [],
} }).replaceAll("'", "''");
const saveSql = (target, expected, content, key, credits) => `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.save_paid_project_document('${target}',${expected},'${content}'::jsonb,'${key}',${credits}); COMMIT;`;

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
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.users(id uuid PRIMARY KEY,auth_id text UNIQUE NOT NULL,frozen_at timestamptz,hold_until timestamptz);
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id));
    CREATE TABLE public.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),idempotency_key text NOT NULL,
      credits integer NOT NULL,reason text,model_id text,inputs jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'DEBITED',provider text,
      deleted_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,idempotency_key));
    CREATE TABLE public.project_document_versions(project_id uuid NOT NULL REFERENCES public.projects(id),revision integer NOT NULL,actor_id uuid NOT NULL,
      request_key text NOT NULL,expected_revision integer NOT NULL,document jsonb NOT NULL,restored_from integer,created_at timestamptz DEFAULT now(),
      PRIMARY KEY(project_id,revision),UNIQUE(project_id,actor_id,request_key));
    CREATE TABLE public.credit_balances(user_id uuid PRIMARY KEY REFERENCES public.users(id),balance integer NOT NULL,free_balance integer NOT NULL,
      subscription_balance integer NOT NULL DEFAULT 0,subscription_expires_at timestamptz,subscription_cycle integer NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.ledger_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),delta integer NOT NULL,
      free_delta integer NOT NULL,subscription_delta integer NOT NULL,subscription_cycle integer,reason text NOT NULL,job_id uuid NOT NULL REFERENCES public.jobs(id));
    CREATE OR REPLACE FUNCTION private.project_role(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'OWNER' $$;
    CREATE OR REPLACE FUNCTION private.project_document_within_bounds(jsonb,uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
    CREATE OR REPLACE FUNCTION private.enforce_user_inflight_on_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE OR REPLACE FUNCTION private.enforce_provider_spend_on_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE OR REPLACE FUNCTION private.fal_admission_paused(text,boolean) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION private.generation_request_matches(jsonb,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
    CREATE OR REPLACE FUNCTION private.save_project_document(p_project uuid,p_expected integer,p_content jsonb,p_key text,p_unused jsonb)
    RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE current_revision integer; next_revision integer; existing public.project_document_versions; BEGIN
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
      RETURN jsonb_build_object('ok',true,'revision',next_revision); END $$;
  `);
  await psql(migration);
  await psql(`CREATE OR REPLACE FUNCTION public.ledger_debit(p_user uuid,p_key text,p_credits integer,p_reason text,p_model text,p_inputs jsonb,p_a integer,p_b integer)
    RETURNS jsonb LANGUAGE sql AS $$ SELECT private.ledger_debit_for_admission(p_user,p_key,p_credits,p_reason,p_model,p_inputs,p_a,p_b,false) $$;`);
  await psql(`INSERT INTO public.users(id,auth_id) VALUES('${user}','${actor}');
    INSERT INTO public.projects(id,user_id) VALUES('${project}','${user}'),('${projectTwo}','${user}'),('${projectConcurrent}','${user}'),
      ('${projectUnion}','${user}'),('${projectNull}','${user}'),('${projectStatus}','${user}');
    INSERT INTO public.credit_balances(user_id,balance,free_balance,subscription_balance,subscription_expires_at,subscription_cycle)
      VALUES('${user}',20,20,0,now()+interval '1 month',1);`);

  await t.test('Save then Export charges once and hides the accounting job', async () => {
    assert.match(await psql(saveSql(project, 0, doc(['camera-a']), 'save-key-1', 5)), /"credits": 5/);
    const quote = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.quote_manual_editor_commit('${project}','${doc(['camera-a'])}'::jsonb); COMMIT;`);
    assert.match(quote, /"credits": 0/);
    assert.match(await psql(saveSql(project, 1, doc(['camera-a']), 'export-1', 0)), /"credits": 0/);
    assert.equal(await psql(`SELECT b.balance||'|'||count(r.*)||'|'||count(j.*) FILTER(WHERE j.deleted_at IS NULL)||'|'||bool_and(j.provider='local' AND j.state='STORED')
      FROM public.credit_balances b LEFT JOIN public.editor_manual_commit_receipts r ON r.user_id=b.user_id
      LEFT JOIN public.jobs j ON j.user_id=b.user_id WHERE b.user_id='${user}' GROUP BY b.balance;`), '15|1|0|true');
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${project}','save-key-1'); COMMIT;`), /"committed": true.*"revision": 1|"revision": 1.*"committed": true/);
    assert.match(await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.manual_editor_commit_status('${project}','missing-key'); COMMIT;`), /"committed": false/);
  });

  await t.test('version conflict rolls back debit, job and receipt', async () => {
    await assert.rejects(psql(saveSql(project, 0, doc(['camera-a','camera-b']), 'conflict-1', 5)), /VERSION_CONFLICT/);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.jobs)||'|'||(SELECT count(*) FROM public.editor_manual_commit_receipts)
      FROM public.credit_balances WHERE user_id='${user}';`), '15|1|1');
  });

  await t.test('insufficient balance writes nothing', async () => {
    await psql(`UPDATE public.credit_balances SET balance=0,free_balance=0 WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectTwo, 0, doc(['camera-z']), 'insufficient-1', 5)), /INSUFFICIENT_BALANCE/);
    assert.equal(await psql(`SELECT (SELECT count(*) FROM public.project_document_versions WHERE project_id='${projectTwo}')||'|'||
      (SELECT count(*) FROM public.editor_manual_commit_receipts WHERE project_id='${projectTwo}')||'|'||
      (SELECT count(*) FROM public.jobs WHERE inputs->>'project_id'='${projectTwo}');`), '0|0|0');
  });

  await t.test('concurrent same-source commits never double-debit', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    await Promise.allSettled([
      psql(saveSql(projectConcurrent, 0, doc(['camera-concurrent']), 'concurrent-a', 5)),
      psql(saveSql(projectConcurrent, 0, doc(['camera-concurrent']), 'concurrent-b', 5)),
    ]);
    assert.equal(await psql(`SELECT balance||'|'||(SELECT count(*) FROM public.editor_manual_commit_receipts WHERE project_id='${projectConcurrent}')
      FROM public.credit_balances WHERE user_id='${user}';`), '15|1');
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
    assert.match(await psql(saveSql(projectUnion, 0, doc(['camera-a']), 'union-a', 5)), /"credits": 5/);
    assert.match(await psql(saveSql(projectUnion, 1, doc(['camera-b']), 'union-b', 5)), /"credits": 5/);
    const quote = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true);
      SELECT public.quote_manual_editor_commit('${projectUnion}','${doc(['camera-a','camera-b'])}'::jsonb); COMMIT;`);
    assert.match(quote, /"credits": 0/);
  });

  await t.test('NULL price confirmation is rejected without a debit', async () => {
    const before = await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`);
    assert.match(await psql(saveSql(projectNull, 0, doc(['camera-null']), 'null-price', 'NULL')), /PRICE_CHANGED/);
    assert.equal(await psql(`SELECT balance FROM public.credit_balances WHERE user_id='${user}';`), before);
  });

  await t.test('exact-key status waits behind an in-flight commit and returns true', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    const committing = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.save_paid_project_document('${projectStatus}',0,'${doc(['status-source'])}'::jsonb,'status-commit-key',5); SELECT pg_sleep(0.4); COMMIT;`]);
    await new Promise(resolve => setTimeout(resolve, 80));
    const started = Date.now();
    const status = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.manual_editor_commit_status('${projectStatus}','status-commit-key'); COMMIT;`);
    assert.ok(Date.now() - started >= 250, 'status must wait for the paid transaction lock');
    assert.match(status, /"committed": true/);
    await committing;
  });

  await t.test('exact-key status waits behind rollback and returns false', async () => {
    const rollingBack = run('psql', [url, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
      `BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT pg_advisory_xact_lock(hashtextextended('${actor}:${projectStatus}',621)); SELECT pg_sleep(0.4); ROLLBACK;`]);
    await new Promise(resolve => setTimeout(resolve, 80));
    const started = Date.now();
    const status = await psql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.manual_editor_commit_status('${projectStatus}','status-rollback-key'); COMMIT;`);
    assert.ok(Date.now() - started >= 250, 'status must wait for rollback of the paid transaction lock');
    assert.match(status, /"committed": false/);
    await rollingBack;
  });

  await t.test('hidden manual accounting rows do not consume a generation rate-limit slot', async () => {
    await psql(`UPDATE public.credit_balances SET balance=20,free_balance=20 WHERE user_id='${user}';`);
    const debit = await psql(`SELECT private.ledger_debit_for_admission('${user}','generation-after-manual',1,'debit:generation','test-model','{}',1,60,false);`);
    assert.match(debit, /"ok": true/);
    await psql(`UPDATE public.jobs SET deleted_at=now() WHERE idempotency_key='generation-after-manual';`);
    const limited = await psql(`SELECT private.ledger_debit_for_admission('${user}','generation-after-deleted-generation',1,'debit:generation','test-model','{}',1,60,false);`);
    assert.match(limited, /RATE_LIMITED/);
  });
});
