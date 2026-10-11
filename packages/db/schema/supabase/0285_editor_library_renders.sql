-- ADR-0089: private, inspected editor exports; no generated-source or ledger writes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.editor_library_renders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 label TEXT NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 160 AND label !~ '[[:cntrl:]]'),
 r2_key TEXT NOT NULL UNIQUE CHECK(r2_key ~ '^editor-renders/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),
 request_key TEXT NOT NULL CHECK(request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
 state TEXT NOT NULL DEFAULT 'quarantined' CHECK(state IN ('quarantined','stored','removed')),
 width INTEGER CHECK(width BETWEEN 1 AND 4096), height INTEGER CHECK(height BETWEEN 1 AND 4096),
 seconds NUMERIC CHECK(seconds>0 AND seconds<=600), frame_rate INTEGER CHECK(frame_rate IN (24,25,30,50,60)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
 inspected_at TIMESTAMPTZ,
 UNIQUE(owner_id,request_key),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '90 days'),
 CHECK(state<>'stored' OR (owner_id IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND seconds IS NOT NULL AND frame_rate IS NOT NULL AND inspected_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS editor_library_renders_owner_idx ON public.editor_library_renders(owner_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS editor_library_renders_expiry_idx ON public.editor_library_renders(expires_at);
ALTER TABLE public.editor_library_renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_library_renders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.editor_library_renders FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT(id,owner_id,label,r2_key,sha256,size_bytes,state,width,height,seconds,frame_rate,created_at,expires_at,inspected_at) ON public.editor_library_renders TO authenticated;
DROP POLICY IF EXISTS editor_render_read ON public.editor_library_renders;
CREATE POLICY editor_render_read ON public.editor_library_renders FOR SELECT TO authenticated
 USING(owner_id=auth.uid() AND state<>'removed' AND expires_at>now());

CREATE OR REPLACE FUNCTION private.editor_render_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.r2_key IS DISTINCT FROM OLD.r2_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256
  OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.label IS DISTINCT FROM OLD.label
  OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR (NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id IS NOT NULL) THEN
  RAISE EXCEPTION 'IMMUTABLE_RENDER' USING ERRCODE='PT409';
 END IF;
 -- The FK clears identity on Auth deletion. Keep the key until its PUT expired.
 IF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL THEN
  NEW.state:='removed'; NEW.expires_at:=least(OLD.created_at+interval '90 days',greatest(now(),OLD.created_at+interval '16 minutes'));
 END IF;
 IF (OLD.state='removed' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id) OR (OLD.state='stored' AND NEW.state<>'removed') THEN
  RAISE EXCEPTION 'VERDICT_FINAL' USING ERRCODE='PT409';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS editor_render_guard ON public.editor_library_renders;
CREATE TRIGGER editor_render_guard BEFORE UPDATE ON public.editor_library_renders FOR EACH ROW EXECUTE FUNCTION private.editor_render_guard();
REVOKE ALL ON FUNCTION private.editor_render_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.reserve_editor_library_render(p_label TEXT,p_sha256 TEXT,p_size_bytes BIGINT,p_rights_confirmed BOOLEAN,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_user UUID; v_rate JSONB; v_row public.editor_library_renders%ROWTYPE; v_id UUID;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=actor::text AND frozen_at IS NULL FOR UPDATE;
 IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160 OR p_label ~ '[[:cntrl:]]'
  OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 26214400
  OR p_rights_confirmed IS DISTINCT FROM true OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
  RAISE EXCEPTION 'INVALID_RENDER' USING ERRCODE='PT400';
 END IF;
 SELECT * INTO v_row FROM public.editor_library_renders WHERE owner_id=actor AND request_key=p_idempotency_key;
 IF FOUND THEN
  IF v_row.label<>btrim(p_label) OR v_row.sha256<>p_sha256 OR v_row.size_bytes<>p_size_bytes OR v_row.state='removed' OR v_row.expires_at<=now() THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('id',v_row.id,'r2_key',v_row.r2_key,'state',v_row.state,'created_at',v_row.created_at,'idempotent',true);
 END IF;
 v_rate:=public.consume_upload_request(actor::text);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 IF (SELECT count(*) FROM public.editor_library_renders WHERE owner_id=actor)>=100
  OR (SELECT coalesce(sum(size_bytes),0) FROM public.editor_library_renders WHERE owner_id=actor)+p_size_bytes>209715200 THEN
  RAISE EXCEPTION 'RENDER_LIMIT' USING ERRCODE='PT429';
 END IF;
 v_id:=gen_random_uuid();
 INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key)
 VALUES(v_id,actor,btrim(p_label),'editor-renders/'||actor::text||'/'||v_id::text||'.mp4',p_sha256,p_size_bytes,p_idempotency_key) RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'r2_key',v_row.r2_key,'state',v_row.state,'created_at',v_row.created_at,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.reserve_editor_library_render(p_label TEXT,p_sha256 TEXT,p_size_bytes BIGINT,p_rights_confirmed BOOLEAN,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.reserve_editor_library_render(p_label,p_sha256,p_size_bytes,p_rights_confirmed,p_idempotency_key);
$$;

CREATE OR REPLACE FUNCTION private.read_editor_library_renders(p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_user UUID; v_rate JSONB; v_rows JSONB;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=actor::text;
 IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 v_rate:=public.consume_job_read_request(v_user);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m)-'owner_id'-'request_key' ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb) INTO v_rows
 FROM (SELECT * FROM public.editor_library_renders WHERE owner_id=actor AND expires_at>now() AND state<>'removed'
  AND ((p_id IS NULL AND state='stored') OR id=p_id) ORDER BY created_at DESC,id DESC LIMIT 100) m;
 RETURN jsonb_build_object('renders',v_rows);
END $$;
CREATE OR REPLACE FUNCTION public.read_editor_library_renders(p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.read_editor_library_renders(p_id); $$;

CREATE OR REPLACE FUNCTION private.remove_editor_library_render(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_row public.editor_library_renders%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT * INTO v_row FROM public.editor_library_renders WHERE id=p_id AND owner_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF v_row.state='removed' THEN RETURN jsonb_build_object('id',p_id,'removed',true,'idempotent',true); END IF;
 UPDATE public.editor_library_renders SET state='removed',expires_at=least(created_at+interval '90 days',greatest(now(),created_at+interval '16 minutes')) WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'removed',true,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.remove_editor_library_render(p_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.remove_editor_library_render(p_id); $$;

CREATE OR REPLACE FUNCTION public.record_editor_render_inspection(p_id UUID,p_sha256 TEXT,p_size_bytes BIGINT,p_width INTEGER,p_height INTEGER,p_seconds NUMERIC,p_frame_rate INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.editor_library_renders%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.editor_library_renders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_row.owner_id IS NULL OR v_row.state='removed' OR v_row.expires_at<=now()
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=v_row.owner_id::text AND frozen_at IS NULL) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';
 END IF;
 IF p_sha256 IS DISTINCT FROM v_row.sha256 OR p_size_bytes IS DISTINCT FROM v_row.size_bytes
  OR p_width IS NULL OR p_width NOT BETWEEN 1 AND 4096 OR p_height IS NULL OR p_height NOT BETWEEN 1 AND 4096
  OR p_seconds IS NULL OR p_seconds<=0 OR p_seconds>600 OR p_frame_rate IS NULL OR p_frame_rate NOT IN (24,25,30,50,60) THEN
  RAISE EXCEPTION 'INVALID_RENDER' USING ERRCODE='PT400';
 END IF;
 IF v_row.state='stored' THEN
  IF v_row.width<>p_width OR v_row.height<>p_height OR v_row.seconds<>p_seconds OR v_row.frame_rate<>p_frame_rate THEN
   RAISE EXCEPTION 'VERDICT_FINAL' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('id',p_id,'state','stored','idempotent',true);
 END IF;
 UPDATE public.editor_library_renders SET state='stored',width=p_width,height=p_height,seconds=p_seconds,frame_rate=p_frame_rate,
  inspected_at=now(),expires_at=created_at+interval '90 days' WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'state','stored','idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.expire_editor_library_renders(p_batch_size INTEGER DEFAULT 100)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_moved INTEGER;
BEGIN
 WITH doomed AS (SELECT id,r2_key FROM public.editor_library_renders WHERE expires_at<=now()
  ORDER BY expires_at LIMIT least(greatest(coalesce(p_batch_size,100),1),500) FOR UPDATE SKIP LOCKED),
 queued AS (INSERT INTO public.asset_reap_queue(r2_key) SELECT r2_key FROM doomed ON CONFLICT(r2_key) DO NOTHING RETURNING 1),
 dropped AS (DELETE FROM public.editor_library_renders WHERE id IN(SELECT id FROM doomed) RETURNING 1)
 SELECT count(*) INTO v_moved FROM dropped;
 RETURN v_moved;
END $$;
REVOKE ALL ON FUNCTION private.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),public.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),private.read_editor_library_renders(UUID),public.read_editor_library_renders(UUID),private.remove_editor_library_render(UUID),public.remove_editor_library_render(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),public.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),private.read_editor_library_renders(UUID),public.read_editor_library_renders(UUID),private.remove_editor_library_render(UUID),public.remove_editor_library_render(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.record_editor_render_inspection(UUID,TEXT,BIGINT,INTEGER,INTEGER,NUMERIC,INTEGER),public.expire_editor_library_renders(INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_editor_render_inspection(UUID,TEXT,BIGINT,INTEGER,INTEGER,NUMERIC,INTEGER),public.expire_editor_library_renders(INTEGER) TO service_role;
SELECT cron.schedule('veyrnox-expire-editor-renders','*/15 * * * *',$cron$ SELECT public.expire_editor_library_renders(100); $cron$)
 WHERE NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='veyrnox-expire-editor-renders' AND schedule='*/15 * * * *'
  AND command=$cron$ SELECT public.expire_editor_library_renders(100); $cron$);
COMMIT;
