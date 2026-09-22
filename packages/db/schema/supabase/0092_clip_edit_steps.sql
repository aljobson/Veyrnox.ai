-- Clip Editor, slice 1 (docs/editor/PRD.md, ADR-0029): the editor runs on the
-- job_steps table from 0091. Its steps are trim (one per clip that is cut),
-- merge (the trimmed clips joined) and audio (a soundtrack laid over them).
-- They run one after another, each started by its predecessor's webhook, so
-- no step ever fans in and the missing claim (#230) does not bite here.
--
-- Widens the two CHECKs 0091 declared inline, and adds the catalog row
-- INACTIVE: the gateway wiring lands in the next slice.
-- Idempotent: drop-if-exists then add, and ON CONFLICT DO NOTHING.

ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_step_check;
ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_step_check
    CHECK (step IN ('script', 'voice', 'scene', 'stitch', 'trim', 'merge', 'audio'));

-- Scenes 0..3 (Auto Short); trims 0..9, one per clip (MAX_CLIPS in lib/clipEdit.js).
-- 0091's ordinal CHECK names two columns, so Postgres called it job_steps_check;
-- it is replaced under a name that says what it is.
ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_check;
ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_ordinal_check;
ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_ordinal_check
    CHECK ((step = 'scene' AND ordinal BETWEEN 0 AND 3)
        OR (step = 'trim' AND ordinal BETWEEN 0 AND 9)
        OR (step NOT IN ('scene', 'trim') AND ordinal = 0));

-- One row, one debit (ADR-0029): 1 credit per started 5 s of output. The
-- provider cost is the dearest call in the chain (trim, $0.001 per compute
-- second); the §9 table shows the whole chain well under the ADR-0014 floor.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('clip-edit', 'Clip Editor (trim, join, add audio; up to 60s)', 'veyrnox', 'clip-edit:v1', 'video-to-video', 1, 0.0010, 'per_second', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
