-- Model catalog seed - LOCAL AND TEST DATABASES ONLY.
--
-- Production is built exclusively from packages/db/schema/supabase/. This
-- file exists so a fresh local Postgres has rows to work against.
--
-- It used to end in a DO UPDATE that overwrote credits_5s and active, and
-- scripts/migrate.mjs points SCHEMA_DIR at this directory. Anyone running
-- `npm run migrate` with DATABASE_URL aimed at a real database silently
-- reverted ADR-0014 floor pricing (veo-3.1 122 to 152, wan-2.5 16 to 19,
-- flux-2-pro 2 to 4) and re-activated cosyvoice-2, which supabase/0017
-- deleted - a dead endpoint, so a guaranteed debit-then-refund loop.
--
-- It now takes the DO NOTHING branch: this file may create rows that are
-- absent and can never change a row that exists. The prices below are
-- therefore historical and deliberately unmaintained. The catalog is
-- normative; this is scaffolding.
--
-- An earlier header claimed a margin_floor CI check guarded these values.
-- Nothing reads this file. That claim is removed rather than repaired,
-- because DO NOTHING is the actual guard.

BEGIN;

-- Upsert so re-running the migration doesn't fail on existing rows.
INSERT INTO model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, gated_flag, active)
VALUES
    -- Video (5s clip)
    ('wan-2.5',           'Wan 2.5 / 2.6',            'fal', 'wan-2.5',           'text-to-video', 19, 0.25, false, true),
    ('seedance-2.0-fast', 'Seedance 2.0 (Fast)',      'fal', 'seedance-2.0-fast', 'text-to-video', 37, 0.45, false, true),
    ('kling-2.6-pro',     'Kling 2.6 Pro',            'fal', 'kling-2.6-pro',     'text-to-video', 28, 0.35, false, true),
    ('kling-3.0',         'Kling 3.0 / Omni',         'fal', 'kling-3.0',         'text-to-video', 40, 0.50, false, true),
    ('hailuo-02',         'MiniMax Hailuo 02 / 2.3',  'fal', 'hailuo-02',         'text-to-video', 25, 0.30, false, true),
    ('veo-3.1',           'Veo 3.1',                  'fal', 'veo-3.1',           'text-to-video', 152, 2.00, true, true),

    -- Image
    ('flux-2-pro',        'Flux.2 [pro]',             'fal', 'flux-2-pro',        'text-to-image',  4, 0.03, false, true),
    ('seedream-4.5',      'Seedream 4.5 / 5.0',       'fal', 'seedream-4.5',      'text-to-image',  4, 0.04, false, true),
    ('nano-banana',       'Nano Banana / Pro',        'fal', 'nano-banana',       'text-to-image',  6, 0.06, false, true),

    -- Audio
    ('cosyvoice-2',       'CosyVoice2 (Alibaba TTS)', 'fal', 'cosyvoice-2',       'text-to-audio',  2, 0.012, false, true),
    ('ace-step',          'ACE-Step (music/SFX)',     'fal', 'ace-step',          'text-to-audio',  2, 0.010, false, true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
