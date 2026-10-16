-- Route the existing basic Nano Banana product through GrsAI's current
-- Nano Banana 2 Lite model. Keep the public ID, display name, two-credit
-- retail price and free allowance stable; only the wholesale route changes.
--
-- Supplier evidence checked 2026-10-16:
--   GrsAI model directory: nano-banana-2-lite, 440 credits, 1K
--   Lowest purchased-pack rate used for the catalog: 440 * $5 / 333,000
--     = $0.0066066..., conservatively rounded up to $0.0067 per image.
--   Previous KIE route: $0.0200 per image.
--
-- The provider contract is pinned in additionalModelCapabilities.js and the
-- GrsAI adapter: one 1K image, polling only. In-flight KIE jobs retain their
-- provider on jobs.provider and continue through the KIE callback path.
DO $$
DECLARE affected BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.model_catalog
         WHERE id = 'nano-banana-kie' AND provider = 'grsai'
           AND provider_endpoint = 'grsai:nano-banana-2-lite'
           AND name = 'Nano Banana' AND modality = 'text-to-image'
           AND credits_5s = 2 AND provider_cost_per_unit = 0.0067
           AND cost_unit = 'per_generation' AND billing_seconds IS NULL
           AND gated_flag = false AND active = true
    ) THEN RETURN; END IF;

    UPDATE public.model_catalog
       SET provider = 'grsai', provider_endpoint = 'grsai:nano-banana-2-lite',
           provider_cost_per_unit = 0.0067, updated_at = now()
     WHERE id = 'nano-banana-kie' AND provider = 'kie'
       AND provider_endpoint = 'market:google/nano-banana'
       AND name = 'Nano Banana' AND modality = 'text-to-image'
       AND credits_5s = 2 AND provider_cost_per_unit = 0.0200
       AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND gated_flag = false AND active = true;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one active Nano Banana KIE row for the GrsAI swap, updated %', affected;
    END IF;
END $$;
