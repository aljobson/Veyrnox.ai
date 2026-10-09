-- Qwen 3 TTS Voice Design on fal, INACTIVE: speech in a voice the user
-- describes in words ("a calm older man with a soft Irish accent"). No live
-- speech model takes a voice description. It takes no recording, so it is not
-- voice cloning, which the Acceptable Use page forbids.
--
-- Price read from the fal model page on 2026-10-09: "$0.09 per 1000
-- characters". The capability record (lib/additionalModelCapabilities.js)
-- caps the spoken text at 1000 characters, so one job is at most $0.09.
--
--   ADR-0014 floor    ceil(0.09 / 0.0165)  = ceil(5.45) = 6
--   ADR-0037 formula  ceil(0.09 / 0.01796) = ceil(5.01) = 6
--                     0.01796 = 0.043 x (1 - 0.08 - 0.50) - 0.30 / 3000
--
-- Both rules give 6 credits: 54.5% margin at the $0.033 reference credit,
-- 56.9% contribution at the $129/3000 pack after the assumed payment fee.
--
-- Not yet known: whether fal counts the voice description (up to 500
-- characters) towards the billed characters. If it does, the worst case is
-- 1500 characters = $0.135, which needs 9 credits, not 6. The live run below
-- settles it; the activation migration carries the price that run supports.
--
-- INACTIVE. CLAUDE.md (Money & billing): a model is only `active = true` once
-- its provider_endpoint has been verified against the live provider. The queue
-- schema was checked live on 2026-10-09 (scripts/check-capabilities.mjs). Still
-- to do before a separate activation migration: one real generation of a
-- 1000-character text, confirming that the audio is not cut short (the record
-- pins max_new_tokens to 8192; fal's default of 200 stops at 16s), that fal's
-- usage page billed $0.09, and that the result is served from a fal.media
-- host. And one short line, confirming it gives a clip of seconds, not the
-- 655s the pin allows.
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('qwen-3-tts-voice-design', 'Qwen 3 TTS Voice Design (describe the voice)', 'fal', 'fal-ai/qwen-3-tts/voice-design/1.7b', 'text-to-speech', 6, 0.0900, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
