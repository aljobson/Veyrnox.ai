-- ADR-0245: owner-only, mutable Film Studio saves. Preserve the exact JSON text.
BEGIN;
CREATE TABLE IF NOT EXISTS public.film_studio_projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    film_json text NOT NULL CHECK (octet_length(film_json) <= 1000000),
    shot_count integer NOT NULL CHECK (shot_count BETWEEN 0 AND 200),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    create_key text NOT NULL,
    last_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, create_key)
);
CREATE INDEX IF NOT EXISTS film_studio_projects_owner_updated_idx
    ON public.film_studio_projects(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS private.film_studio_save_windows (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    minute_start timestamptz NOT NULL,
    minute_count integer NOT NULL CHECK (minute_count >= 0),
    day_start timestamptz NOT NULL,
    day_count integer NOT NULL CHECK (day_count >= 0)
);
ALTER TABLE public.film_studio_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_studio_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE private.film_studio_save_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.film_studio_save_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.film_studio_projects, private.film_studio_save_windows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,name,film_json,shot_count,revision,created_at,updated_at) ON public.film_studio_projects TO authenticated;
DROP POLICY IF EXISTS film_studio_owner_read ON public.film_studio_projects;
CREATE POLICY film_studio_owner_read ON public.film_studio_projects
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.save_film_studio(project uuid, expected integer, content text, project_name text, request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    actor uuid := auth.uid();
    parsed jsonb;
    saved public.film_studio_projects;
    windows private.film_studio_save_windows;
    replay boolean := false;
    stamp timestamptz := pg_catalog.now();
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 360));
    IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$'
       OR project_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(project_name)) NOT BETWEEN 1 AND 120
       OR content IS NULL OR pg_catalog.octet_length(content) > 1000000
       OR expected IS NULL OR (project IS NULL AND expected <> 0)
       OR (project IS NOT NULL AND (expected < 1 OR expected = 2147483647)) THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;
    BEGIN
        parsed := content::jsonb;
    EXCEPTION WHEN invalid_text_representation OR untranslatable_character OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END;
    IF pg_catalog.jsonb_typeof(parsed) IS DISTINCT FROM 'object' OR parsed->'schema' IS DISTINCT FROM '1'::jsonb
       OR pg_catalog.jsonb_typeof(parsed->'shots') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;
    IF pg_catalog.jsonb_array_length(parsed->'shots') > 200 THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;
    IF project IS NULL THEN
        SELECT * INTO saved FROM public.film_studio_projects WHERE user_id = actor AND create_key = request_key FOR UPDATE;
        replay := FOUND;
    ELSE
        SELECT * INTO saved FROM public.film_studio_projects WHERE id = project AND user_id = actor FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
        replay := saved.last_key = request_key AND saved.revision = expected + 1;
    END IF;
    IF replay THEN
        IF saved.film_json <> content OR saved.name <> pg_catalog.btrim(project_name) THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'PT409';
        END IF;
    ELSE
        IF project IS NOT NULL AND saved.revision <> expected THEN
            RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'PT409';
        END IF;
        IF project IS NULL AND (SELECT pg_catalog.count(*) FROM public.film_studio_projects WHERE user_id = actor) >= 20 THEN
            RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'PT429', DETAIL = 'film_studio_projects';
        END IF;
        INSERT INTO private.film_studio_save_windows(user_id,minute_start,minute_count,day_start,day_count)
            VALUES(actor,stamp,0,stamp,0) ON CONFLICT (user_id) DO NOTHING;
        SELECT * INTO windows FROM private.film_studio_save_windows WHERE user_id = actor FOR UPDATE;
        IF stamp >= windows.minute_start + interval '1 minute' THEN windows.minute_start := stamp; windows.minute_count := 0; END IF;
        IF stamp >= windows.day_start + interval '1 day' THEN windows.day_start := stamp; windows.day_count := 0; END IF;
        IF windows.minute_count >= 30 OR windows.day_count >= 500 THEN
            RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429';
        END IF;
        UPDATE private.film_studio_save_windows SET minute_start = windows.minute_start, minute_count = windows.minute_count + 1,
            day_start = windows.day_start, day_count = windows.day_count + 1 WHERE user_id = actor;
        IF project IS NULL THEN
            INSERT INTO public.film_studio_projects(user_id,name,film_json,shot_count,create_key,last_key)
                VALUES(actor,pg_catalog.btrim(project_name),content,pg_catalog.jsonb_array_length(parsed->'shots'),request_key,request_key)
                RETURNING * INTO saved;
        ELSE
            UPDATE public.film_studio_projects SET name = pg_catalog.btrim(project_name), film_json = content,
                shot_count = pg_catalog.jsonb_array_length(parsed->'shots'), revision = revision + 1,
                last_key = request_key, updated_at = stamp WHERE id = project AND user_id = actor RETURNING * INTO saved;
        END IF;
    END IF;
    RETURN pg_catalog.jsonb_build_object('id',saved.id,'name',saved.name,'shot_count',saved.shot_count,
        'revision',saved.revision,'created_at',saved.created_at,'updated_at',saved.updated_at,'idempotent',replay);
END $$;

CREATE OR REPLACE FUNCTION private.remove_film_studio(project uuid, expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); saved public.film_studio_projects;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    IF project IS NULL OR expected IS NULL OR expected < 1 THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 360));
    SELECT * INTO saved FROM public.film_studio_projects WHERE id = project AND user_id = actor FOR UPDATE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('removed',true,'idempotent',true); END IF;
    IF saved.revision <> expected THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'PT409'; END IF;
    DELETE FROM public.film_studio_projects WHERE id = project AND user_id = actor;
    RETURN pg_catalog.jsonb_build_object('removed',true);
END $$;

CREATE OR REPLACE FUNCTION public.save_film_studio(p_id uuid, p_expected_revision integer, p_film text, p_name text, p_idempotency_key text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.save_film_studio(p_id,p_expected_revision,p_film,p_name,p_idempotency_key);
$$;
CREATE OR REPLACE FUNCTION public.remove_film_studio(p_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.remove_film_studio(p_id,p_expected_revision);
$$;
REVOKE ALL ON FUNCTION private.save_film_studio(uuid,integer,text,text,text), private.remove_film_studio(uuid,integer),
    public.save_film_studio(uuid,integer,text,text,text), public.remove_film_studio(uuid,integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_film_studio(uuid,integer,text,text,text), private.remove_film_studio(uuid,integer),
    public.save_film_studio(uuid,integer,text,text,text), public.remove_film_studio(uuid,integer) TO authenticated;
COMMIT;
