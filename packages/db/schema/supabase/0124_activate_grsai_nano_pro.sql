-- Switch Nano Banana Pro text-to-image from kie (6 credits) to GrsAI (2).
-- Deployment/recovery evidence and rollback: ADR-0020.
-- Apply only through the owner-approved production migration workflow.
-- The existing fal image-edit route and all Credit Packs remain unchanged.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, name = 'Nano Banana Pro', credits_5s = 2,
           updated_at = now()
     WHERE id = 'nano-banana-pro-grsai' AND provider = 'grsai'
       AND provider_endpoint = 'grsai:nano-banana-pro'
       AND modality = 'text-to-image' AND cost_unit = 'per_generation'
       AND provider_cost_per_unit = 0.0271 AND billing_seconds IS NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified GrsAI Nano Banana Pro row, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET active = false, updated_at = now()
     WHERE id = 'nano-banana-pro-kie' AND provider = 'kie'
       AND provider_endpoint = 'market:nano-banana-pro';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kie Nano Banana Pro row, updated %', affected;
    END IF;
END $$;
