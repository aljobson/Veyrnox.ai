-- Mashup and Sample (0531) go live. Both catalog rows were staged inactive until a
-- billed staging run; that run passed on 2026-11-16 (two results each, 2 credits per
-- result, reconciliation clean). Owner decision 2026-11-16. Prices are unchanged.
-- The product switch is MUSIC_RUNTIME_FLAGS.remix in wrangler.jsonc.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'stable-audio-3-mashup' AND provider = 'fal';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one stable-audio-3-mashup/fal row, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'stable-audio-3-sample' AND provider = 'fal';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one stable-audio-3-sample/fal row, updated %', affected;
    END IF;
END $$;
