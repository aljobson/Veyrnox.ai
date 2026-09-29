-- Verified gateway, provider charge, R2 and library download on 2026-09-29.
-- Evidence: docs/operations/flux-staging-verification-2026-09-29.md.
-- Separate no-seed 1K option: retain fal Flux and leave Dialogue inactive.
-- Production applies only through the owner-approved migration workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'flux-2-pro-1k-kie' AND provider = 'kie'
       AND provider_endpoint = 'market:flux-2/pro-text-to-image'
       AND modality = 'text-to-image' AND credits_5s = 2
       AND provider_cost_per_unit = 0.0250 AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL AND gated_flag = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified kie Flux 1K row, updated %', affected;
    END IF;
END $$;
