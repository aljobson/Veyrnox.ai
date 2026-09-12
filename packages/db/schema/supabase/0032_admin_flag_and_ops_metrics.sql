-- Admin gating for the ops dashboard.
--
-- Numbered 0032 here: another session applied 0031_revoke_public_definer_functions
-- first (2026-09-12 16:53 UTC), then this one (17:09), then a follow-up that
-- narrowed the p95 (17:12). Supabase applies by timestamp, so the repo numbering
-- follows the database's own order. Applied names:
--   0031_admin_flag_and_ops_metrics
--   0032_ops_metrics_p95_stored_only   (folded into the function body below)
--
-- The dashboard previously rendered hardcoded numbers to anyone who found
-- the URL. Real figures require a real gate: an explicit per-user flag,
-- checked inside a SECURITY DEFINER function so the API route cannot be
-- the only thing standing between a caller and the data.
--
-- Granting admin is a manual, auditable act:
--   update public.users set is_admin = true where email = '<person>';

alter table public.users
    add column if not exists is_admin boolean not null default false;

comment on column public.users.is_admin is
    'Grants access to /app/admin ops metrics. Set manually; never self-serve.';

-- Ops metrics for the last 24h. Returns a single json object.
-- Raises insufficient_privilege unless the calling auth id is an admin,
-- so the check lives with the data rather than only in the route handler.
create or replace function public.ops_metrics_24h(p_auth_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
    v_is_admin boolean;
    v_result json;
begin
    select u.id, u.is_admin into v_user_id, v_is_admin
    from public.users u
    where u.auth_id = p_auth_id;

    if v_user_id is null or v_is_admin is not true then
        raise exception 'not_admin' using errcode = '42501';
    end if;

    select json_build_object(
        'window_hours', 24,
        'generated_at', now(),
        'generating_users', (
            select count(distinct j.user_id) from public.jobs j
            where j.created_at > now() - interval '24 hours'
        ),
        'jobs_total', (
            select count(*) from public.jobs j
            where j.created_at > now() - interval '24 hours'
        ),
        'jobs_failed', (
            select count(*) from public.jobs j
            where j.created_at > now() - interval '24 hours'
              and j.state in ('FAILED', 'REFUNDED')
        ),
        'credits_debited', (
            select coalesce(sum(-l.delta), 0) from public.ledger_entries l
            where l.created_at > now() - interval '24 hours' and l.delta < 0
        ),
        'credits_refunded', (
            select coalesce(sum(l.delta), 0) from public.ledger_entries l
            where l.created_at > now() - interval '24 hours'
              and l.delta > 0 and l.reason like 'refund:%'
        ),
        'models', (
            select coalesce(json_agg(m order by m.model_id), '[]'::json) from (
                select
                    j.model_id,
                    count(*)                                                   as jobs,
                    count(*) filter (where j.state in ('FAILED', 'REFUNDED'))   as failed,
                    count(*) filter (where j.state = 'STORED')                  as stored,
                    -- STORED only: a job swept to REFUNDED hours later would
                    -- otherwise report the sweep's delay as provider latency.
                    round(extract(epoch from percentile_cont(0.95) within group (
                        order by case when j.state = 'STORED'
                                      then j.updated_at - j.created_at end
                    ))::numeric, 1)                                             as p95_seconds
                from public.jobs j
                where j.created_at > now() - interval '24 hours'
                group by j.model_id
            ) m
        )
    ) into v_result;

    return v_result;
end;
$$;

revoke all on function public.ops_metrics_24h(text) from public, anon, authenticated;
grant execute on function public.ops_metrics_24h(text) to service_role;

-- Applied to production as 0031_admin_flag_and_ops_metrics plus a follow-up
-- 0032_ops_metrics_p95_stored_only that narrowed the p95 to STORED jobs.
-- This file carries the final shape of both.
