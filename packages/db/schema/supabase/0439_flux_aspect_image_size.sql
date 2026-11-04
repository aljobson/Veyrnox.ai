-- Admit the five FLUX 2 Pro sizes without changing policy, price or payload bounds.
-- Rollback: restore the prior admission definition (including 0406's bounds)
-- before dropping private.fal_flux_admitted_payload(JSONB). Existing jobs remain.
CREATE OR REPLACE FUNCTION private.fal_flux_admitted_payload(p_payload JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE
        WHEN pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN NULL
        WHEN NOT (p_payload ? 'image_size') THEN
            p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb
        ELSE (
            SELECT p_payload || pg_catalog.jsonb_build_object('image_size', approved.size)
            FROM (VALUES
                ('{"width":960,"height":960}'::jsonb),
                ('{"width":1024,"height":768}'::jsonb),
                ('{"width":768,"height":1024}'::jsonb),
                ('{"width":1024,"height":576}'::jsonb),
                ('{"width":576,"height":1024}'::jsonb)
            ) AS approved(size)
            WHERE p_payload->'image_size' = approved.size
        )
    END
$$;
REVOKE ALL ON FUNCTION private.fal_flux_admitted_payload(JSONB) FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
    definition TEXT;
    fragment RECORD;
    old_count INTEGER;
    new_count INTEGER;
BEGIN
    SELECT pg_get_functiondef(
        'public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure
    ) INTO definition;
    -- Require every expected occurrence, including on replay; never silently
    -- apply only part of this patch to an unfamiliar later function definition.
    FOR fragment IN SELECT * FROM (VALUES
        ($old$p_payload - ARRAY['prompt','seed']$old$,
         $new$p_payload - ARRAY['prompt','seed','image_size']$new$, 2),
        ($old$THEN p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb$old$,
         $new$THEN private.fal_flux_admitted_payload(p_payload)$new$, 1),
        ($old$p_payload := p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb;$old$,
         $new$p_payload := private.fal_flux_admitted_payload(p_payload);$new$, 1),
        ($old$OR jsonb_typeof(p_payload->'prompt') IS DISTINCT FROM 'string'$old$,
         $new$OR private.fal_flux_admitted_payload(p_payload) IS NULL
       OR jsonb_typeof(p_payload->'prompt') IS DISTINCT FROM 'string'$new$, 1),
        ($old$-- Size is pinned by this transaction; only prompt/seed inputs are admitted.$old$,
         $new$-- Validate the chosen size, adding the legacy default only when absent.$new$, 1)
    ) AS patches(old_text, new_text, expected) LOOP
        -- Remove complete new fragments first: some contain the old fragment.
        new_count := (length(definition) - length(replace(definition, fragment.new_text, '')))
            / length(fragment.new_text);
        old_count := (length(replace(definition, fragment.new_text, ''))
            - length(replace(replace(definition, fragment.new_text, ''), fragment.old_text, '')))
            / length(fragment.old_text);
        IF old_count = fragment.expected AND new_count = 0 THEN
            definition := replace(definition, fragment.old_text, fragment.new_text);
        ELSIF old_count <> 0 OR new_count <> fragment.expected THEN
            RAISE EXCEPTION 'admit_fal_dispatch expected fragment not found: %', fragment.old_text;
        END IF;
    END LOOP;
    EXECUTE definition;
END $$;

REVOKE ALL ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN)
    TO service_role;
