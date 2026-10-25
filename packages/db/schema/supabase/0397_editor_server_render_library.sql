-- ADR-0261 R7/R9: one asset, shared owner capacity, preservation-aware delivery.
BEGIN;
ALTER TABLE public.asset_reap_queue ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS editor_server_render_output_key_idx ON public.jobs(editor_render_output_key) WHERE provider='concat-render';
CREATE OR REPLACE FUNCTION private.server_render_key_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF OLD.editor_render_output_key IS NOT NULL AND NEW.editor_render_output_key IS DISTINCT FROM OLD.editor_render_output_key THEN
  RAISE EXCEPTION 'IMMUTABLE_RENDER_KEY' USING ERRCODE='PT409'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.server_render_key_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS server_render_key_guard ON public.jobs;
CREATE TRIGGER server_render_key_guard BEFORE UPDATE OF editor_render_output_key ON public.jobs
 FOR EACH ROW EXECUTE FUNCTION private.server_render_key_guard();
CREATE OR REPLACE FUNCTION private.editor_render_available(p_asset UUID,p_job UUID,p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (auth.uid() IS NULL OR EXISTS(SELECT 1 FROM public.editor_library_renders WHERE owner_id=auth.uid() AND r2_key=p_key))
 AND NOT EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=p_key AND released_at IS NULL)
 AND (p_job IS NULL OR EXISTS(SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
 WHERE a.id=p_asset AND a.job_id=p_job AND a.r2_key=p_key AND a.held_at IS NULL
 AND j.deleted_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())));
$$;
REVOKE ALL ON FUNCTION private.editor_render_available(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.editor_render_available(UUID,UUID,TEXT) TO authenticated,service_role;
DROP POLICY IF EXISTS editor_render_read ON public.editor_library_renders;
CREATE POLICY editor_render_read ON public.editor_library_renders FOR SELECT TO authenticated
 USING(owner_id=auth.uid() AND state<>'removed' AND expires_at>now()
 AND private.editor_render_available(asset_id,source_job_id,r2_key));
CREATE OR REPLACE FUNCTION private.reserve_editor_library_render(p_label TEXT,p_sha256 TEXT,p_size_bytes BIGINT,p_rights_confirmed BOOLEAN,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_user UUID; v_rate JSONB; v_row public.editor_library_renders%ROWTYPE; v_id UUID;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=actor::text AND frozen_at IS NULL AND deleted_at IS NULL;
 IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(v_user::text));
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NULL AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160 OR p_label ~ '[[:cntrl:]]'
  OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 26214400
  OR p_rights_confirmed IS DISTINCT FROM true OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
  RAISE EXCEPTION 'INVALID_RENDER' USING ERRCODE='PT400';
 END IF;
 SELECT * INTO v_row FROM public.editor_library_renders WHERE owner_id=actor AND request_key=p_idempotency_key;
 -- Preserve replay of pre-existing browser reservations, but never admit a new
 -- user key in the job-finalize namespace or replay a server-owned reservation.
 IF p_idempotency_key LIKE 'server-%' AND (v_row.id IS NULL OR v_row.source_job_id IS NOT NULL) THEN
  RAISE EXCEPTION 'INVALID_RENDER' USING ERRCODE='PT400';
 END IF;
 IF FOUND THEN
  IF v_row.label<>btrim(p_label) OR v_row.sha256<>p_sha256 OR v_row.size_bytes<>p_size_bytes OR v_row.state='removed' OR v_row.expires_at<=now() THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409';
  END IF;
  RETURN jsonb_build_object('id',v_row.id,'r2_key',v_row.r2_key,'state',v_row.state,'created_at',v_row.created_at,'idempotent',true);
 END IF;
 v_rate:=public.consume_upload_request(actor::text);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 IF NOT private.editor_render_capacity(v_user,actor,p_size_bytes) THEN
  RAISE EXCEPTION 'RENDER_LIMIT' USING ERRCODE='PT429';
 END IF;
 v_id:=gen_random_uuid();
 INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key)
 VALUES(v_id,actor,btrim(p_label),'editor-renders/'||actor::text||'/'||v_id::text||'.mp4',p_sha256,p_size_bytes,p_idempotency_key) RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'r2_key',v_row.r2_key,'state',v_row.state,'created_at',v_row.created_at,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION private.read_editor_library_renders(p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_user UUID; v_rate JSONB; v_rows JSONB;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=actor::text;
 IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 v_rate:=public.consume_job_read_request(v_user);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m)-'owner_id'-'request_key'-'source_job_id'-'asset_id' ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb) INTO v_rows
 FROM (SELECT * FROM public.editor_library_renders WHERE owner_id=actor AND expires_at>now() AND state<>'removed' AND private.editor_render_available(asset_id,source_job_id,r2_key)
  AND ((p_id IS NULL AND state='stored') OR id=p_id) ORDER BY created_at DESC,id DESC LIMIT 100) m;
 RETURN jsonb_build_object('renders',v_rows);
