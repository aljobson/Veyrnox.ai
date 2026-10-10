-- ADR-0085: verified, operator-imported Film Studio masters; no generation or ledger writes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.film_library_masters (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 source_job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 label TEXT NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 160),
 r2_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
 width INTEGER NOT NULL CHECK(width=1920), height INTEGER NOT NULL CHECK(height=1080),
 seconds NUMERIC NOT NULL CHECK(seconds>0 AND seconds<=60),
 frame_rate INTEGER NOT NULL CHECK(frame_rate=24),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
 UNIQUE(user_id,source_job_id,sha256),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '90 days')
);
CREATE INDEX IF NOT EXISTS film_library_masters_owner_idx ON public.film_library_masters(user_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS film_library_masters_expiry_idx ON public.film_library_masters(expires_at);
ALTER TABLE public.film_library_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_library_masters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.film_library_masters FROM PUBLIC,anon,authenticated,service_role;

-- This service-role-only import follows an operator's byte/hash/decoded-media checks.
-- There is intentionally no public HTTP upload route or scanner exception for arbitrary files.
CREATE OR REPLACE FUNCTION public.store_film_library_master(
 p_auth_id TEXT,p_id UUID,p_source_job_id UUID,p_source_sha256 TEXT,p_label TEXT,
 p_sha256 TEXT,p_size_bytes BIGINT,p_seconds NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_source_expiry TIMESTAMPTZ; v_existing public.film_library_masters%ROWTYPE; v_key TEXT;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND frozen_at IS NULL FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_id IS NULL OR p_source_job_id IS NULL OR p_source_sha256 IS NULL OR p_sha256 IS NULL
  OR p_source_sha256 !~ '^[0-9a-f]{64}$' OR p_sha256 !~ '^[0-9a-f]{64}$'
  OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160
  OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 26214400
  OR p_seconds IS NULL OR p_seconds<=0 OR p_seconds>60 THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_MASTER');
 END IF;
 SELECT min(a.expires_at) INTO v_source_expiry FROM public.assets a
 JOIN public.jobs j ON j.id=a.job_id
 WHERE j.id=p_source_job_id AND j.user_id=v_user AND j.state='STORED'
  AND a.mime_type='video/mp4' AND a.sha256=p_source_sha256 AND a.expires_at>now();
 IF v_source_expiry IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.film_library_masters
 WHERE user_id=v_user AND source_job_id=p_source_job_id AND sha256=p_sha256;
 IF FOUND THEN
  RETURN jsonb_build_object('ok',true,'id',v_existing.id,'r2_key',v_existing.r2_key,'idempotent',true);
 END IF;
 IF (SELECT count(*) FROM public.film_library_masters WHERE user_id=v_user)>=100 THEN
  RETURN jsonb_build_object('ok',false,'code','MASTER_LIMIT');
 END IF;
 v_key:='film-masters/'||v_user::text||'/'||p_id::text||'.mp4';
 INSERT INTO public.film_library_masters(id,user_id,source_job_id,source_sha256,label,r2_key,sha256,size_bytes,width,height,seconds,frame_rate,expires_at)
 VALUES(p_id,v_user,p_source_job_id,p_source_sha256,btrim(p_label),v_key,p_sha256,p_size_bytes,1920,1080,p_seconds,24,least(v_source_expiry,now()+interval '90 days'));
 RETURN jsonb_build_object('ok',true,'id',p_id,'r2_key',v_key,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.list_film_library_masters(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_rate JSONB; v_rows JSONB;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'masters','[]'::jsonb); END IF;
 v_rate:=public.consume_job_read_request(v_user);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'source_job_id',m.source_job_id,'label',m.label,
  'sha256',m.sha256,'size_bytes',m.size_bytes,'width',m.width,'height',m.height,'seconds',m.seconds,
  'frame_rate',m.frame_rate,'created_at',m.created_at,'expires_at',m.expires_at) ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb)
 INTO v_rows FROM public.film_library_masters m WHERE m.user_id=v_user AND m.expires_at>now();
 RETURN jsonb_build_object('ok',true,'masters',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.get_film_library_master(p_auth_id TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row public.film_library_masters%ROWTYPE;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT * INTO v_row FROM public.film_library_masters WHERE id=p_id AND user_id=v_user AND expires_at>now();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'id',v_row.id,'r2_key',v_row.r2_key,'sha256',v_row.sha256,
  'size_bytes',v_row.size_bytes,'expires_at',v_row.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.expire_film_library_masters(p_batch_size INTEGER DEFAULT 100)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_moved INTEGER;
BEGIN
 WITH doomed AS (SELECT id,r2_key FROM public.film_library_masters WHERE expires_at<=now()
  ORDER BY expires_at LIMIT least(greatest(coalesce(p_batch_size,100),1),500) FOR UPDATE SKIP LOCKED),
 queued AS (INSERT INTO public.asset_reap_queue(r2_key) SELECT r2_key FROM doomed ON CONFLICT(r2_key) DO NOTHING RETURNING 1),
 dropped AS (DELETE FROM public.film_library_masters WHERE id IN (SELECT id FROM doomed) RETURNING 1)
 SELECT count(*) INTO v_moved FROM dropped;
 RETURN v_moved;
END $$;

REVOKE ALL ON FUNCTION public.store_film_library_master(TEXT,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,NUMERIC),public.list_film_library_masters(TEXT),public.get_film_library_master(TEXT,UUID),public.expire_film_library_masters(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_film_library_master(TEXT,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,NUMERIC),public.list_film_library_masters(TEXT),public.get_film_library_master(TEXT,UUID),public.expire_film_library_masters(INTEGER) TO service_role;
SELECT cron.schedule('veyrnox-expire-film-masters','*/15 * * * *',$cron$ SELECT public.expire_film_library_masters(100); $cron$);
COMMIT;
