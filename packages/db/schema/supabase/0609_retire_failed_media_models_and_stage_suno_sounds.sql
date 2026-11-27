-- 0609 — Remove only the offers that failed the owner's production customer QA on 2026-11-24.
-- Rows stay in place for historical jobs and ledger references; inactive offers are no longer quoted or accepted.
--
-- CRUN's complete Audio API catalogue was reviewed the same day. Its truthful replacement for the two failed
-- text-to-sound offers is suno/sounds-generate, so that new offer is staged here. CRUN has no equivalent for
-- arbitrary-upload Demucs separation, multi-speaker dialogue, lip sync, or the failed branded TTS/voice-clone
-- offers. Qwen3 TTS already passed live Veyrnox QA and remains active, unchanged.
--
-- The Kling O1 Reference provider route itself has a paid CRUN proof, but the production customer flow failed
-- before dispatch because Veyrnox could not prove the selected Library MP4's visual length. Retire the offer until
-- that safety-preserving source inspection is repaired; do not weaken the visual-duration gate.
--
-- suno/sounds-generate docs: https://docs.crun.ai/suno-api/sounds-generate (read 2026-11-24).
-- Staged inactive/standby until the owner-account paid playground proof in the following migration.

BEGIN;

INSERT INTO public.model_catalog
  (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
  ('suno-sounds', 'Suno Sound Effects', 'crun', 'crun:suno/sounds-generate',
   'text-to-audio', 2, 0.0122, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
  (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT 'suno-sounds', 'crun', 'crun:suno/sounds-generate', 0.0122, 'per_generation', NULL,
       1, 'standby', 'licensed_reseller'
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes WHERE model_id = 'suno-sounds')
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = false, updated_at = now()
     WHERE id IN (
       'elevenlabs-sfx-v2', 'mmaudio-v2', 'mmaudio-v2-video',
       'elevenlabs-tts-turbo', 'minimax-speech-2.6-hd', 'inworld-tts',
       'elevenlabs-dialogue', 'zonos2-voice-clone', 'demucs-stems',
       'latentsync', 'kling-o1-reference'
     );
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 11 THEN
        RAISE EXCEPTION 'Expected eleven failed production offers to retire, updated %', affected;
    END IF;

    UPDATE public.model_routes
       SET state = 'disabled', updated_at = now()
     WHERE model_id IN (
       'elevenlabs-sfx-v2', 'mmaudio-v2', 'mmaudio-v2-video',
       'elevenlabs-tts-turbo', 'minimax-speech-2.6-hd', 'inworld-tts',
       'elevenlabs-dialogue', 'zonos2-voice-clone', 'demucs-stems',
       'latentsync', 'kling-o1-reference'
     );

    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'suno-sounds' AND name = 'Suno Sound Effects' AND provider = 'crun'
       AND provider_endpoint = 'crun:suno/sounds-generate' AND modality = 'text-to-audio'
       AND credits_5s = 2 AND provider_cost_per_unit = 0.0122 AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL AND NOT gated_flag AND NOT active;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one staged Suno Sound Effects catalog row, found %', affected;
    END IF;

    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'suno-sounds' AND supplier = 'crun' AND endpoint = 'crun:suno/sounds-generate'
       AND cost_per_unit = 0.0122 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND priority = 1 AND state = 'standby' AND provenance = 'licensed_reseller';
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one standby Suno Sound Effects route, found %', affected;
    END IF;
END $$;

COMMIT;
