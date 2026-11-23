-- Qwen3 TTS is its own inactive speech offer, not a MiniMax fallback.
-- Evidence: owner Crun probes 2026-11-23 succeeded, 2 credits each ($0.0089).
-- Only Cherry is proved live. The other 34 pinned Alibaba voice ids are unverified through Crun.
-- NOT established: audio quality, full 600-character delivery, gateway debit/refund proof.
-- Deploy the Worker BEFORE applying this migration. Do not apply from a development session.
-- Activation is a separate migration after a capped staging proof: only the catalog active flip is needed.
-- The standby route is required for crunSweep discovery even though direct catalog dispatch serves this offer.
BEGIN;
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES ('qwen3-tts', 'Qwen3 TTS', 'crun', 'crun:qwen3-tts/speech-synthesis', 'text-to-speech', 2, 0.0089, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
VALUES ('qwen3-tts', 'crun', 'crun:qwen3-tts/speech-synthesis', 0.0089, 'per_generation', NULL, 1, 'standby', 'licensed_reseller')
ON CONFLICT (model_id, supplier, endpoint) DO NOTHING;

DO $$
DECLARE affected BIGINT;
BEGIN
    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'qwen3-tts' AND name = 'Qwen3 TTS' AND provider = 'crun'
       AND provider_endpoint = 'crun:qwen3-tts/speech-synthesis' AND modality = 'text-to-speech'
       AND credits_5s = 2 AND provider_cost_per_unit = 0.0089 AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL AND gated_flag = false AND active = false;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one inactive Qwen3 TTS catalog row, found %', affected;
    END IF;
    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'qwen3-tts' AND supplier = 'crun' AND endpoint = 'crun:qwen3-tts/speech-synthesis'
       AND cost_per_unit = 0.0089 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND priority = 1 AND state = 'standby' AND provenance = 'licensed_reseller';
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one standby Qwen3 TTS route for sweep discovery, found %', affected;
    END IF;
END $$;
COMMIT;
