-- Verified gateway, provider charge, R2 and library download on 2026-09-29.
-- Evidence: docs/operations/grsai-edit-staging-verification-2026-09-29.md.
-- Separate no-seed 2K edit option: retain the existing fal edit route.
-- Production applies only through the owner-approved migration workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'nano-banana-pro-edit-grsai' AND provider = 'grsai'
       AND provider_endpoint = 'grsai:nano-banana-pro-edit'
       AND modality = 'image-to-image' AND credits_5s = 2
       AND provider_cost_per_unit = 0.0271 AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL AND gated_flag = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified GrsAI Nano Pro Edit row, updated %', affected;
    END IF;
END $$;
