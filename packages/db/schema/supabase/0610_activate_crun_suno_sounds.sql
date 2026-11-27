-- 0610 — Activate Suno Sound Effects after the owner's paid CRUN customer proof.
--
-- Evidence (crun.ai playground and logs, 2026-11-24 22:00 Europe/London):
--   model suno/sounds-generate, v6, loop off, lyrics off;
--   prompt "A clean cinematic whoosh followed by a soft impact, no music, short transition sound.";
--   CRUN log 725***97f reported Success, 2.5 credits consumed and 20 s provider duration;
--   returned MP3 was playable and 1.923606 s / 47,717 bytes, SHA-256
--   1febeb47ecfce6a1368e5b4e125c35ce19c323db19a8c91ab891d9a8a51da7e6.
--
-- The Worker adapter, capability registry and audio completion path must deploy before this migration.
-- Idempotent. Rollback: a forward migration setting the route to standby and offer inactive.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'paid owner proof 2026-11-24 22:00 Europe/London: suno/sounds-generate v6, loop off, lyrics off; CRUN log 725***97f Success, 2.5 credits, 20 s provider duration; MP3 1.923606 s, 47717 bytes, sha256 1febeb47ecfce6a1368e5b4e125c35ce19c323db19a8c91ab891d9a8a51da7e6',
           state = 'active', updated_at = now()
     WHERE model_id = 'suno-sounds' AND supplier = 'crun'
       AND endpoint = 'crun:suno/sounds-generate' AND priority = 1
       AND cost_per_unit = 0.0122 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND provenance = 'licensed_reseller' AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'paid owner proof 2026-11-24 22:00 Europe/London:%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one proved Suno Sounds route to activate, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'suno-sounds' AND provider = 'crun'
       AND provider_endpoint = 'crun:suno/sounds-generate' AND modality = 'text-to-audio'
       AND credits_5s = 2 AND provider_cost_per_unit = 0.0122
       AND cost_unit = 'per_generation' AND billing_seconds IS NULL AND NOT gated_flag
       AND active IN (false, true);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Suno Sounds offer to activate, updated %', affected;
    END IF;

    SELECT count(*) INTO affected
      FROM public.model_catalog c
      JOIN public.model_routes r ON r.model_id = c.id
     WHERE c.id = 'suno-sounds' AND c.active AND c.provider = 'crun'
       AND c.provider_endpoint = 'crun:suno/sounds-generate' AND c.credits_5s = 2
       AND r.supplier = 'crun' AND r.endpoint = c.provider_endpoint
       AND r.priority = 1 AND r.state = 'active'
       AND r.parity_record LIKE 'paid owner proof 2026-11-24 22:00 Europe/London:%';
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one active proved Suno Sounds offer and route, found %', affected;
    END IF;
END $$;

COMMIT;
