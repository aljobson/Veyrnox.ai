-- Two Toolkit rows on fal, both INACTIVE: video to audio and video upscale.
-- Prices read from the fal model pages on 2026-10-05. Credits are the
-- ADR-0014 floor, ceil(cost / 0.0165).
--
--   mmaudio-v2-video     "$0.001 per second" of generated audio. The audio
--                        length is pinned to 8s and the source video is
--                        capped at 8s, so one job is at most $0.008      -> 1
--   topaz-upscale-video  "$0.01 per second up to 720p, $0.02 from 720p to
--                        1080p, $0.08 above 1080p output; doubles at 60fps".
--                        Pinned: 2x, 30 fps, source capped at 10s. The
--                        catalog price is flat, so it is the worst tier
--                        (a source above 540p lands above 1080p):
--                        $0.08 x 10s = $0.80                             -> 49
--                        A flat price over-charges a small source; a tiered
--                        price needs the source's size at quote time and is
--                        a decision for the owner, not made here.
--
-- Both are INACTIVE. CLAUDE.md (Money & billing): a model is only `active = true`
-- once its provider_endpoint has been verified against the live provider. Run
-- one real generation of each on staging, confirm fal's usage page billed the
-- cost above (a wrong tier is a silent margin leak), then activate in a
-- separate migration. The capability entries are in lib/modelCapabilities.js.
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('mmaudio-v2-video', 'MMAudio v2 (video to audio, up to 8s)', 'fal', 'fal-ai/mmaudio-v2', 'video-to-video', 1, 0.0080, 'per_generation', NULL, false, false),
    ('topaz-upscale-video', 'Topaz Video Upscale 2x (up to 10s)', 'fal', 'fal-ai/topaz/upscale/video', 'video-to-video', 49, 0.8000, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
