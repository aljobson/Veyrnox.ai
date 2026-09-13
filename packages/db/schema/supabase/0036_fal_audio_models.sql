-- Three fal audio models, chosen for quality per dollar (audio supplier scan
-- 2026-09-12). All INACTIVE until each has run a live generation end to end.
-- Prices read from each fal model page on 2026-09-12; request shapes that pin
-- the billed quantity live in lib/providerDuration.js (PAYLOAD_SHAPES).
-- Credits at the 50% floor, $0.033 per credit: ceil(cost / 0.0165).
--
--   ace-step-1.5        one 60s track, thinking on      $0.036 -> 3
--                       (MIT licence; upgrade over the live ace-step v1)
--   elevenlabs-sfx-v2   one 10s sound effect             $0.020 -> 2
--                       (ElevenLabs states outputs are royalty-free)
--   inworld-tts         up to 2000 characters of speech  $0.020 -> 2
--                       (#2 on the Artificial Analysis TTS leaderboard)

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('ace-step-1.5', 'ACE-Step 1.5 (music)', 'fal', 'fal-ai/ace-step-1.5', 'text-to-audio', 3, 0.0360, 'per_generation', NULL, false, false),
    ('elevenlabs-sfx-v2', 'ElevenLabs Sound Effects v2', 'fal', 'fal-ai/elevenlabs/sound-effects/v2', 'text-to-audio', 2, 0.0200, 'per_generation', NULL, false, false),
    ('inworld-tts', 'Inworld TTS (speech)', 'fal', 'fal-ai/inworld-tts', 'text-to-speech', 2, 0.0200, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
