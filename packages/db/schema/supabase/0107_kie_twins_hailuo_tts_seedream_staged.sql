-- Stage kie.ai twins of three more fal rows, INACTIVE (ADR-0020).
--
-- kie's rate card (api.kie.ai/client/v1/model-pricing/page, read 2026-09-24)
-- lists each below what the catalog records for the fal row. Credits are the
-- ADR-0014 floor, ceil(cost / 0.0165), as 0104 and 0105 set.
--
--   row                        fal row (credits, cost)             kie cost  credits
--   hailuo-02-kie              minimax-hailuo-02   17, $0.27 (6s)   $0.15      10   6s 768p clip
--   elevenlabs-tts-turbo-kie   elevenlabs-tts-turbo 4, $0.05        $0.03       2   per 1000 characters
--   seedream-4.5-kie           seedream-4           3, $0.04        $0.0325     2   2K ('basic') tier
--
-- Seedream is a model upgrade (4 -> 4.5), and fal's own Seedream 4 price may now
-- be nearer $0.03 than the $0.04 the catalog records, so its saving is the
-- smallest of the three and only holds against the recorded cost.
--
-- Every row is INACTIVE. CLAUDE.md (Money & billing): a model is only
-- `active = true` once its provider_endpoint has been verified against the live
-- provider. For each row, run
--   node scripts/verify-kie-endpoints.mjs --submit --only=<id>
-- with KIE_API_KEY set, confirm kie's dashboard charged the cost above (a wrong
-- tier is a silent margin leak) and, for speech, that the voice is the one fal
-- users hear today (Rachel), then activate in a separate migration that swaps
-- the fal twin off, as 0075 and 0106 did.
--
-- Hailuo, Seedream and the speech row send kie's content filter where it has
-- one (nsfw_checker defaults to false = off, kie docs).
--
-- Not staged: ElevenLabs Dialogue (a dialogue-script mapping, small saving) and
-- Nano Banana Pro Edit (the same kie model as Nano Banana Pro, so it needs its
-- own endpoint key).
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('hailuo-02-kie', 'MiniMax Hailuo 02 (kie)', 'kie', 'market:hailuo/02-text-to-video-standard', 'text-to-video', 10, 0.1500, 'per_second', 6, false, false),
    ('elevenlabs-tts-turbo-kie', 'ElevenLabs TTS Turbo 2.5 (kie)', 'kie', 'market:elevenlabs/text-to-speech-turbo-2-5', 'text-to-speech', 2, 0.0300, 'per_generation', NULL, false, false),
    ('seedream-4.5-kie', 'Seedream 4.5 (kie)', 'kie', 'market:seedream/4.5-text-to-image', 'text-to-image', 2, 0.0325, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
