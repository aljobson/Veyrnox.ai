-- Video agent, slice 2 (ADR-0074, docs/montage/SPEC.md): one `montage` step per
-- job, advanced by the signed runner callback, and the catalog row INACTIVE.
--
-- Widens job_steps_step_check by one kind and job_steps_provider_check by one
-- provider, `montage`: the runner is the source of the signed callback, so its
-- step is found by (provider, provider_job_id) like fal/kie/openrouter steps. The ordinal CHECK from 0092 already
-- covers it: any step outside scene/trim must sit at ordinal 0.
--
-- The row is a placeholder: credits_5s = 1 and provider_cost_per_unit = 0 until
-- slice 4 measures real runs and slice 6 sets the price from the per-run
-- ceiling (ADR-0014 floor). gated_flag stays false; active = false is the gate,
-- and AGENT_VIDEO_ENABLED is a second one in the Worker.
-- Idempotent: drop-if-exists then add, and ON CONFLICT DO NOTHING.

ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_step_check;
ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_step_check
    CHECK (step IN ('script', 'voice', 'scene', 'stitch', 'trim', 'merge', 'audio', 'montage'));

ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_provider_check;
ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_provider_check
    CHECK (provider IN ('fal', 'kie', 'openrouter', 'montage'));

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('video-agent', 'Video agent (plan, approve, produce)', 'veyrnox', 'video-agent:v1', 'text-to-video', 1, 0.0000, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
