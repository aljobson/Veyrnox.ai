import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
import { FALLBACK_CONTRACT_ENDPOINTS } from '../lib/fallbackModelCapabilities.js';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0591_crun_suno_music_foundation.sql', import.meta.url), 'utf8');
const consumers = readFileSync(new URL('../packages/db/schema/supabase/0592_crun_suno_music_consumers.sql', import.meta.url), 'utf8');

test('Suno capability exists in the server registry and fallback contract copy', () => {
  const cap = capabilityFor('crun:suno/music-generate');
  assert.equal(cap.provider, 'crun');
  assert.equal(cap.kind, 'audio');
  assert.equal(cap.inputs.lyrics.max, 5000);
  assert.equal(cap.inputs.tags.max, 1000);
  assert.equal(cap.inputs.duration.max, 360);
  assert.equal(publicCapabilities(cap).inputs.duration, undefined,
    'generic Create must not send custom-only duration into Suno simple mode');
  assert.equal(FALLBACK_CONTRACT_ENDPOINTS['crun-suno-v1'], 'crun:suno/music-generate');
});

test('0591 adds a forced-RLS durable Crun outbox and fenced recovery RPCs', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.crun_dispatch/);
  assert.match(sql, /'READY','STARTED','ACCEPTED','REJECTED','UNKNOWN','DEFERRED','CLOSED'/);
  assert.match(sql, /ALTER TABLE public\.crun_dispatch FORCE ROW LEVEL SECURITY/);
  for (const rpc of ['admit_crun_dispatch', 'claim_crun_dispatch', 'record_crun_dispatch', 'recover_crun_dispatch', 'reconcile_crun_dispatch_unknown']) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${rpc}\\(`), rpc);
  }
  assert.match(sql, /d\.state='STARTED'.*interval '2 minutes'/s);
  assert.match(sql, /SET state='UNKNOWN'/);
  assert.match(sql, /p_attempt_token/);
});

test('the sliding-window limiter, account circuit and scoped Suno breaker are explicit', () => {
  assert.match(sql, /v_now:=clock_timestamp\(\)/);
  assert.match(sql, /DELETE FROM public\.crun_create_reservations WHERE reserved_at<=v_now-interval '10 seconds'/);
  assert.match(sql, /reserved_at > v_now - interval '10 seconds'/);
  assert.match(sql, /v_count >= 20/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('crun:create:account'/);
  assert.match(sql, /provider_spend_provider_policy WHERE provider='crun'/);
  assert.match(sql, /PRIMARY KEY\(endpoint,suno_model\)/);
  assert.match(sql, /trip_crun_endpoint_routes/);
  assert.match(sql, /reopen_crun_endpoint_routes/);
});

test('all live Crun states are held out of the generic stuck-job sweep', () => {
  const sweep = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs'));
  assert.match(sweep, /NOT EXISTS\(SELECT 1 FROM public\.crun_dispatch/);
  assert.match(sweep, /'READY','STARTED','ACCEPTED','UNKNOWN','DEFERRED'/);
  assert.match(sweep, /j\.state IN \('SUBMITTED','FAILOVER'\)/);
  assert.match(sweep, /j\.state='SUCCEEDED'/);
  assert.match(sweep, /j\.state='FAILED'/);
  assert.match(sweep, /j\.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'/);
});

test('provider contracts backfill before validated checks and drafts use a composite key', () => {
  const backfill = sql.indexOf("UPDATE public.music_prompt_specs SET provider_contract='fal-ace-v1'");
  const validate = sql.indexOf('VALIDATE CONSTRAINT music_prompt_specs_provider_contract_check');
  assert.ok(backfill >= 0 && validate > backfill);
  assert.match(sql, /music_lyric_drafts_user_contract_key\s+ON public\.music_lyric_drafts\(user_id,provider_contract\)/);
  assert.match(sql, /music_get_custom_draft\(p_auth_id TEXT,p_provider_contract TEXT\)/);
  assert.match(sql, /music_save_custom_draft\(\s*p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID/s);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.music_get_custom_draft\(p_auth_id TEXT\)/);
  assert.match(sql, /model_id IN \('ace-step','ace-step-1\.5','ace-step-loop'\)/);
  assert.match(sql, /COALESCE\(rec\.result_draft->>'provider_contract','fal-ace-v1'\)/);
});

test('pair admission is serialized and chooses exactly one provider outbox', () => {
  assert.match(sql, /hashtextextended\(v_user::TEXT\|\|':'\|\|p_idempotency_key,0\)/);
  assert.match(sql, /Required second receipt lookup after the money lock/);
  assert.match(sql, /q\.provider_contract='crun-suno-v1'/);
  assert.match(sql, /INSERT INTO public\.crun_dispatch\(job_id,endpoint,payload\) VALUES\(job1/);
  assert.match(sql, /INSERT INTO public\.fal_dispatch\(job_id,endpoint,payload\) VALUES\(job1/);
  assert.match(sql, /'suno_model',p\.suno_model/);
  assert.doesNotMatch(sql, /'instrumental',p\.instrumental,'model',p\.suno_model/);
  assert.match(sql, /jsonb_build_object\('tags',p\.prompt,'duration',60\)/);
  assert.match(sql, /'crun','crun:suno\/music-generate',0\.0536,'per_generation',NULL,2,'standby','unverified',NULL/);
  assert.doesNotMatch(sql, /UPDATE public\.model_catalog\s+SET\s+provider\s*=\s*'crun'/i);
});

test('duration pricing is contract-aware and Crun remains flat', () => {
  assert.match(sql, /p_contract IN \('crun-suno-v1','crun:suno\/music-generate'\) THEN 1/);
  assert.match(sql, /private\.music_duration_price_blocks\(q\.model_id,q\.provider_contract,p\.duration_seconds\)/);
  assert.match(sql, /provider_endpoint='crun:suno\/music-generate' AND provider_contract='crun-suno-v1'/);
  assert.match(sql, /p_credits\*0\.033 >= 2\*p_cost_per_request/);
});

test('0592 adds fenced account control and account-wide TaskInfo pacing', () => {
  assert.match(consumers, /pause_crun_account_admission\(p_reason TEXT,p_observed_at TIMESTAMPTZ\)/);
  assert.match(consumers, /resume_crun_account_admission\(p_expected_fence BIGINT\)/);
  assert.match(consumers, /p_observed_at<=COALESCE\(v\.admission_resumed_at/);
  assert.match(consumers, /CREATE TABLE IF NOT EXISTS public\.crun_taskinfo_reservations/);
  assert.match(consumers, /v_count>=15/);
  assert.match(consumers, /reserved_at<=v_now-interval '1 second'/);
  assert.match(consumers, /FORCE ROW LEVEL SECURITY/);
});

test('0592 records authoritative status and exposes age-only health', () => {
  assert.match(consumers, /ADD COLUMN IF NOT EXISTS last_authoritative_at TIMESTAMPTZ/);
  assert.match(consumers, /record_crun_task_status\(p_job_id UUID,p_status TEXT,p_observed_at TIMESTAMPTZ\)/);
  assert.match(consumers, /crun_dispatch_health\(p_accepted_unobservable_minutes INTEGER DEFAULT 5\)/);
  for (const key of ['accepted_unobservable', 'authoritative_pending', 'unknown']) assert.match(consumers, new RegExp(`'${key}'`));
  assert.doesNotMatch(consumers.slice(consumers.indexOf('CREATE OR REPLACE FUNCTION public.crun_dispatch_health'),
    consumers.indexOf('CREATE OR REPLACE FUNCTION public.claim_crun_dispatch')), /payload|prompt|lyrics/);
});

test('0592 extends every current shared dispatch consumer without changing fal eligibility', () => {
  assert.match(consumers, /'attempt_count',d\.attempt_count,'retry_at',v_retry_at/);
  assert.match(consumers, /NOT \(v_result \? 'provider_contract'\)/);
  assert.match(consumers, /v_crun\.state NOT IN \('READY','DEFERRED'\)/);
  assert.match(consumers, /public\.get_user_job_cancel[\s\S]*crun_dispatch[\s\S]*'READY','DEFERRED'/);
  assert.match(consumers, /public\.delete_user_job[\s\S]*UPDATE public\.crun_dispatch SET payload='\{\}'::jsonb/);
  assert.match(consumers, /crun_dispatch_forget_erased_user/);
  assert.match(consumers, /'crun_dispatch_unknown'/);
  assert.match(consumers, /public\.ledger_refund/);
  assert.doesNotMatch(consumers, /INSERT INTO public\.ledger_entries|UPDATE public\.credit_balances/);
});
