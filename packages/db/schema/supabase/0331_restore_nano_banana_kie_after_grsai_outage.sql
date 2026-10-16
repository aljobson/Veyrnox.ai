-- Restore the existing Nano Banana product to its proven KIE route after the
-- production GrsAI canary reached nano-banana-2-lite but the supplier returned
-- status=failed, error="该模型修复中" (model under repair) and refunded all
-- 440 supplier credits. Observed 2026-10-16 in GrsAI task
-- 3-4467af15-bffc-450e-9fcd-9be513b2786f.
--
-- Keep the GrsAI adapter and provider safeguards in place for a future
-- re-canary. Availability wins over the lower unit cost until the supplier's
-- Lite endpoint is healthy again.
DO $$
DECLARE affected BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.model_catalog
         WHERE id = 'nano-banana-kie' AND provider = 'kie'
           AND provider_endpoint = 'market:google/nano-banana'
           AND name = 'Nano Banana' AND modality = 'text-to-image'
           AND credits_5s = 2 AND provider_cost_per_unit = 0.0200
           AND cost_unit = 'per_generation' AND billing_seconds IS NULL
           AND gated_flag = false AND active = true
    ) THEN RETURN; END IF;

    UPDATE public.model_catalog
       SET provider = 'kie', provider_endpoint = 'market:google/nano-banana',
           provider_cost_per_unit = 0.0200, updated_at = now()
     WHERE id = 'nano-banana-kie' AND provider = 'grsai'
       AND provider_endpoint = 'grsai:nano-banana-2-lite'
       AND name = 'Nano Banana' AND modality = 'text-to-image'
       AND credits_5s = 2 AND provider_cost_per_unit = 0.0067
       AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND gated_flag = false AND active = true;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one active Nano Banana GrsAI Lite row for the outage rollback, updated %', affected;
    END IF;
END $$;
