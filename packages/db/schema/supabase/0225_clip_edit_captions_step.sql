-- Clip Editor captions (docs/editor/CAPTIONS.md): one more step kind on
-- job_steps, `captions`, run last (veed/subtitles on fal). The ordinal CHECK
-- from 0092 already covers it: any step outside scene/trim sits at ordinal 0.
--
-- No catalog change. The edit is still one `clip-edit` row and one debit; the
-- gateway counts captions as extra billed units (lib/clipEdit.js CAPTIONS_UNITS)
-- the way it counts every other step. The Worker flag CLIP_EDIT_CAPTIONS_ENABLED
-- stays "false" until this is applied and fal's billed cost is checked.
--
-- Written to add to whatever the constraint allows now, not to restate the
-- list: another open migration (0224) also rewrites job_steps_step_check, and
-- a fixed list here would drop its kind if it applied second. Idempotent: it
-- does nothing when 'captions' is already allowed.

DO $$
DECLARE
    def text;
    kinds text[];
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.job_steps'::regclass AND c.conname = 'job_steps_step_check';

    IF def IS NULL THEN
        RAISE EXCEPTION 'job_steps_step_check is missing; 0091/0092 must be applied first';
    END IF;
    IF def LIKE '%''captions''%' THEN
        RETURN;
    END IF;

    SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO kinds
    FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
    kinds := array_append(kinds, 'captions');

    ALTER TABLE public.job_steps DROP CONSTRAINT job_steps_step_check;
    EXECUTE format(
        'ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_step_check CHECK (step IN (%s))',
        (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(kinds) AS k)
    );
END
$$;
