-- Popular templates (ADR-0072, accepted 2026-10-05): which gallery templates people actually use, as a ranked list of ids.
--
-- A job started from a template records the template id as inputs.preset_id (the generations route validates it against the real
-- template list and the model it belongs to, and never forwards it to a provider). This function ranks templates by the number of
-- DISTINCT ACCOUNTS that completed a job from them in the last p_days days. It counts accounts, not jobs, so a handful of accounts
-- cannot push a template up by repeating it, and a template needs p_min_accounts of them (20 by default) before it ranks at all.
--
-- It returns template ids in rank order and nothing else: no counts, no users, no prompts, no job ids. Only STORED jobs count (the
-- file exists), so a refused, failed or refunded job never ranks anything. Service role only; the public route caches the answer.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming the full signature.

CREATE INDEX IF NOT EXISTS jobs_preset_id_idx ON public.jobs (created_at) WHERE (inputs ->> 'preset_id') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.popular_templates(p_days INTEGER DEFAULT 30, p_min_accounts INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(t.preset_id ORDER BY t.accounts DESC, t.preset_id), '[]'::jsonb)
      FROM (
        SELECT j.inputs ->> 'preset_id' AS preset_id, count(DISTINCT j.user_id) AS accounts
          FROM public.jobs j
         WHERE (j.inputs ->> 'preset_id') ~ '^[a-z0-9-]{1,40}$'
           AND j.state::text = 'STORED'
           AND j.created_at >= now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 90))
         GROUP BY 1
        HAVING count(DISTINCT j.user_id) >= GREATEST(COALESCE(p_min_accounts, 20), 1)
         ORDER BY 2 DESC, 1
         LIMIT 20
      ) t
$$;

REVOKE ALL ON FUNCTION public.popular_templates(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.popular_templates(INTEGER, INTEGER) TO service_role;
