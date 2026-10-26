// A disposable, empty local PostgreSQL database only. Loads actual money,
// settlement, escalation and editor functions; unrelated platform services are
// minimal fixture tables/stubs, never substitutes for the functions under test.
import { readFileSync } from 'node:fs';
const sql = name => readFileSync(new URL(`../../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
const functionSQL = (file, name) => {
    const text = sql(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    if (start < 0) throw new Error(name);
    const delimiter = text.slice(start).match(/\bAS\s+(\$[A-Za-z_]*\$)/i);
    if (!delimiter) throw new Error(`No function body: ${name}`);
    const end = text.indexOf(delimiter[1], start + delimiter.index + delimiter[0].length);
    return text.slice(start, end + delimiter[1].length + 1);
};
export function fixtureSQL() {
    const base = readFileSync(new URL('../../packages/db/schema/0001_initial.sql', import.meta.url), 'utf8');
    const editor = sql('0285_editor_library_renders.sql');
    const retention = sql('0016_asset_retention.sql');
    const escalation = sql('0275_csam_escalation_and_content_reports.sql');
    return `
DO $$ BEGIN IF to_regclass('public.jobs') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE SCHEMA private;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
${base}
ALTER TABLE public.users ADD COLUMN frozen_at timestamptz, ADD COLUMN deleted_at timestamptz, ADD COLUMN is_admin boolean DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN deleted_at timestamptz, ADD COLUMN free_allowance boolean DEFAULT false;
ALTER TABLE public.assets ADD COLUMN held_at timestamptz, ADD COLUMN sha256 text;
ALTER TABLE public.model_catalog ADD COLUMN cost_unit text, ADD COLUMN billing_seconds integer;
ALTER TABLE public.credit_balances ADD COLUMN free_balance integer DEFAULT 0, ADD COLUMN subscription_balance integer DEFAULT 0,
 ADD COLUMN subscription_expires_at timestamptz, ADD COLUMN subscription_cycle integer DEFAULT 0;
ALTER TABLE public.ledger_entries ADD COLUMN free_delta integer DEFAULT 0, ADD COLUMN subscription_delta integer DEFAULT 0, ADD COLUMN subscription_cycle integer;
CREATE TABLE public.account_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,actor text,reason text,top_up_id uuid,job_id uuid,idempotency_key text UNIQUE,credits_taken integer,credits_shortfall integer);
CREATE FUNCTION public.consume_upload_request(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
CREATE FUNCTION public.consume_job_read_request(uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN current_setting('esr.test_rate_limited',true)='true' THEN '{"ok":false,"code":"RATE_LIMITED"}'::jsonb ELSE '{"ok":true}'::jsonb END $$;
CREATE TABLE public.top_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users(id),order_id text UNIQUE);
${functionSQL('0062_freeze_credits_taken.sql', 'public.freeze_account')}
${functionSQL('0098_dispute_reason_provider_neutral.sql', 'public.apply_dispute_event')}
${functionSQL('0059_chargeback_freeze.sql', 'public.unfreeze_account')}
CREATE TABLE public.fal_dispatch(job_id uuid,state text,payload jsonb);
CREATE TABLE public.content_reports(subject_kind text,subject_id uuid,status text);
CREATE TABLE public.social_post_media(post_id uuid,source_job_id uuid);
CREATE TABLE public.social_posts(id uuid,status text);
CREATE TABLE public.cinema_uploads(source_job_id uuid);
CREATE TABLE public.job_steps(job_id uuid,output_r2_key text,output_text jsonb);
CREATE TABLE public.film_library_masters(id uuid,user_id uuid,source_job_id uuid,r2_key text,size_bytes bigint,expires_at timestamptz);
CREATE TABLE public.upload_reservations(user_id uuid,r2_key text,size_bytes bigint,created_at timestamptz DEFAULT now(),put_expires_at timestamptz DEFAULT now()+interval '16 minutes');
CREATE TABLE public.provider_spend_reservations(user_id uuid,effect_key text,provider text);
${retention.slice(0, retention.indexOf('SELECT cron.schedule'))}
${functionSQL('0177_append_only_no_truncate.sql', 'public.append_only_no_truncate')}
${escalation.slice(escalation.indexOf('CREATE TABLE IF NOT EXISTS public.evidence_holds'), escalation.indexOf('-- ── record_csam_escalation'))}
${functionSQL('0183_subscription_credit_bucket.sql', 'public.ledger_debit')}
${functionSQL('0206_free_allowance_jobs.sql', 'public.ledger_refund')}
${functionSQL('0007_job_state_transitions.sql', 'public.job_submitted')}
${functionSQL('0077_asset_content_hash.sql', 'public.job_stored')}
${functionSQL('0329_provider_spend_and_submit_guards.sql', 'public.sweep_stuck_jobs')}
${functionSQL('0275_csam_escalation_and_content_reports.sql', 'public.record_csam_escalation')}
${functionSQL('0351_delete_user_job.sql', 'public.delete_user_job')}
${editor.slice(0, editor.indexOf('SELECT cron.schedule'))} COMMIT;
${sql('0396_editor_server_render.sql')}
${sql('0397_editor_server_render_library.sql')}
${sql('0398_editor_server_render_quote.sql')}
`;
}
