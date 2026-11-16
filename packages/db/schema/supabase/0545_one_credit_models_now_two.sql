-- 0545 — every 1-credit model is now 2 credits (owner request 2026-11-16, web and mobile app).
--
-- /models, /api/catalog and the mobile app all read `model_catalog.credits_5s`, so this one change moves them together.
-- The seven models that listed at 1 credit: ace-step, mmaudio-v2, nano-banana-kie, sana-1.5-4.8b, seedream-4,
-- clip-edit (1 per started 5 s of output, so now 2 per 5 s) and mmaudio-v2-video.
-- One row per id on staging and in the public catalog (checked 2026-11-16). Raising a price cannot break the
-- ADR-0014 floor trigger (0366).
-- Jobs already submitted keep the price they were debited at; only new submissions cost 2.
-- Idempotent: absolute value, exactly seven rows asserted.
-- Rollback: a new migration setting these ids back to 1.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET credits_5s = 2, updated_at = now()
     WHERE id IN ('ace-step', 'mmaudio-v2', 'nano-banana-kie', 'sana-1.5-4.8b', 'seedream-4', 'clip-edit', 'mmaudio-v2-video');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 7 THEN
        RAISE EXCEPTION 'Expected 7 one-credit model rows, updated %', affected;
    END IF;
END $$;
