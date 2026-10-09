-- Clip Editor slow motion (docs/editor/SPEED.md): a `slow` step kind on job_steps, run once per
-- slowed clip (topaz/interpolate/video on fal), so it needs ordinals 0..9 like `trim`.
--
-- Two checks change.
--  * job_steps_step_check gains 'slow'. It is widened by READING what the constraint allows now
--    and adding to it, never by restating the list: 0225 added `captions` and 0227 added
--    `montage`, and a fixed list here would drop whichever it did not know. Idempotent: it does
--    nothing when 'slow' is already allowed.
--  * job_steps_ordinal_check is restated, which is safe because its shape is generic (only
--    `scene` and `trim` are special, every other kind sits at ordinal 0): `slow` joins `trim`.
--    Dropped if present, then added, so a rerun lands on the same constraint.
--
-- No catalog change: the edit is still one `clip-edit` row and one debit, and the gateway counts
-- slowed clips as extra billed units (lib/clipEdit.js SLOW_UNITS_PER_SECOND, a deliberately high
-- placeholder). The Worker flag CLIP_EDIT_SLOW_ENABLED stays "false" until this is applied and
-- fal's billed cost is read.

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

    IF def NOT LIKE '%''slow''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO kinds
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        kinds := array_append(kinds, 'slow');

        ALTER TABLE public.job_steps DROP CONSTRAINT job_steps_step_check;
        EXECUTE format(
            'ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_step_check CHECK (step IN (%s))',
            (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(kinds) AS k)
        );
    END IF;
END
$$;

ALTER TABLE public.job_steps DROP CONSTRAINT IF EXISTS job_steps_ordinal_check;
ALTER TABLE public.job_steps ADD CONSTRAINT job_steps_ordinal_check
    CHECK ((step = 'scene' AND ordinal BETWEEN 0 AND 3)
        OR (step IN ('trim', 'slow') AND ordinal BETWEEN 0 AND 9)
        OR (step NOT IN ('scene', 'trim', 'slow') AND ordinal = 0));
