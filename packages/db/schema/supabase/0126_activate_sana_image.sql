-- Activate the separately validated budget image option. ADR-0037.
-- Apply through the owner-approved production migration workflow.
-- FLUX and other models retain their existing identities and prices.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'sana-1.5-4.8b' AND name = 'Sana v1.5 4.8B'
       AND provider = 'fal' AND provider_endpoint = 'fal-ai/sana/v1.5/4.8b'
       AND modality = 'text-to-image' AND credits_5s = 1
       AND provider_cost_per_unit = 0.0100 AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL AND NOT gated_flag;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified Sana row, updated %', affected;
    END IF;
END $$;
