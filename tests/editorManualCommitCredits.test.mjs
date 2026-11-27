import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../packages/db/schema/supabase/0622_editor_manual_commit_credits.sql', import.meta.url), 'utf8');
const privilegeGuard = await readFile(new URL('../scripts/test-default-privileges.mjs', import.meta.url), 'utf8');
const accountDeletionGuard = await readFile(new URL('../scripts/test-account-deletion.mjs', import.meta.url), 'utf8');
const privacyExportGuard = await readFile(new URL('../scripts/test-privacy-export.mjs', import.meta.url), 'utf8');

test('manual editor Save and Export share one server-derived five-credit receipt', () => {
  assert.match(sql, /credits integer NOT NULL CHECK \(credits = 5\)/);
  assert.match(sql, /private\.editor_manual_source_hashes\(p_content\)/);
  assert.match(sql, /jsonb_array_elements_text\(r\.source_hashes\) paid_source/g);
  assert.match(sql, /jsonb_build_object\('source_id',r\.source_id,'media',m\.media\)::text/);
  assert.match(sql, /editor_manual_commit_project_idx[\s\S]*ON public\.editor_manual_commit_receipts\(project_id\)/);
  assert.match(sql, /JOIN jsonb_each\(coalesce\(content#>'\{timeline,media\}'/);
  assert.doesNotMatch(sql, /m\.media\?'(?:originalAudio|graphic)'/);
  assert.match(sql, /public\.ledger_debit\(v_user_id,charge_key,5,'debit:editor_manual_commit','editor-manual-commit'/);
  assert.match(sql, /UNIQUE\(user_id, project_id, source_fingerprint\)/);
  assert.match(sql, /jsonb_array_length\(sources\)=0 OR covered THEN 0 ELSE 5/);
});

test('manual editor reserves atomically before delivery and bypasses supplier-only admission', () => {
  const debit = sql.indexOf('debit:=public.ledger_debit');
  const save = sql.indexOf('saved:=private.save_project_document', debit);
  const reservation = sql.indexOf('INSERT INTO public.editor_manual_commit_operations', save);
  const finalize = sql.indexOf('CREATE OR REPLACE FUNCTION private.finalize_manual_editor_commit');
  const receipt = sql.indexOf('INSERT INTO public.editor_manual_commit_receipts', finalize);
  assert.ok(debit > 0 && save > debit && reservation > save && finalize > reservation && receipt > finalize);
  assert.match(sql, /WHEN \(NEW\.model_id<>'editor-manual-commit'\).*enforce_user_inflight_on_job/s);
  assert.match(sql, /WHEN \(NEW\.model_id<>'editor-manual-commit'\).*enforce_provider_spend_on_job/s);
  assert.match(sql, /user_id=p_user_id AND model_id<>'editor-manual-commit'/);
  assert.match(sql, /p_expected_credits IS NULL OR p_expected_credits NOT IN \(0,5\)/);
  assert.match(sql, /public\.ledger_refund\(op\.job_id,op\.user_id,op\.credits,'refund:editor_manual_delivery_failed'\)/);
  assert.match(sql, /editor_manual_commit_one_pending_project_idx[\s\S]*\(user_id,project_id\)[\s\S]*state IN \('PENDING','DELIVERING'\)/);
  assert.match(sql, /UPDATE public\.editor_manual_commit_operations o SET state='REFUNDED'[\s\S]*j\.state='REFUNDED'/);
  assert.match(sql, /o\.project_id=p_project AND o\.credits=5 AND o\.state IN \('PENDING','DELIVERING'\)/);
  assert.match(sql, /private\.begin_manual_editor_delivery[\s\S]*state='DELIVERING'[\s\S]*delivery_expires_at=now\(\)\+interval '1 day'/);
  assert.match(sql, /o\.state='DELIVERING' AND o\.delivery_expires_at>now\(\)/);
  assert.doesNotMatch(sql, /UPDATE public\.project_document_versions/);
});

test('manual editor charge is disabled by default and exact job identity is enforced', () => {
  assert.match(sql, /editor_manual_commit_config[\s\S]*enabled boolean NOT NULL DEFAULT false/);
  assert.equal((sql.match(/FEATURE_DISABLED/g) ?? []).length, 6);
  assert.match(sql, /private\.editor_manual_mfa_satisfied[\s\S]*request\.jwt\.claims[\s\S]*auth\.mfa_factors/);
  assert.equal((sql.match(/MFA_REQUIRED/g) ?? []).length, 5);
  assert.match(sql, /j\.credits IS DISTINCT FROM p_credits OR j\.inputs IS DISTINCT FROM p_inputs/);
  assert.match(sql, /j\.inputs=charge_inputs/);
});

test('ambiguous paid responses reconcile by exact idempotency key', () => {
  assert.match(sql, /private\.manual_editor_commit_status\(p_project uuid,p_request_key text\)/);
  assert.match(sql, /o\.actor_id=actor AND o\.project_id=p_project AND o\.request_key=p_request_key/);
  assert.match(sql, /'pending',effective_state IN \('PENDING','DELIVERING'\)/);
  const status = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION private.manual_editor_commit_status'), sql.indexOf('CREATE OR REPLACE FUNCTION public.quote_manual_editor_commit'));
  assert.doesNotMatch(status, /UPDATE|FOR UPDATE|pg_advisory_xact_lock/);
});

test('the synchronous debit job is hidden from Library and push completion', () => {
  assert.match(sql, /UPDATE public\.jobs SET state='STORED',provider='local',updated_at=now\(\)/);
  assert.match(sql, /public\.delete_user_job\(actor::text,op\.job_id\)/);
  assert.doesNotMatch(sql, /UPDATE public\.jobs SET[^;]*deleted_at/s);
});

test('authenticated manual editor wrappers and checked implementations are explicitly allowlisted', () => {
  for (const signature of [
    'public.quote_manual_editor_commit(uuid,jsonb)',
    'public.save_paid_project_document(uuid,integer,jsonb,text,integer)',
    'public.manual_editor_commit_status(uuid,text)',
    'public.begin_manual_editor_delivery(uuid,text)',
    'public.finalize_manual_editor_commit(uuid,text)',
    'public.cancel_manual_editor_commit(uuid,text)',
    'private.quote_manual_editor_commit(uuid,jsonb)',
    'private.save_paid_project_document(uuid,integer,jsonb,text,integer)',
    'private.manual_editor_commit_status(uuid,text)',
    'private.begin_manual_editor_delivery(uuid,text)',
    'private.finalize_manual_editor_commit(uuid,text)',
    'private.cancel_manual_editor_commit(uuid,text)',
  ]) assert.match(privilegeGuard, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('manual editor receipts retain only hashed source coverage and are classified for erasure policy', () => {
  assert.doesNotMatch(sql, /source_ids/);
  assert.match(sql, /source_hashes jsonb NOT NULL/);
  assert.match(sql, /editor_manual_commit_operations[\s\S]*source_hashes jsonb NOT NULL/);
  assert.match(accountDeletionGuard, /'editor_manual_commit_receipts'.*source identifiers are retained only as SHA-256 hashes/);
  assert.match(privacyExportGuard, /Content-free manual-editor debit\/coverage tombstone; imported source identities are retained only as SHA-256 hashes\.[\s\S]*'editor_manual_commit_receipts'/);
});
