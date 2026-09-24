-- ElevenLabs dialogue v3 on fal (upstream review, 2026-09-22): several
-- speakers in one audio clip. The prompt is a "Name: line" script; the
-- gateway turns it into speaker blocks (lib/dialogue.js), up to four voices.
-- Price read from the fal model page on 2026-09-22: $0.10 per 1000
-- characters; the script is capped at 1000 characters, so $0.10 at most.
-- Credits at the 50% floor, $0.033 per credit: ceil(0.10 / 0.0165) = 7.
--
-- A live generation runs straight after this applies; if it fails, a
-- follow-up migration switches it off.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('elevenlabs-dialogue', 'ElevenLabs Dialogue v3 (up to 4 voices)', 'fal', 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3', 'text-to-speech', 7, 0.1000, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
