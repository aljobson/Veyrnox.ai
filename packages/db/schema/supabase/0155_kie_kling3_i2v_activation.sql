-- Separate first-frame-only, pro/1080p, no-audio option; retain the fal row.
-- Evidence and remaining owner checks: docs/operations/kling-staging-verification-2026-09-28.md.
-- Apply only after launch checks and the owner-approved production workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'kling-3.0-i2v-kie' AND provider = 'kie'
       AND provider_endpoint = 'market:kling-3.0/video'
       AND modality = 'image-to-video' AND credits_5s = 28
       AND provider_cost_per_unit = 0.4500 AND cost_unit = 'per_second'
       AND billing_seconds = 5 AND gated_flag = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified kie Kling 3.0 row, updated %', affected;
    END IF;
END $$;