END $$;
CREATE OR REPLACE FUNCTION private.remove_editor_library_render(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID:=auth.uid(); v_user UUID; v_row public.editor_library_renders%ROWTYPE; result JSONB;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=actor::text;
 IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(v_user::text));
 SELECT * INTO v_row FROM public.editor_library_renders WHERE id=p_id AND owner_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=v_row.r2_key AND released_at IS NULL) THEN
  RAISE EXCEPTION 'ON_HOLD' USING ERRCODE='PT409'; END IF;
 IF v_row.source_job_id IS NOT NULL THEN
  result:=public.delete_user_job(actor::text,v_row.source_job_id);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION USING MESSAGE=coalesce(result->>'code','RENDER_NOT_REMOVABLE'),
    ERRCODE=CASE result->>'code' WHEN 'RATE_LIMITED' THEN 'PT429' WHEN 'ACCOUNT_FROZEN' THEN 'PT403'
     WHEN 'NOT_FOUND' THEN 'PT404' ELSE 'PT409' END;
  END IF;
  RETURN jsonb_build_object('id',p_id,'removed',true,'idempotent',coalesce((result->>'replayed')::boolean,false));
 END IF;
 SELECT * INTO v_row FROM public.editor_library_renders WHERE id=p_id AND owner_id=actor FOR UPDATE;
 IF v_row.state='removed' THEN RETURN jsonb_build_object('id',p_id,'removed',true,'idempotent',true); END IF;
 UPDATE public.editor_library_renders SET state='removed',expires_at=least(created_at+interval '90 days',greatest(now(),created_at+interval '16 minutes')) WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'removed',true,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.expire_editor_library_renders(p_batch_size INTEGER DEFAULT 100)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r RECORD; moved INTEGER:=0;
