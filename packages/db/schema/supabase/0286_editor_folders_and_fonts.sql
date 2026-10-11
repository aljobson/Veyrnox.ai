-- ADR-0090: persist empty folder paths and metadata for local, licensed fonts.
-- Original v2/v3 constraints, writer ACLs, history and byte limits remain intact.
BEGIN;
CREATE OR REPLACE FUNCTION private.project_editor_organization_within_bounds(t jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE p jsonb; f jsonb; r jsonb; c jsonb; s text; k text;
BEGIN
    IF t ? 'folders' THEN
        IF jsonb_typeof(t->'folders') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        IF jsonb_array_length(t->'folders') > 40 OR
            (SELECT count(DISTINCT value) FROM jsonb_array_elements(t->'folders')) <> jsonb_array_length(t->'folders') THEN RETURN false; END IF;
        FOR p IN SELECT value FROM jsonb_array_elements(t->'folders') LOOP
            IF jsonb_typeof(p) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
            s := p #>> '{}';
            IF char_length(s) NOT BETWEEN 1 AND 80 OR s ~ '[[:cntrl:]:*?<>|]' OR position(chr(92) in s) > 0 OR cardinality(string_to_array(s,'/')) > 4 THEN RETURN false; END IF;
            FOREACH k IN ARRAY string_to_array(s,'/') LOOP
                IF k = '' OR k <> btrim(k) OR k IN ('.','..') THEN RETURN false; END IF;
            END LOOP;
        END LOOP;
    END IF;
    IF t ? 'fonts' THEN
        IF jsonb_typeof(t->'fonts') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        IF jsonb_array_length(t->'fonts') > 8 OR
            (SELECT count(DISTINCT value->>'family') FROM jsonb_array_elements(t->'fonts')) <> jsonb_array_length(t->'fonts') THEN RETURN false; END IF;
        FOR f IN SELECT value FROM jsonb_array_elements(t->'fonts') LOOP
            IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR f - ARRAY['family','name','sourceName','sha256','bytes','format','rights'] <> '{}'::jsonb
                OR NOT (f ?& ARRAY['family','name','sourceName','sha256','bytes','format','rights']) THEN RETURN false; END IF;
            FOREACH k IN ARRAY ARRAY['family','name','sourceName','sha256','format'] LOOP
                IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR (f->>k) ~ '[[:cntrl:]]' THEN RETURN false; END IF;
            END LOOP;
            IF char_length(f->>'name') NOT BETWEEN 1 AND 80 OR btrim(f->>'name') = '' OR char_length(f->>'sourceName') NOT BETWEEN 1 AND 255
                OR (f->>'sha256') !~ '^[a-f0-9]{64}$' OR (f->>'family') <> 'VXFont_' || (f->>'sha256')
                OR (f->>'format') NOT IN ('ttf','otf','woff','woff2') OR jsonb_typeof(f->'bytes') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
            IF (f->>'bytes')::numeric NOT BETWEEN 12 AND 2097152 OR (f->>'bytes')::numeric <> trunc((f->>'bytes')::numeric) THEN RETURN false; END IF;
            r := f->'rights';
            IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r - ARRAY['credit','usage','url'] <> '{}'::jsonb
                OR NOT (r ?& ARRAY['credit','usage','url']) THEN RETURN false; END IF;
            FOREACH k IN ARRAY ARRAY['credit','usage','url'] LOOP
                IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR (r->>k) ~ '[[:cntrl:]]' THEN RETURN false; END IF;
            END LOOP;
            IF char_length(r->>'credit') > 120 OR char_length(r->>'usage') > 240 OR btrim(r->>'usage') = '' OR char_length(r->>'url') > 1000
                OR ((r->>'url') <> '' AND (r->>'url') !~ '^https://[^/?#@[:space:]]+([/?#]|$)') THEN RETURN false; END IF;
        END LOOP;
    END IF;
    IF jsonb_typeof(t->'text') = 'array' THEN
        FOR c IN SELECT value FROM jsonb_array_elements(t->'text') LOOP
            s := c->'style'->>'font';
            IF s LIKE 'VXFont_%' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(t->'fonts','[]'::jsonb)) AS declared(font) WHERE declared.font->>'family' = s) THEN RETURN false; END IF;
        END LOOP;
    END IF;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.project_editor_organization_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.project_timeline_within_bounds(t jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN t->'schemaVersion' = '3'::jsonb THEN
        CASE WHEN jsonb_typeof(t) IS DISTINCT FROM 'object'
            OR jsonb_typeof(t->'seq') IS DISTINCT FROM 'number'
            OR jsonb_typeof(t->'media') IS DISTINCT FROM 'object'
            OR jsonb_typeof(t->'video') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'audio') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'text') IS DISTINCT FROM 'array'
            OR jsonb_typeof(t->'tracks') IS DISTINCT FROM 'array' THEN false
        ELSE coalesce(
            t - ARRAY['schemaVersion','fps','seq','aspect','media','video','audio','text','tracks','background','folders','fonts'] = '{}'::jsonb
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
        , false) END
    ELSE private.project_timeline_v2_within_bounds(t) END;
$$;
REVOKE ALL ON FUNCTION private.project_timeline_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
