-- 0573 — kie Seedance 2 photo offer for long-prompt templates (ADR-0309 amendment 3, ADR-0333 amendment 3).
--
-- One new offer, seedance-2.0-photo-kie: kie `bytedance/seedance-2`, one reference picture (`reference_image_urls`), 720p,
-- generated audio, 5 or 10 s, prompt up to kie's published 20,000 characters. It serves the one-photo templates whose exact
-- bound prompt is over Kling 3.0's 2,500 characters. It is a separate row from seedance-2.0-reference-kie (0454), which is the
-- template-clip offer priced with a reference video and stays as it is.
--
-- The row is active but DARK: the app neither lists nor sells it until the runtime key seedanceLongTemplates is true in
-- APP_RUNTIME_FLAGS (lib/seedanceLongTemplates.js: GET /api/catalog skips it, POST /api/v1/generations answers model_not_found
-- before any debit, the templates stay out of the gallery). Applying this migration alone changes nothing a customer sees.
--
-- Price. kie's published rate (kie.ai/seedance-2, read 2026-11-20, marked beta): 41 kie credits a second at 720p with no
-- reference video, 1 kie credit = $0.005, so $0.205 a second and $1.0250 per 5 s unit. provider_cost_per_unit holds that TOTAL
-- per unit (0029/0327, as 0520). credits_5s = ceil(1.0250 / 0.01796) = 58, the ADR-0014 floor (0366); a 10 s clip is 116.
-- Evidence (owner's paid probe 3, 2026-11-20, PROD kie key): task e19731441b78840a5df9fe08f8325708, ghost-makeover exact bound
-- prompt (8,734 characters, sha256 546275625b66...e1df9), the photo as reference_image_urls[0], 9:16, 10 s, 720p, audio on:
-- success after 272 s, creditsConsumed 410 (= 41 x 10), 720x1280, 10.04 s, audio stream, output host tempfile.aiquickdraw.com,
-- frames read: generated scene from the first frame, the photo's face recognisable, template beats followed. One sample.
-- A refusal is free: probe 2 (jellyfish-airlines, first-frame mode) failed with failCode 500 "copyright restrictions" and
-- creditsConsumed 0; our job then fails and the existing refund path returns the whole debit.
--
-- Idempotent: the INSERTs do nothing on replay and the checks assert the one intended state.
-- Rollback: a forward migration setting active = false (or the runtime key left off).

BEGIN;

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('seedance-2.0-photo-kie', 'Seedance 2.0 · Photo · kie', 'kie', 'market:bytedance/seedance-2', 'image-to-video',
     58, 1.0250, 'per_second', 5, false, true)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog
     WHERE id = 'seedance-2.0-photo-kie' AND provider = 'kie' AND provider_endpoint = 'market:bytedance/seedance-2'
       AND modality = 'image-to-video' AND credits_5s = 58 AND provider_cost_per_unit = 1.0250
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND gated_flag = false AND active = true
       AND credits_5s >= CEIL(provider_cost_per_unit / 0.01796);
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one seedance-2.0-photo-kie row at 58 credits ($1.0250 per 5 s, active), found %', n;
    END IF;
END $$;

-- One priority-1 route mirroring the catalog row (ADR-0256), as 0367 backfilled for every routed offer.
INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
VALUES
    ('seedance-2.0-photo-kie', 'kie', 'market:bytedance/seedance-2', 1.0250, 'per_second', 5, 1, 'active', 'licensed_reseller',
     'probe 2026-11-20 (owner, PROD kie key): bytedance/seedance-2 reference mode, task e19731441b78840a5df9fe08f8325708, ghost-makeover exact bound prompt 8,734 chars, 9:16 10 s 720p audio, success 272 s, creditsConsumed 410 (41 x 10), 720x1280 10.04 s with audio, frames read by Claude Code: generated scene, face recognisable, template followed; one sample')
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes r
      JOIN public.model_catalog c ON c.id = r.model_id
     WHERE r.model_id = 'seedance-2.0-photo-kie' AND r.priority = 1 AND r.state = 'active'
       AND r.supplier = c.provider AND r.endpoint = c.provider_endpoint AND r.cost_per_unit = c.provider_cost_per_unit
       AND r.cost_unit = c.cost_unit AND r.billing_seconds = c.billing_seconds AND r.provenance = 'licensed_reseller';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one active kie route 1 mirroring seedance-2.0-photo-kie, found %', n;
    END IF;
    SELECT count(*) INTO n FROM public.model_routes WHERE model_id = 'seedance-2.0-photo-kie';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one route for seedance-2.0-photo-kie, found %', n;
    END IF;
END $$;

COMMIT;