BEGIN
 -- No render lock before its asset: asset deletion cascades the linked row.
 FOR r IN SELECT * FROM public.editor_library_renders WHERE expires_at<=now()
 ORDER BY expires_at LIMIT least(greatest(coalesce(p_batch_size,100),1),500)
 LOOP
  IF EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=r.r2_key AND released_at IS NULL) THEN CONTINUE; END IF;
  IF r.source_job_id IS NOT NULL THEN
   PERFORM 1 FROM public.assets WHERE id=r.asset_id AND held_at IS NULL FOR UPDATE SKIP LOCKED;
   IF NOT FOUND THEN CONTINUE; END IF;
   INSERT INTO public.asset_reap_queue(r2_key) VALUES(r.r2_key) ON CONFLICT(r2_key) DO NOTHING;
   DELETE FROM public.assets WHERE id=r.asset_id AND held_at IS NULL;
  ELSE
   INSERT INTO public.asset_reap_queue(r2_key) VALUES(r.r2_key) ON CONFLICT(r2_key) DO NOTHING;
   DELETE FROM public.editor_library_renders WHERE id=r.id;
  END IF;
  moved:=moved+1;
 END LOOP;
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION private.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),private.read_editor_library_renders(UUID),private.remove_editor_library_render(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.reserve_editor_library_render(TEXT,TEXT,BIGINT,BOOLEAN,TEXT),private.read_editor_library_renders(UUID),private.remove_editor_library_render(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_editor_library_renders(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_editor_library_renders(INTEGER) TO service_role;

-- No fresh queue entry may authorize deleting preserved bytes. Released holds
-- retain their audit row; their explicit release is still allowed to reap.
CREATE OR REPLACE FUNCTION private.protect_held_reap_key() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=NEW.r2_key AND released_at IS NULL) THEN RETURN NULL; END IF;
 -- A still-valid immutable PUT must expire before deletion permits key reuse.
 NEW.not_before:=greatest(NEW.not_before,coalesce((SELECT editor_render_upload_expires_at
 FROM public.jobs WHERE provider='concat-render' AND editor_render_output_key=NEW.r2_key LIMIT 1),now()));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_held_reap_key() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS protect_held_reap_key ON public.asset_reap_queue;
CREATE TRIGGER protect_held_reap_key BEFORE INSERT ON public.asset_reap_queue FOR EACH ROW EXECUTE FUNCTION private.protect_held_reap_key();
CREATE OR REPLACE FUNCTION public.asset_reap_allowed(p_key TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (auth.uid() IS NULL OR EXISTS(SELECT 1 FROM public.editor_library_renders WHERE owner_id=auth.uid() AND r2_key=p_key))
 AND NOT EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=p_key AND released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.assets WHERE r2_key=p_key)
 AND NOT EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key=p_key AND not_before>now());
$$;
REVOKE ALL ON FUNCTION public.asset_reap_allowed(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asset_reap_allowed(TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.cleanup_server_render(p_job_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render' FOR UPDATE;
 IF NOT FOUND OR j.state<>'REFUNDED' THEN RETURN false; END IF;
 IF j.editor_render_output_key IS NULL THEN
  UPDATE public.jobs SET inputs=inputs||jsonb_build_object('cleanup_skipped',true) WHERE id=j.id;
  RETURN true; -- Legacy/deleted work without a key is handled; never enqueue NULL.
 END IF;
 IF EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=j.editor_render_output_key AND released_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.assets WHERE r2_key=j.editor_render_output_key) THEN
  -- Preservation/release and canonical-asset removal own any later cleanup.
  UPDATE public.jobs SET inputs=inputs||jsonb_build_object('cleanup_skipped',true) WHERE id=j.id;
  RETURN false;
 END IF;
 INSERT INTO public.asset_reap_queue(r2_key,not_before) VALUES(j.editor_render_output_key,coalesce(j.editor_render_upload_expires_at,now())) ON CONFLICT(r2_key) DO NOTHING;
 IF j.deleted_at IS NULL THEN
  UPDATE public.jobs SET inputs=inputs||jsonb_build_object('cleanup_queued',true) WHERE id=j.id;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_server_render(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_server_render(UUID) TO service_role;

-- delete_user_job clears inputs. Durable output metadata and this transactional
-- enqueue close the crash window between refund, deletion and the next sweep.
CREATE OR REPLACE FUNCTION private.cleanup_deleted_server_render() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.cleanup_server_render(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.cleanup_deleted_server_render() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cleanup_deleted_server_render ON public.jobs;
CREATE TRIGGER cleanup_deleted_server_render AFTER UPDATE OF deleted_at ON public.jobs
 FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.provider='concat-render' AND NEW.state='REFUNDED')
 EXECUTE FUNCTION private.cleanup_deleted_server_render();

-- Every refund path (including shared sweeps) queues safe cleanup atomically.
DROP TRIGGER IF EXISTS cleanup_refunded_server_render ON public.jobs;
CREATE TRIGGER cleanup_refunded_server_render AFTER UPDATE OF state ON public.jobs
 FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state='REFUNDED' AND NEW.provider='concat-render')
 EXECUTE FUNCTION private.cleanup_deleted_server_render();

CREATE OR REPLACE FUNCTION public.server_render_source(p_auth_id TEXT,p_media_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid UUID; mid UUID; r RECORD;
BEGIN
 SELECT id INTO uid FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
 IF uid IS NULL OR p_media_id !~ '^[jefu]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 mid:=substring(p_media_id from 3)::uuid;
 IF left(p_media_id,1)='j' THEN
  SELECT a.r2_key,a.size_bytes,a.mime_type INTO r FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
 WHERE j.id=mid AND j.user_id=uid AND j.deleted_at IS NULL AND j.state='STORED' AND a.held_at IS NULL
  AND (SELECT count(*) FROM public.assets all_assets WHERE all_assets.job_id=j.id)=1
  AND (a.expires_at IS NULL OR a.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=a.r2_key AND h.released_at IS NULL) LIMIT 1;
 ELSIF left(p_media_id,1)='e' THEN
  SELECT e.r2_key,e.size_bytes,'video/mp4'::text AS mime_type INTO r FROM public.editor_library_renders e
  WHERE e.id=mid AND e.owner_id=p_auth_id::uuid AND e.state='stored' AND e.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=e.r2_key AND h.released_at IS NULL)
  AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key);
 ELSIF left(p_media_id,1)='u' THEN
  SELECT r2_key,size_bytes,CASE WHEN r2_key LIKE '%.mp4' THEN 'video/mp4' WHEN r2_key LIKE '%.mp3' THEN 'audio/mpeg' WHEN r2_key LIKE '%.wav' THEN 'audio/wav' END AS mime_type INTO r
  FROM public.upload_reservations ur WHERE user_id=uid AND r2_key ~ ('^uploads/'||lower(p_auth_id)||'/'||mid::text||'\.(mp4|mp3|wav)$')
  AND created_at>now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=ur.r2_key AND h.released_at IS NULL) LIMIT 1;
 ELSE
  SELECT f.r2_key,f.size_bytes,'video/mp4'::text AS mime_type INTO r FROM public.film_library_masters f
  WHERE f.id=mid AND f.user_id=uid AND f.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.job_id=f.source_job_id AND h.released_at IS NULL);
 END IF;
 IF r IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'r2_key',r.r2_key,'size_bytes',r.size_bytes,'mime_type',r.mime_type);
