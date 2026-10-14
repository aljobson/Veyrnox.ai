-- Persist bounded editor timeline markers introduced by the creator editing workflow.
-- Keep the final 0286 folders/fonts contract and extend only the v3 timeline envelope.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_timeline_within_bounds(t jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN t->'schemaVersion' = '3'::jsonb THEN
        CASE WHEN jsonb_typeof(t) IS DISTINCT FROM 'object'
            OR jsonb_typeof(t->'seq') IS DISTINCT FROM 'number'
            OR jsonb_typeof(t->'media') IS DISTINCT FROM 'object'
            OR jsonb_typeof(t->'video') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'audio') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'text') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'tracks') IS DISTINCT FROM 'array'
            OR (t ? 'markers' AND jsonb_typeof(t->'markers') IS DISTINCT FROM 'array') THEN false
        ELSE coalesce(
            t - ARRAY['schemaVersion','fps','seq','aspect','media','video','audio','text','tracks','background','folders','fonts','markers'] = '{}'::jsonb
            AND t ?& ARRAY['schemaVersion','fps','seq','aspect','media','video','audio','text','tracks','background']
            AND private.project_editor_organization_within_bounds(t)
            AND t->'fps' = '30'::jsonb
            AND jsonb_typeof(t->'seq') = 'number' AND (t->>'seq')::numeric BETWEEN 0 AND 1000000
            AND coalesce(t->>'aspect','') IN ('source','16:9','9:16','1:1')
            AND coalesce(t->>'background','') ~ '^#[0-9a-fA-F]{6}$'
            AND (SELECT count(*) FROM jsonb_object_keys(t->'media')) <= 40
            AND jsonb_array_length(t->'video') <= 40 AND jsonb_array_length(t->'audio') <= 40
            AND jsonb_array_length(t->'text') <= 150 AND jsonb_array_length(t->'tracks') BETWEEN 3 AND 16
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t->'tracks') lane
                WHERE jsonb_typeof(lane) IS DISTINCT FROM 'object'
                   OR coalesce(lane->>'id','') !~ '^(video|audio|text)-[0-9]{1,7}$'
                   OR coalesce(lane->>'kind','') NOT IN ('video','audio','text')
                   OR jsonb_typeof(lane->'locked') IS DISTINCT FROM 'boolean'
                   OR jsonb_typeof(lane->'muted') IS DISTINCT FROM 'boolean'
                   OR jsonb_typeof(lane->'hidden') IS DISTINCT FROM 'boolean')
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((t->'video') || (t->'audio') || (t->'text')) clip
                WHERE CASE WHEN jsonb_typeof(clip) IS DISTINCT FROM 'object'
                             OR jsonb_typeof(clip->'start') IS DISTINCT FROM 'number'
                             OR jsonb_typeof(clip->'len') IS DISTINCT FROM 'number' THEN true
                    ELSE (clip->>'start')::numeric < 0 OR (clip->>'len')::numeric < 1
                      OR (clip->>'start')::numeric + (clip->>'len')::numeric > 18000
                      OR (clip->>'start')::numeric <> trunc((clip->>'start')::numeric)
                      OR (clip->>'len')::numeric <> trunc((clip->>'len')::numeric) END)
            AND (NOT (t ? 'markers') OR (
                jsonb_array_length(t->'markers') <= 100
                AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t->'markers') marker
                    WHERE CASE WHEN jsonb_typeof(marker) IS DISTINCT FROM 'object'
                                 OR marker - ARRAY['id','frame','label','color'] <> '{}'::jsonb
                                 OR NOT (marker ?& ARRAY['id','frame','label','color'])
                                 OR jsonb_typeof(marker->'id') IS DISTINCT FROM 'string'
                                 OR jsonb_typeof(marker->'frame') IS DISTINCT FROM 'number'
                                 OR jsonb_typeof(marker->'label') IS DISTINCT FROM 'string'
                                 OR jsonb_typeof(marker->'color') IS DISTINCT FROM 'string' THEN true
                        ELSE coalesce(marker->>'id','') !~ '^m[0-9]{1,7}$'
                          OR (marker->>'frame')::numeric NOT BETWEEN 0 AND 18000
                          OR (marker->>'frame')::numeric <> trunc((marker->>'frame')::numeric)
                          OR coalesce(btrim(marker->>'label'),'') = ''
                          OR char_length(marker->>'label') > 80
                          OR marker->>'label' ~ '[[:cntrl:]]'
                          OR coalesce(marker->>'color','') !~ '^#[0-9a-fA-F]{6}$' END)
                AND NOT EXISTS (SELECT marker->>'id' FROM jsonb_array_elements(t->'markers') marker
                    GROUP BY marker->>'id' HAVING count(*) > 1)))
        , false) END
    ELSE private.project_timeline_v2_within_bounds(t) END;
$$;
REVOKE ALL ON FUNCTION private.project_timeline_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
