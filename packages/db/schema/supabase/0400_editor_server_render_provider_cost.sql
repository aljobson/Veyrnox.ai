-- ADR-0261: the provider spend guard (0327, 0329) prices every job from the catalog row's
-- provider_cost_per_unit and refuses a cost of zero (PROVIDER_SPEND_INVALID), so with the 0
-- that 0396 wrote, every server render admission failed with a database error.
-- 0.01 USD per credit (10 s of 1080p output, or 15 s of 720p) is a deliberately generous
-- upper bound on the Fly compute for that much output (measured 2.42x realtime on a
-- performance-4x machine); the real per-render cost is far lower. Re-measure from the Fly
-- bill and lower it before opening the feature beyond the owner preview.
BEGIN;
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.0100, updated_at = now()
     WHERE id = 'editor-server-render' AND provider = 'concat-render';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one editor-server-render/concat-render row, updated %', affected;
    END IF;
END $$;
COMMIT;
