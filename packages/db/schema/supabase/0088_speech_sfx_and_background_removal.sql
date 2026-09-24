-- Four fal models from the upstream review (2026-09-22). Prices read from
-- each fal model page on 2026-09-22; the capability records in
-- lib/modelCapabilities.js pin every billed quantity. Credits at the 50%
-- floor, $0.033 per credit: ceil(cost / 0.0165).
--
--   elevenlabs-tts-turbo   up to 1000 characters, $0.05/1000     $0.050 -> 4
--   minimax-speech-2.6-hd  up to 1000 characters, $0.10/1000     $0.100 -> 7
--   mmaudio-v2             one 8s sound, $0.001/s                $0.008 -> 1
--   bria-bg-remove         one image; the page says $0.04, the
--                          billing field $0.018 — priced at $0.04 $0.040 -> 3
--
-- Active: each endpoint's schema was checked live (check-capabilities.mjs).
-- A live generation of each runs straight after this applies; any that
-- fails is switched off by a follow-up migration.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('elevenlabs-tts-turbo', 'ElevenLabs TTS Turbo 2.5 (speech)', 'fal', 'fal-ai/elevenlabs/tts/turbo-v2.5', 'text-to-speech', 4, 0.0500, 'per_generation', NULL, false, true),
    ('minimax-speech-2.6-hd', 'MiniMax Speech 2.6 HD (speech)', 'fal', 'fal-ai/minimax/speech-2.6-hd', 'text-to-speech', 7, 0.1000, 'per_generation', NULL, false, true),
    ('mmaudio-v2', 'MMAudio v2 (sound effects)', 'fal', 'fal-ai/mmaudio-v2/text-to-audio', 'text-to-audio', 1, 0.0080, 'per_generation', NULL, false, true),
    ('bria-bg-remove', 'Bria Background Removal', 'fal', 'fal-ai/bria/background/remove', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
