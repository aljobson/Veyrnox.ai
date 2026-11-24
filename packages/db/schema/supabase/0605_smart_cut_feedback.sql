-- 0605_smart_cut_feedback.sql
-- Optional, privacy-minimal feedback on an in-memory Smart Cut proposal.
-- No project, job, media, transcript, script, prompt, segment or timing identifier is stored.
BEGIN;

CREATE TABLE IF NOT EXISTS public.smart_cut_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    response_id uuid NOT NULL,
    rating text NOT NULL CHECK (rating IN ('up','down')),
    comment text CHECK (comment IS NULL OR (char_length(comment) BETWEEN 1 AND 1000
        AND translate(comment, E'\t\n\r', '') !~ '[[:cntrl:]]')),
    plan_mode text NOT NULL CHECK (plan_mode IN ('local-preview','transcript-silence')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
    UNIQUE(user_id, response_id),
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS smart_cut_feedback_expiry ON public.smart_cut_feedback(expires_at);
CREATE INDEX IF NOT EXISTS smart_cut_feedback_user_created ON public.smart_cut_feedback(user_id, created_at, id);
ALTER TABLE public.smart_cut_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_cut_feedback FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_cut_feedback FROM PUBLIC, anon, authenticated, service_role;

-- The timestamp is an enforced retention boundary, not merely metadata. Reads
-- also exclude expired rows so a delayed sweep cannot extend their visibility.
CREATE OR REPLACE FUNCTION private.purge_smart_cut_feedback(p_batch_size integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_deleted integer;
BEGIN
    WITH doomed AS (
        SELECT id FROM public.smart_cut_feedback
         WHERE expires_at<=now()
         ORDER BY expires_at,id
         LIMIT least(greatest(coalesce(p_batch_size,5000),1),20000)
         FOR UPDATE SKIP LOCKED
    ), dropped AS (
        DELETE FROM public.smart_cut_feedback f USING doomed d
         WHERE f.id=d.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM dropped;
    RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION private.purge_smart_cut_feedback(integer)
    FROM PUBLIC,anon,authenticated,service_role;
DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RETURN; END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname='veyrnox-purge-smart-cut-feedback';
    PERFORM cron.schedule('veyrnox-purge-smart-cut-feedback','17 * * * *',
        $cmd$ SELECT private.purge_smart_cut_feedback(20000); $cmd$);
END $cron$;

CREATE OR REPLACE FUNCTION public.submit_smart_cut_feedback(
    p_auth_id text, p_response_id uuid, p_rating text, p_comment text, p_plan_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
    v_existing public.smart_cut_feedback;
    v_comment text := nullif(btrim(p_comment), '');
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF p_response_id IS NULL OR p_rating NOT IN ('up','down') OR p_plan_mode NOT IN ('local-preview','transcript-silence')
       OR (v_comment IS NOT NULL AND (char_length(v_comment)>1000
           OR translate(v_comment, E'\t\n\r', '') ~ '[[:cntrl:]]')) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 605));
    DELETE FROM public.smart_cut_feedback WHERE user_id=v_user_id AND expires_at<=now();
    SELECT * INTO v_existing FROM public.smart_cut_feedback
      WHERE user_id=v_user_id AND response_id=p_response_id;
    IF FOUND THEN
        IF v_existing.rating=p_rating AND v_existing.comment IS NOT DISTINCT FROM v_comment
           AND v_existing.plan_mode=p_plan_mode THEN
            RETURN jsonb_build_object('ok',true,'replayed',true);
        END IF;
        RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
    END IF;
    IF (SELECT count(*) FROM public.smart_cut_feedback
          WHERE user_id=v_user_id AND created_at>now()-interval '1 minute') >= 20
       OR (SELECT count(*) FROM public.smart_cut_feedback
          WHERE user_id=v_user_id AND created_at>now()-interval '1 day') >= 200 THEN
        RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED');
    END IF;
    INSERT INTO public.smart_cut_feedback(user_id,response_id,rating,comment,plan_mode)
    VALUES(v_user_id,p_response_id,p_rating,v_comment,p_plan_mode);
    RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.submit_smart_cut_feedback(text,uuid,text,text,text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_smart_cut_feedback(text,uuid,text,text,text) TO service_role;

-- Soft account deletion must erase this optional product-improvement response immediately.
CREATE OR REPLACE FUNCTION private.erase_smart_cut_feedback_for_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        DELETE FROM public.smart_cut_feedback WHERE user_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erase_smart_cut_feedback_for_user() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS users_erase_smart_cut_feedback ON public.users;
CREATE TRIGGER users_erase_smart_cut_feedback
AFTER UPDATE OF deleted_at ON public.users
FOR EACH ROW EXECUTE FUNCTION private.erase_smart_cut_feedback_for_user();

-- Extend the immutable privacy-export chain with this one paged section.
DO $$
BEGIN
    IF to_regprocedure('private.read_privacy_export_page_pre_0605(text,text,uuid,text,uuid,text,text,integer)') IS NULL THEN
        ALTER FUNCTION public.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer) SET SCHEMA private;
        ALTER FUNCTION private.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer)
            RENAME TO read_privacy_export_page_pre_0605;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.read_privacy_export_page_pre_0605(text,text,uuid,text,uuid,text,text,integer)
    FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_privacy_export_page(
    p_auth_id text, p_aal text, p_export_id uuid, p_section text,
    p_thread_id uuid, p_after text, p_key text, p_page_size integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_guard jsonb; v_user_id uuid; v_as_of timestamptz; v_after timestamptz; v_key uuid;
    v_size integer; v_rows jsonb; v_next jsonb;
BEGIN
    IF p_section<>'smart_cut_feedback' THEN
        RETURN private.read_privacy_export_page_pre_0605(
            p_auth_id,p_aal,p_export_id,p_section,p_thread_id,p_after,p_key,p_page_size);
    END IF;
    IF p_thread_id IS NOT NULL OR (p_after IS NULL)<>(p_key IS NULL)
       OR (p_page_size IS NOT NULL AND p_page_size NOT BETWEEN 1 AND 200) THEN
        RETURN jsonb_build_object('ok',false,'error','invalid_section');
    END IF;
    BEGIN
        v_after := CASE WHEN p_after IS NULL THEN NULL ELSE p_after::timestamptz END;
        v_key := CASE WHEN p_key IS NULL THEN NULL ELSE p_key::uuid END;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok',false,'error','invalid_section');
    END;
    -- The previous function remains the single authority for export ownership,
    -- expiry, MFA and account-restriction checks.
    v_guard := private.read_privacy_export_page_pre_0605(
        p_auth_id,p_aal,p_export_id,'profile',NULL,NULL,NULL,1);
    IF v_guard->>'ok'<>'true' THEN RETURN v_guard; END IF;
    SELECT u.id,r.as_of INTO v_user_id,v_as_of
      FROM public.users u JOIN public.privacy_export_requests r ON r.user_id=u.id
     WHERE u.auth_id=p_auth_id AND u.deleted_at IS NULL AND r.id=p_export_id;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','export_not_found'); END IF;
    v_size := least(coalesce(p_page_size,200),200);
    WITH page AS (
        SELECT jsonb_build_object('response_id',f.response_id,'rating',f.rating,'comment',f.comment,
                   'plan_mode',f.plan_mode,'created_at',f.created_at) AS data,
               f.created_at AS ord, f.id AS tie
          FROM public.smart_cut_feedback f
         WHERE f.user_id=v_user_id AND f.created_at<=v_as_of AND f.expires_at>now()
           AND (v_after IS NULL OR (f.created_at,f.id)>(v_after,v_key))
         ORDER BY f.created_at,f.id LIMIT v_size
    )
    SELECT coalesce(jsonb_agg(data ORDER BY ord,tie),'[]'::jsonb),
           (SELECT jsonb_build_object('after',ord,'key',tie)
              FROM page ORDER BY ord DESC,tie DESC LIMIT 1)
      INTO v_rows,v_next FROM page;
    RETURN jsonb_build_object('ok',true,'rows',v_rows,'next',v_next);
END $$;
REVOKE ALL ON FUNCTION public.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer)
    TO service_role;

-- Route-only telemetry may count calls; feedback content never reaches telemetry.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0605(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(text) RENAME TO telemetry_path_allowed_pre_0605;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path='/api/v1/editor/smart-cut-feedback'
        OR public.telemetry_path_allowed_pre_0605(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(text) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