END $$;
REVOKE ALL ON FUNCTION public.server_render_source(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.server_render_source(TEXT,TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.get_user_job(
    p_auth_id TEXT,
    p_job_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_row     public.jobs%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT * INTO v_row FROM public.jobs
    WHERE id = p_job_id AND user_id = v_user_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'state', v_row.state,
        'credits', v_row.credits,
        'model_id', v_row.model_id,
        'provider', v_row.provider,
        'render_id', (SELECT e.id FROM public.editor_library_renders e WHERE e.source_job_id=v_row.id AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key)),
        'provider_job_id', v_row.provider_job_id,
        'error_code', v_row.error_code,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
    );
END $$;
REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.list_user_jobs(p_auth_id TEXT, p_limit INTEGER DEFAULT 24, p_before_created_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rate JSONB; v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50); v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb); END IF;
    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
    SELECT COALESCE(jsonb_agg(j ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
                   'output_type', CASE WHEN b.provider='concat-render' THEN 'editor-render' ELSE NULL END,
                   'render_id', (SELECT e.id FROM public.editor_library_renders e WHERE e.source_job_id=b.id AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key)),
                   'job_id', b.id, 'state', b.state, 'credits', b.credits, 'model_id', b.model_id, 'error_code', b.error_code, 'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NULL),
                   'held', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NOT NULL)
               ) AS j,
               b.created_at,
               b.id FROM public.jobs b WHERE b.user_id = v_user_id
          AND b.deleted_at IS NULL
          AND b.inputs->>'kind' IS DISTINCT FROM 'chat'
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))) ORDER BY b.created_at DESC, b.id DESC LIMIT v_limit
    ) j;
    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO service_role;

-- ESR-020: release and enqueue remain one atomic transaction.
CREATE OR REPLACE FUNCTION public.release_evidence_hold(
    p_auth_id TEXT,
    p_action_id UUID,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_action RECORD;
    v_release_id UUID;
    v_released INTEGER;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    SELECT a.id, a.user_id, a.job_id INTO v_action FROM public.account_actions a WHERE a.id = p_action_id AND a.action = 'csam_escalation';
    IF v_action.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.action_id = p_action_id AND h.released_at IS NULL) THEN
        RETURN jsonb_build_object('ok', true, 'released', 0, 'replayed', true);
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id)
    VALUES (v_action.user_id, 'evidence_released', left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, v_action.job_id)
    RETURNING id INTO v_release_id;

    -- Separate statements: the enqueue trigger must see released_at from the
    -- preceding update, not the shared snapshot of a data-modifying CTE.
    UPDATE public.evidence_holds h
       SET released_at = now(), release_action_id = v_release_id
     WHERE h.action_id = p_action_id AND h.released_at IS NULL;
    GET DIAGNOSTICS v_released = ROW_COUNT;
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT r2_key FROM public.evidence_holds WHERE release_action_id = v_release_id
    ON CONFLICT (r2_key) DO UPDATE SET not_before = EXCLUDED.not_before;
    RETURN jsonb_build_object('ok', true, 'released', v_released, 'action_id', v_release_id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.release_evidence_hold(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_evidence_hold(TEXT, UUID, TEXT) TO service_role;

COMMIT;
