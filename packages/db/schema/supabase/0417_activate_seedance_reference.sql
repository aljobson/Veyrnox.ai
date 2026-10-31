-- Owner turned Seedance 2.0 reference-to-video on (2026-10-31, ADR-0309). Row staged by 0416.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'seedance-2.0-reference' AND provider = 'fal';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one seedance-2.0-reference/fal row, updated %', affected;
    END IF;
END $$;
