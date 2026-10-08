-- Video agent, slice 2 (ADR-0074, docs/montage/SPEC.md): one `montage` step per
-- job, advanced by the signed runner callback, and the catalog row INACTIVE.
--
-- Adds one step kind and one provider (`montage`: the runner is the source of the
-- signed callback, so its step is found by (provider, provider_job_id) like fal,
-- kie and openrouter steps). The ordinal CHECK from 0092 already covers it: any
-- step outside scene/trim sits at ordinal 0.
--
-- Both CHECKs are widened by READING what they allow now and adding to it, never by
-- restating the list: 0225 added `captions` to the step kinds, and a fixed list here
-- would drop it (this file applies after 0225). Idempotent: it does nothing when the
-- value is already allowed.
--
-- The price is the owner's working decision of 2026-10-08 ("use 165"): the worst-case
-- tier of fal's published Kling v3 standard rate for three 5 s clips ($2.31) plus about
-- $0.41 of agent tokens = $2.72; ceil(2.72 / 0.0165) = 165 credits at the ADR-0014
-- floor. Revisit when fal's real billing and the measured runs are in. gated_flag stays
-- false; active = false is the gate, and AGENT_VIDEO_ENABLED is a second one in the
-- Worker. The per-run spend ceiling is $2.50, enforced at the runner.

DO $$
DECLARE
    def text;
    kinds text[];
BEGIN
    -- step kinds
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.job_steps'::regclass AND c.conname = 'job_steps_step_check';
    IF def IS NULL THEN
        RAISE EXCEPTION 'job_steps_step_check is missing; 0091/0092 must be applied first';
    END IF;
    IF def NOT LIKE '%''montage''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO kinds
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        kinds := array_append(kinds, 'montage');
        ALTER TABLE public.job_steps DROP CONSTRAINT job_steps_step_check;
        EXECUTE format(
            'ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_step_check CHECK (step IN (%s))',
            (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(kinds) AS k)
        );
    END IF;

    -- providers
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.job_steps'::regclass AND c.conname = 'job_steps_provider_check';
    IF def IS NULL THEN
        RAISE EXCEPTION 'job_steps_provider_check is missing; 0091 must be applied first';
    END IF;
    IF def NOT LIKE '%''montage''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO kinds
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        kinds := array_append(kinds, 'montage');
        ALTER TABLE public.job_steps DROP CONSTRAINT job_steps_provider_check;
        EXECUTE format(
            'ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_provider_check CHECK (provider IN (%s))',
            (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(kinds) AS k)
        );
    END IF;
END
$$;

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('video-agent', 'Video agent (plan, approve, produce)', 'veyrnox', 'video-agent:v1', 'text-to-video', 165, 2.7200, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
