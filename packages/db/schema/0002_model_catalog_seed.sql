-- Seed model_catalog from packages/catalog/index.ts.
--
-- Auto-derived from the LAUNCH + GATE rows of packages/catalog/index.ts.
-- Keep in sync manually until Slice 4 adds a scripts/seed-catalog.mjs
-- that re-emits this file from the TS source. Any drift trips the
-- margin_floor CI check via packages/catalog/margin-validator.test.ts.

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
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    provider_endpoint = EXCLUDED.provider_endpoint,
    modality = EXCLUDED.modality,
    credits_5s = EXCLUDED.credits_5s,
    provider_cost_per_unit = EXCLUDED.provider_cost_per_unit,
    gated_flag = EXCLUDED.gated_flag,
    active = EXCLUDED.active,
    updated_at = now();

COMMIT;
