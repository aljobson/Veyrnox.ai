-- Default-off, owner-fenced receipts for native iPhone audio inspiration.
-- This migration does not enable MUSIC_INSPIRATION_SCHEMA_ENABLED.
BEGIN;

CREATE TABLE public.music_inspiration_requests(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  upload_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),
  request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
  content_digest TEXT NOT NULL CHECK(content_digest~'^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK(status IN('pending','completed','failed_permanent','failed_transient')),
  attempt_id UUID,
  lease_expires_at TIMESTAMPTZ,
  safe BOOLEAN,
  brief TEXT,
  tags JSONB,
  receipt TEXT,
  receipt_issued_at BIGINT,
  receipt_expires_at BIGINT,
  error_code TEXT,
  attempt_count SMALLINT NOT NULL DEFAULT 1 CHECK(attempt_count BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,idempotency_key), UNIQUE(user_id,upload_key),
  CHECK((status='pending')=(attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(status<>'completed' OR (safe IS NOT NULL AND brief IS NOT NULL AND tags IS NOT NULL AND receipt IS NOT NULL
    AND receipt_issued_at IS NOT NULL AND receipt_expires_at IS NOT NULL))
);
CREATE INDEX music_inspiration_daily_idx ON public.music_inspiration_requests(user_id,created_at);
ALTER TABLE public.music_inspiration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_inspiration_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_inspiration_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.music_inspiration_requests TO service_role;

CREATE OR REPLACE FUNCTION private.music_inspiration_json(r public.music_inspiration_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('ok',true,'id',r.id,'status',r.status,'safe',r.safe,'brief',r.brief,
  'tags',r.tags,'receipt',r.receipt,'issued_at',r.receipt_issued_at,
  'expires_at',CASE WHEN r.receipt_expires_at IS NULL THEN NULL ELSE to_char(to_timestamp(r.receipt_expires_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
  'error_code',r.error_code))
$$;
REVOKE ALL ON FUNCTION private.music_inspiration_json(public.music_inspiration_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.music_inspiration_reserve(p_auth_id TEXT,p_upload_key TEXT,p_idempotency_key TEXT,
 p_request_digest TEXT,p_content_digest TEXT,p_lease_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; r public.music_inspiration_requests; a UUID; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' OR p_request_digest!~'^[a-f0-9]{64}$' OR p_content_digest!~'^[a-f0-9]{64}$'
  OR p_upload_key IS NULL OR p_lease_seconds<80 OR p_lease_seconds>120 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':music-inspiration-quota',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':music-inspiration:'||p_idempotency_key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':music-inspiration-source:'||p_upload_key,0));
 SELECT * INTO r FROM public.music_inspiration_requests WHERE user_id=u AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF r.request_digest<>p_request_digest OR r.upload_key<>p_upload_key OR r.content_digest<>p_content_digest THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
  END IF;
  IF r.status IN('completed','failed_permanent') THEN RETURN private.music_inspiration_json(r); END IF;
  IF r.status='pending' AND r.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','IN_PROGRESS','status','pending'); END IF;
  IF r.attempt_count>=3 THEN
   UPDATE public.music_inspiration_requests SET status='failed_permanent',attempt_id=NULL,lease_expires_at=NULL,error_code='retry_limit',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
   RETURN private.music_inspiration_json(r);
  END IF;
  a:=gen_random_uuid();
  UPDATE public.music_inspiration_requests SET status='pending',attempt_id=a,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   attempt_count=attempt_count+1,error_code=NULL,updated_at=clock_timestamp() WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'kind','retry','id',r.id,'attempt_id',a);
 END IF;
 IF EXISTS(SELECT 1 FROM public.music_inspiration_requests WHERE user_id=u AND upload_key=p_upload_key) THEN
  RETURN jsonb_build_object('ok',false,'code','SOURCE_ALREADY_USED');
 END IF;
 IF (SELECT count(*) FROM public.music_inspiration_requests WHERE user_id=u AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=5 THEN
  RETURN jsonb_build_object('ok',false,'code','QUOTA_EXCEEDED');
 END IF;
 a:=gen_random_uuid();
 INSERT INTO public.music_inspiration_requests(user_id,upload_key,idempotency_key,request_digest,content_digest,status,attempt_id,lease_expires_at)
 VALUES(u,p_upload_key,p_idempotency_key,p_request_digest,p_content_digest,'pending',a,clock_timestamp()+make_interval(secs=>p_lease_seconds)) RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'kind','fresh','id',r.id,'attempt_id',a);
END $$;

CREATE OR REPLACE FUNCTION public.music_inspiration_complete(p_auth_id TEXT,p_id UUID,p_attempt_id UUID,p_safe BOOLEAN,
 p_brief TEXT,p_tags JSONB,p_receipt TEXT,p_issued_at BIGINT,p_expires_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; r public.music_inspiration_requests; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 UPDATE public.music_inspiration_requests SET status='completed',attempt_id=NULL,lease_expires_at=NULL,safe=p_safe,brief=p_brief,tags=p_tags,
  receipt=p_receipt,receipt_issued_at=p_issued_at,receipt_expires_at=p_expires_at,error_code=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND user_id=u AND status='pending' AND attempt_id=p_attempt_id RETURNING * INTO r;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','STALE_ATTEMPT'); END IF;
 RETURN private.music_inspiration_json(r);
END $$;

CREATE OR REPLACE FUNCTION public.music_inspiration_fail(p_auth_id TEXT,p_id UUID,p_attempt_id UUID,p_error_code TEXT,p_permanent BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; r public.music_inspiration_requests; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 UPDATE public.music_inspiration_requests SET status=CASE WHEN p_permanent THEN 'failed_permanent' ELSE 'failed_transient' END,
  attempt_id=NULL,lease_expires_at=NULL,error_code=left(p_error_code,80),updated_at=clock_timestamp()
 WHERE id=p_id AND user_id=u AND status='pending' AND attempt_id=p_attempt_id RETURNING * INTO r;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','STALE_ATTEMPT'); END IF;
 RETURN private.music_inspiration_json(r);
END $$;

CREATE OR REPLACE FUNCTION public.music_inspiration_get(p_auth_id TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; r public.music_inspiration_requests; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO r FROM public.music_inspiration_requests WHERE id=p_id AND user_id=u;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN private.music_inspiration_json(r);
END $$;

CREATE OR REPLACE FUNCTION public.music_inspiration_by_key(p_auth_id TEXT,p_idempotency_key TEXT,p_upload_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; r public.music_inspiration_requests; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO r FROM public.music_inspiration_requests WHERE user_id=u AND idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF r.upload_key<>p_upload_key THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 IF r.status='pending' AND r.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','IN_PROGRESS','status','pending'); END IF;
 RETURN private.music_inspiration_json(r);
END $$;

REVOKE ALL ON FUNCTION public.music_inspiration_reserve(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_inspiration_complete(TEXT,UUID,UUID,BOOLEAN,TEXT,JSONB,TEXT,BIGINT,BIGINT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_inspiration_fail(TEXT,UUID,UUID,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_inspiration_get(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_inspiration_by_key(TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_inspiration_reserve(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_inspiration_complete(TEXT,UUID,UUID,BOOLEAN,TEXT,JSONB,TEXT,BIGINT,BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_inspiration_fail(TEXT,UUID,UUID,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_inspiration_get(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_inspiration_by_key(TEXT,TEXT,TEXT) TO service_role;

-- Content-derived briefs, tags, source keys and receipts are erased with the
-- account. They are intentionally not added to the legacy generic export,
-- which has no Music section; the native Music surface remains authoritative.
CREATE OR REPLACE FUNCTION private.music_inspiration_forget_erased_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.music_inspiration_requests WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_inspiration_forget_erased_user() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER users_music_inspiration_forget_erased AFTER UPDATE OF deleted_at ON public.users
FOR EACH ROW EXECUTE FUNCTION private.music_inspiration_forget_erased_user();

-- Keep the authenticated inspiration request visible only as a reviewed,
-- aggregate route pattern. Telemetry never records the upload key or body.
DO $$ BEGIN
  IF to_regprocedure('public.telemetry_path_allowed_pre_0608(text)') IS NULL THEN
    ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0608;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_path = '/api/v1/music/inspiration'
    OR public.telemetry_path_allowed_pre_0608(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
