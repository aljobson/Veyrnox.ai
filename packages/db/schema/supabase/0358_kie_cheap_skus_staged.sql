-- ADR-0238. Supplier contracts/rates checked 2026-10-20; no live verification.
-- All four rows stay inactive. Costs are TOTAL per generation (0029/0327),
-- not the supplier per-second rates: Kling $0.07/s; Seedance Mini $0.041/s.
-- A replay preserves later activation/repricing; existing identities must match.
DO $$
DECLARE
    candidate RECORD;
    inserted public.model_catalog%ROWTYPE;
    identity_row RECORD;
    reservation NUMERIC;
BEGIN
    FOR candidate IN SELECT * FROM (VALUES
        ('kling-3.0-i2v-720p-kie', 'Kling 3.0 Standard I2V (kie, no audio)', 'market:kling-3.0/video-std', 'image-to-video', 22, 0.3500, 'per_second', 5::numeric),
        ('seedance-2.0-mini-kie', 'Seedance 2.0 Mini (kie, 720p)', 'market:bytedance/seedance-2-mini', 'text-to-video', 13, 0.2050, 'per_second', 5::numeric),
        ('wan-2.6-flash-i2v-kie', 'Wan 2.6 Flash I2V (kie, no audio)', 'market:wan/2-6-flash-image-to-video', 'image-to-video', 7, 0.1000, 'per_generation', NULL::numeric),
        ('seedream-5-flash-kie', 'Seedream 5 Flash (kie, 1K)', 'market:seedream/5-flash-text-to-image', 'text-to-image', 1, 0.0162, 'per_generation', NULL::numeric)
    ) AS expected(id, name, endpoint, modality, credits, cost, cost_unit, billing_seconds)
    LOOP
        INSERT INTO public.model_catalog
            (id, name, provider, provider_endpoint, modality, credits_5s,
             provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
        VALUES (candidate.id, candidate.name, 'kie', candidate.endpoint, candidate.modality,
                candidate.credits, candidate.cost, candidate.cost_unit, candidate.billing_seconds, false, false)
        ON CONFLICT (id) DO NOTHING
        RETURNING * INTO inserted;

        -- FOUND applies only to this INSERT, so later values are never asserted.
        IF FOUND THEN
            -- 0327 reserves stored total * purchased units, never * billing_seconds.
            reservation := inserted.provider_cost_per_unit * GREATEST(1,
                CEIL(candidate.credits::numeric / inserted.credits_5s));
            IF inserted.active IS DISTINCT FROM false OR inserted.gated_flag IS DISTINCT FROM false
               OR inserted.credits_5s IS DISTINCT FROM candidate.credits
               OR inserted.provider_cost_per_unit IS DISTINCT FROM candidate.cost
               OR inserted.cost_unit IS DISTINCT FROM candidate.cost_unit
               OR inserted.billing_seconds IS DISTINCT FROM candidate.billing_seconds
               OR inserted.credits_5s < CEIL(candidate.cost / 0.01796)
               OR reservation IS DISTINCT FROM candidate.cost THEN
                RAISE EXCEPTION 'Invalid staged kie price or state for %', candidate.id;
            END IF;
        END IF;

        SELECT id, provider, provider_endpoint, modality INTO identity_row
          FROM public.model_catalog WHERE id = candidate.id;
        IF NOT FOUND OR identity_row.provider IS DISTINCT FROM 'kie'
           OR identity_row.provider_endpoint IS DISTINCT FROM candidate.endpoint
           OR identity_row.modality IS DISTINCT FROM candidate.modality THEN
            RAISE EXCEPTION 'Conflicting staged kie identity for %', candidate.id;
        END IF;
    END LOOP;
END $$;
