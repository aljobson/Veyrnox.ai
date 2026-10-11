BEGIN;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS assets_held_idx ON public.assets(held_at) WHERE held_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.content_scans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
 asset_id UUID NULL REFERENCES public.assets(id) ON DELETE SET NULL, r2_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scanning','clean','hold','unavailable')),
 attempts INTEGER NOT NULL DEFAULT 0, claim_token UUID, lease_until TIMESTAMPTZ, scores JSONB, model TEXT,
 queued_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS content_scans_asset_idx ON public.content_scans(asset_id);
CREATE INDEX IF NOT EXISTS content_scans_queue_idx ON public.content_scans(status,queued_at);
CREATE INDEX IF NOT EXISTS content_scans_job_idx ON public.content_scans(job_id);
ALTER TABLE public.content_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_scans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_scans FROM PUBLIC, anon, authenticated;
ALTER TABLE public.content_reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','scanner'));
ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS scores JSONB;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.content_reports'::regclass AND conname='content_reports_user_reporter_check') THEN
  ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_user_reporter_check CHECK (source <> 'user' OR reporter_id IS NOT NULL);
 END IF;
END $$;
DROP INDEX IF EXISTS public.content_reports_one_per_subject;
CREATE UNIQUE INDEX content_reports_one_per_subject ON public.content_reports(reporter_id,subject_kind,subject_id,source) WHERE subject_id IS NOT NULL AND status='open';
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_scanner_subject ON public.content_reports(subject_kind,subject_id) WHERE source='scanner' AND status='open';
CREATE TABLE IF NOT EXISTS public.content_scan_monitor (
 id INTEGER PRIMARY KEY CHECK(id=1), armed BOOLEAN NOT NULL DEFAULT false,
 armed_at TIMESTAMPTZ, disarmed_at TIMESTAMPTZ, disarmed_by TEXT
);
INSERT INTO public.content_scan_monitor(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE public.content_scan_monitor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_scan_monitor FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_scan_monitor FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.enqueue_content_scan() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.content_scans(job_id,asset_id,r2_key) VALUES(NEW.job_id,NEW.id,NEW.r2_key) ON CONFLICT(asset_id) DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Classification must never roll back job_stored. Do not log keys or image data.
 RAISE WARNING 'content scan enqueue failed for asset %', NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_content_scan() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS content_scans_enqueue ON public.assets;
CREATE TRIGGER content_scans_enqueue AFTER INSERT ON public.assets FOR EACH ROW WHEN (NEW.mime_type LIKE 'image/%') EXECUTE FUNCTION public.enqueue_content_scan();
CREATE OR REPLACE FUNCTION public.claim_content_scans(p_limit INTEGER, p_lease_seconds INTEGER)
RETURNS TABLE(id UUID, claim_token UUID, r2_key TEXT, attempts INTEGER, lease_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.content_scans%ROWTYPE;
BEGIN
 FOR v IN SELECT s.* FROM public.content_scans s
  WHERE s.status='queued' OR (s.status='scanning' AND s.lease_until < now())
  ORDER BY s.queued_at,s.id LIMIT greatest(1,least(coalesce(p_limit,5),50)) FOR UPDATE SKIP LOCKED
 LOOP
  IF v.asset_id IS NULL THEN
   UPDATE public.content_scans s SET status='unavailable',scores='{"reason":"asset_gone"}'::jsonb,
    decided_at=now(),claim_token=NULL,lease_until=NULL WHERE s.id=v.id;
  ELSIF v.attempts >= 5 THEN
   UPDATE public.content_scans s SET status='unavailable',decided_at=now(),claim_token=NULL,lease_until=NULL WHERE s.id=v.id;
  ELSE
   RETURN QUERY UPDATE public.content_scans s SET status='scanning',attempts=s.attempts+1,
    claim_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,120),600)))
    WHERE s.id=v.id RETURNING s.id,s.claim_token,s.r2_key,s.attempts,s.lease_until;
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.record_content_scan(p_scan_id UUID,p_claim_token UUID,p_verdict TEXT,p_scores JSONB,p_model TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.content_scans%ROWTYPE; v_top TEXT; v_details TEXT; v_asset_id UUID;
BEGIN
 -- Asset DELETE locks the asset before its scan via ON DELETE SET NULL; use that same order.
 SELECT asset_id INTO v_asset_id FROM public.content_scans WHERE id=p_scan_id;
 PERFORM 1 FROM public.assets WHERE id=v_asset_id FOR UPDATE;
 SELECT * INTO v FROM public.content_scans WHERE id=p_scan_id FOR UPDATE;
 IF v.status IN ('clean','hold','unavailable') THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
 IF v.id IS NULL OR v.status <> 'scanning' OR p_claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_claim_token OR v.lease_until IS NULL OR v.lease_until <= clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'code','STALE_CLAIM');
 END IF;
 IF p_verdict IS NULL OR p_verdict NOT IN ('clean','hold','unavailable') OR jsonb_typeof(p_scores) IS DISTINCT FROM 'object' THEN
  RETURN jsonb_build_object('ok',false,'code','VERDICT_INVALID');
 END IF;
 IF p_verdict='hold' AND v.asset_id IS NOT NULL THEN
  UPDATE public.assets SET held_at=now() WHERE id=v.asset_id;
  SELECT key INTO v_top FROM jsonb_each_text(p_scores)
   WHERE key IN ('sexual','violence','violence/graphic','self-harm','self-harm/intent','self-harm/instructions')
   ORDER BY value::numeric DESC,key LIMIT 1;
  SELECT string_agg(key || ': ' || value, ', ' ORDER BY value::numeric DESC,key) INTO v_details
   FROM (SELECT key,value FROM jsonb_each_text(p_scores)
    WHERE key IN ('sexual','violence','violence/graphic','self-harm','self-harm/intent','self-harm/instructions')
    ORDER BY value::numeric DESC,key LIMIT 3) top_scores;
  INSERT INTO public.content_reports(reporter_id,source,subject_kind,subject_id,category,details,scores)
   VALUES(NULL,'scanner','job',v.job_id,CASE WHEN v_top='sexual' THEN 'intimate_image' WHEN v_top LIKE 'violence%' THEN 'violence' ELSE 'other' END,coalesce(v_details,''),p_scores)
   ON CONFLICT(subject_kind,subject_id) WHERE source='scanner' AND status='open' DO NOTHING;
 END IF;
 UPDATE public.content_scans SET status=p_verdict,scores=p_scores,model=p_model,decided_at=now(),lease_until=NULL,claim_token=NULL WHERE id=p_scan_id;
 RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;
CREATE OR REPLACE FUNCTION public.release_content_hold(p_auth_id TEXT,p_job_id UUID,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admin RECORD; v_user UUID; v_count INTEGER;
BEGIN
 SELECT u.id,u.email,u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id=p_auth_id;
 IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED'); END IF;
 SELECT user_id INTO v_user FROM public.jobs WHERE id=p_job_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); END IF;
 PERFORM 1 FROM public.assets WHERE job_id=p_job_id ORDER BY id FOR UPDATE;
 UPDATE public.assets SET held_at=NULL WHERE job_id=p_job_id AND held_at IS NOT NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count > 0 THEN
  INSERT INTO public.account_actions(user_id,action,actor,actor_user_id,job_id,reason)
   VALUES(v_user,'hold_released',left(v_admin.email,120),v_admin.id,p_job_id,btrim(p_reason));
 END IF;
 UPDATE public.content_reports SET status='resolved',resolved_at=now(),resolved_by=v_admin.email,resolution=btrim(p_reason)
  WHERE source='scanner' AND subject_kind='job' AND subject_id=p_job_id AND status='open';
 RETURN jsonb_build_object('ok',true,'replayed',v_count=0);
END $$;
CREATE OR REPLACE FUNCTION public.admin_held_asset(p_auth_id TEXT,p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admin RECORD; v_asset RECORD;
BEGIN
 SELECT u.id,u.email,u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id=p_auth_id;
 IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 SELECT a.r2_key,a.mime_type,a.size_bytes,j.user_id INTO v_asset FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
  WHERE a.job_id=p_job_id AND a.held_at IS NOT NULL ORDER BY a.created_at LIMIT 1 FOR UPDATE OF a;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 INSERT INTO public.account_actions(user_id,action,actor,actor_user_id,job_id,reason)
  VALUES(v_asset.user_id,'held_asset_viewed',left(v_admin.email,120),v_admin.id,p_job_id,'review');
 RETURN jsonb_build_object('ok',true,'r2_key',v_asset.r2_key,'mime_type',v_asset.mime_type,'size_bytes',v_asset.size_bytes);
END $$;
CREATE OR REPLACE FUNCTION public.arm_content_scan_monitor()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.content_scan_monitor SET armed=true,armed_at=now() WHERE id=1 AND NOT armed;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.disarm_content_scan_monitor(p_auth_id TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admin RECORD;
BEGIN
 SELECT u.id,u.email,u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id=p_auth_id;
 IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED'); END IF;
 UPDATE public.content_scan_monitor SET armed=false,disarmed_at=now(),disarmed_by=v_admin.email WHERE id=1;
 INSERT INTO public.account_actions(user_id,action,actor,actor_user_id,reason)
  VALUES(v_admin.id,'scanner_disarmed',left(v_admin.email,120),v_admin.id,btrim(p_reason));
 RETURN jsonb_build_object('ok',true);
END $$;
ALTER TABLE public.social_post_targets ADD COLUMN IF NOT EXISTS claimed_from_status TEXT;
ALTER TABLE public.social_post_targets ADD COLUMN IF NOT EXISTS claimed_attempts INTEGER;
-- Restore markers written during this claim if the final publication is deferred.
ALTER TABLE public.social_post_targets ADD COLUMN IF NOT EXISTS claimed_provider_state JSONB;
CREATE OR REPLACE FUNCTION public.authorize_social_target_dispatch(p_target_id UUID,p_claim_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.social_post_targets%ROWTYPE; v_held BOOLEAN := false; v_asset RECORD;
BEGIN
 IF p_claim_key IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CLAIM_KEY_REQUIRED'); END IF;
 SELECT * INTO v FROM public.social_post_targets WHERE id=p_target_id FOR UPDATE;
 IF v.id IS NULL OR v.publish_status <> 'publishing' OR NOT (v.claim_key IS NOT DISTINCT FROM p_claim_key) THEN
  RETURN jsonb_build_object('ok',false,'code','CLAIM_LOST');
 END IF;
 FOR v_asset IN SELECT a.held_at FROM public.assets a JOIN public.social_post_media m ON m.source_job_id=a.job_id
  WHERE m.post_id=v.post_id ORDER BY a.id FOR UPDATE OF a
 LOOP
  v_held := v_held OR v_asset.held_at IS NOT NULL;
 END LOOP;
 IF v_held THEN
  UPDATE public.social_post_targets
   SET publish_status=CASE WHEN claimed_from_status='publishing' THEN 'pending' ELSE COALESCE(claimed_from_status,'pending') END,
    attempts=COALESCE(claimed_attempts,GREATEST(attempts-1,0)), provider_state=COALESCE(claimed_provider_state,provider_state),
    next_attempt_at=CASE WHEN claimed_from_status='submitted' THEN now()+interval '5 minutes' WHEN claimed_from_status='publishing' THEN now() ELSE next_attempt_at END,
    claim_key=NULL,claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL WHERE id=p_target_id;
  RETURN jsonb_build_object('ok',false,'code','MEDIA_HELD');
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.report_social_post_progress( p_target_id UUID, p_provider_state JSONB, p_next_check_at TIMESTAMPTZ, p_claim_key UUID DEFAULT NULL ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target public.social_post_targets%ROWTYPE;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND'); END IF;
    IF v_target.publish_status <> 'publishing'
       OR (p_claim_key IS NOT NULL AND v_target.claim_key IS DISTINCT FROM p_claim_key) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_LOST');
    END IF;
    UPDATE public.social_post_targets SET publish_status = 'submitted',
        provider_state = COALESCE(p_provider_state, '{}'::jsonb),
        -- A NULL check time would strand the row: the claim only takes a
        -- 'submitted' row whose next_attempt_at is set.
        next_attempt_at = COALESCE(p_next_check_at, now()),
        last_error = NULL,
        claim_key = NULL, claimed_from_status = NULL, claimed_attempts = NULL, claimed_provider_state = NULL
    WHERE id = p_target_id;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.report_social_post_progress(UUID,JSONB,TIMESTAMPTZ,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.report_social_post_progress(UUID,JSONB,TIMESTAMPTZ,UUID) TO service_role;
CREATE OR REPLACE FUNCTION public.complete_social_post_target( p_target_id UUID, p_ok BOOLEAN, p_platform_post_id TEXT, p_platform_post_url TEXT, p_error TEXT, p_delivered BOOLEAN DEFAULT false, p_claim_key UUID DEFAULT NULL ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target public.social_post_targets%ROWTYPE;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND'); END IF;
    IF v_target.publish_status <> 'publishing'
       OR (p_claim_key IS NOT NULL AND v_target.claim_key IS DISTINCT FROM p_claim_key) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_LOST');
    END IF;
    IF p_ok THEN
        UPDATE public.social_post_targets SET publish_status = CASE WHEN p_delivered THEN 'delivered' ELSE 'published' END,
            published_at = now(),
            platform_post_id = p_platform_post_id, platform_post_url = p_platform_post_url, last_error = NULL,
            claim_key = NULL, claimed_from_status = NULL, claimed_attempts = NULL, claimed_provider_state = NULL
        WHERE id = p_target_id;
    ELSIF v_target.attempts >= 3 THEN
        UPDATE public.social_post_targets SET publish_status = 'failed', last_error = left(COALESCE(p_error, 'unknown_error'), 500), claim_key = NULL, claimed_from_status = NULL, claimed_attempts = NULL, claimed_provider_state = NULL
        WHERE id = p_target_id;
    ELSE
        UPDATE public.social_post_targets SET publish_status = 'pending', last_error = left(COALESCE(p_error, 'unknown_error'), 500),
            next_attempt_at = now() + make_interval(mins => least(5 * (1 << (v_target.attempts - 1)), 60)),
            claim_key = NULL, claimed_from_status = NULL, claimed_attempts = NULL, claimed_provider_state = NULL
        WHERE id = p_target_id;
    END IF;
    PERFORM public.settle_social_post(v_target.post_id);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.complete_social_post_target(UUID,BOOLEAN,TEXT,TEXT,TEXT,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.complete_social_post_target(UUID,BOOLEAN,TEXT,TEXT,TEXT,BOOLEAN,UUID) TO service_role;
CREATE OR REPLACE FUNCTION public.get_user_asset(p_auth_id TEXT, p_job_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row RECORD;
BEGIN
    SELECT a.held_at, a.r2_key, a.mime_type, a.size_bytes, a.expires_at, j.state::text AS state INTO v_row FROM public.assets a JOIN public.jobs j ON j.id = a.job_id JOIN public.users u ON u.id = j.user_id WHERE j.id = p_job_id AND u.auth_id = p_auth_id LIMIT 1;
    IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_row.held_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','HELD'); END IF;
    RETURN jsonb_build_object(
        'ok', true, 'r2_key', v_row.r2_key, 'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes, 'asset_expires_at', v_row.expires_at, 'state', v_row.state
    );
END $$;
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
                   'job_id', b.id, 'state', b.state, 'credits', b.credits, 'model_id', b.model_id, 'error_code', b.error_code, 'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NULL),
                   'held', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NOT NULL)
               ) AS j,
               b.created_at,
               b.id FROM public.jobs b WHERE b.user_id = v_user_id
          AND b.inputs->>'kind' IS DISTINCT FROM 'chat'
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))) ORDER BY b.created_at DESC, b.id DESC LIMIT v_limit
    ) j;
    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;
CREATE OR REPLACE FUNCTION public.admin_lookup_user(p_auth_id TEXT, p_email TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL, p_job_id UUID DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin BOOLEAN; v_user RECORD; v_jobs JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_email IS NULL AND p_user_id IS NULL AND p_job_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'LOOKUP_REQUIRED'); END IF;
    SELECT u.id, u.email, u.frozen_at, u.hold_until, u.rights_attested_at, u.rights_attestation_version, u.created_at,
           (SELECT count(*) FROM public.account_actions a WHERE a.user_id = u.id AND a.action = 'warning')  AS warnings,
           private.standing_takedowns(u.id) AS takedowns,
           (SELECT count(*) FROM public.content_appeals c WHERE c.user_id = u.id AND c.status = 'upheld') AS reversed,
           (SELECT count(*) FROM public.content_appeals c WHERE c.user_id = u.id AND c.status = 'open') AS open_appeals INTO v_user FROM public.users u WHERE (p_user_id IS NOT NULL AND u.id = p_user_id)
        OR (p_job_id IS NOT NULL AND u.id = (SELECT j.user_id FROM public.jobs j WHERE j.id = p_job_id))
        OR (p_email IS NOT NULL AND lower(u.email) = lower(btrim(p_email))) ORDER BY u.created_at LIMIT 1;
    IF v_user.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_jobs FROM (
        SELECT j.id AS job_id, j.model_id, j.state::text AS state, j.credits, j.created_at, j.consent_attested_at,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id) AS has_asset,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id AND a.held_at IS NOT NULL) AS held,
               EXISTS (SELECT 1 FROM public.account_actions a WHERE a.job_id = j.id AND a.action = 'takedown') AS taken_down FROM public.jobs j WHERE j.user_id = v_user.id ORDER BY j.created_at DESC LIMIT 25
    ) t;
    RETURN jsonb_build_object(
        'ok', true, 'user', jsonb_build_object(
            'id', v_user.id, 'email', v_user.email, 'frozen_at', v_user.frozen_at, 'hold_until', CASE WHEN v_user.hold_until > now() THEN v_user.hold_until END,
            'rights_attested_at', v_user.rights_attested_at, 'rights_attestation_version', v_user.rights_attestation_version, 'created_at', v_user.created_at,
            'warnings', v_user.warnings, 'takedowns', v_user.takedowns, 'reversed_takedowns', v_user.reversed, 'open_appeals', v_user.open_appeals
        ), 'jobs', v_jobs
    );
END $$;
CREATE OR REPLACE FUNCTION public.create_social_post(p_auth_id TEXT, p_brand_id UUID, p_scheduled_at TIMESTAMPTZ, p_global_text TEXT, p_idempotency_key TEXT, p_account_ids UUID[], p_media JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_post_id UUID; v_existing UUID; v_item JSONB;
    v_position      INTEGER := 0; v_account_count INTEGER;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id FOR UPDATE OF u;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.id = p_brand_id AND b.owner_user_id = v_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND'); END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_IDEMPOTENCY_KEY'); END IF;
    SELECT id INTO v_existing FROM public.social_posts WHERE brand_id = p_brand_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'post_id', v_existing); END IF;
    IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '5 minutes' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SCHEDULE'); END IF;
    IF p_account_ids IS NULL OR array_length(p_account_ids, 1) IS NULL OR array_length(p_account_ids, 1) > 20 THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_TARGET_ACCOUNTS'); END IF;
    SELECT count(*) INTO v_account_count FROM public.social_accounts a WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';
    IF v_account_count IS DISTINCT FROM array_length(p_account_ids, 1)
        OR v_account_count IS DISTINCT FROM (SELECT count(*) FROM (SELECT DISTINCT unnest(p_account_ids)) d) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;
    IF p_media IS NULL OR jsonb_typeof(p_media) != 'array'
        OR jsonb_array_length(p_media) < 1 OR jsonb_array_length(p_media) > 10 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        IF jsonb_typeof(v_item) <> 'object' OR (v_item->>'media_type') IS NULL
            OR (v_item->>'media_type') NOT IN ('image','video')
            OR (v_item ? 'job_id') = (v_item ? 'upload_id') THEN
            RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
        END IF;
        IF v_item ? 'job_id' THEN
            IF (v_item->>'job_id') IS NULL OR (v_item->>'job_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA'); END IF;
            IF NOT EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id = a.job_id WHERE j.id = (v_item->>'job_id')::uuid AND j.user_id = v_user
                AND split_part(a.mime_type,'/',1) = v_item->>'media_type') THEN
                RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND');
            END IF;
            IF EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=(v_item->>'job_id')::uuid AND a.held_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'code','MEDIA_HELD'); END IF;
        ELSE
            IF (v_item->>'upload_id') IS NULL OR (v_item->>'upload_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA'); END IF;
            IF NOT EXISTS (SELECT 1 FROM public.social_uploads WHERE id = (v_item->>'upload_id')::uuid
                AND user_id = v_user AND status = 'ready'
                AND split_part(mime_type,'/',1) = v_item->>'media_type') THEN
                RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND');
            END IF;
        END IF;
    END LOOP;
    INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key)
    VALUES (p_brand_id, v_user, 'scheduled', p_scheduled_at, p_global_text, p_idempotency_key)
    RETURNING id INTO v_post_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        INSERT INTO public.social_post_media (post_id, "position", media_type, source_job_id, source_upload_id)
        VALUES (v_post_id, v_position, v_item->>'media_type', (v_item->>'job_id')::UUID, (v_item->>'upload_id')::UUID);
        v_position := v_position + 1;
    END LOOP;
    INSERT INTO public.social_post_targets (post_id, account_id, network)
    SELECT v_post_id, a.id, a.network FROM public.social_accounts a WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'post_id', v_post_id, 'target_count', array_length(p_account_ids, 1));
END $$;
CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
    PERFORM public.social_fail_inactive_targets(NULL);
    RETURN QUERY
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status FROM public.social_post_targets t JOIN public.social_posts p ON p.id = t.post_id JOIN public.social_accounts a ON a.id = t.account_id WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND a.status = 'active'
          AND (
              ((t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes'))
               AND NOT EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.assets ast ON ast.job_id=m.source_job_id WHERE m.post_id=t.post_id AND ast.held_at IS NOT NULL)
              OR (t.publish_status = 'submitted' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= now())
          ) ORDER BY p.scheduled_at LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing',
            claimed_from_status = due.prior_status, claimed_attempts = t.attempts, claimed_provider_state = t.provider_state,
            claimed_at = now(),
            claim_key = gen_random_uuid(),
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END FROM due WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state, t.claim_key
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        m.media_type, coalesce(ast.r2_key,up.r2_key), coalesce(ast.mime_type,up.mime_type), coalesce(ast.size_bytes,up.size_bytes), c.provider_state, c.claim_key FROM claimed c JOIN public.social_posts p ON p.id = c.post_id JOIN public.social_accounts a ON a.id = c.account_id LEFT JOIN LATERAL (
        SELECT pm.media_type, pm.source_job_id, pm.source_upload_id FROM public.social_post_media pm WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true LEFT JOIN LATERAL (
        SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x WHERE x.job_id = m.source_job_id ORDER BY x.created_at LIMIT 1
    ) ast ON true LEFT JOIN public.social_uploads up ON up.id = m.source_upload_id AND up.status = 'ready';
END $$;
CREATE OR REPLACE FUNCTION public.list_content_reports(p_auth_id TEXT, p_status TEXT DEFAULT 'open', p_limit INTEGER DEFAULT 50) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin BOOLEAN; v_rows JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('open', 'resolved') THEN RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID'); END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY (t.category = 'csam') DESC, t.created_at), '[]'::jsonb) INTO v_rows FROM (
        SELECT r.id, r.reporter_id, u.email AS reporter_email, r.subject_kind, r.subject_id, r.category, r.details,
               r.source, r.scores, r.status, r.created_at, r.resolved_at, r.resolved_by, r.resolution,
               j.user_id AS subject_user_id, j.model_id AS subject_model_id,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id AND a.held_at IS NULL) AS subject_served,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id=j.id AND a.held_at IS NOT NULL) AS held FROM public.content_reports r LEFT JOIN public.users u ON u.id = r.reporter_id LEFT JOIN public.jobs j ON r.subject_kind = 'job' AND j.id = r.subject_id WHERE p_status IS NULL OR r.status = p_status ORDER BY (r.category = 'csam') DESC, r.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) t;
    RETURN jsonb_build_object('ok', true, 'reports', v_rows, 'unavailable_scans_24h', (SELECT count(*) FROM public.content_scans WHERE status='unavailable' AND scores->>'reason' IS DISTINCT FROM 'asset_gone' AND decided_at > now()-interval '24 hours'),
        'asset_gone_scans_24h', (SELECT count(*) FROM public.content_scans WHERE status='unavailable' AND scores->>'reason'='asset_gone' AND decided_at > now()-interval '24 hours'));
END $$;
DO $$
DECLARE
    def text;
    names text[];
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.worker_task_health'::regclass AND c.conname = 'worker_task_health_task_check';
    IF def IS NULL THEN
        RAISE EXCEPTION 'worker_task_health_task_check is missing; 0131 must be applied first';
    END IF;
    IF def NOT LIKE '%''content_scan''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO names
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        names := array_append(names, 'content_scan');
        ALTER TABLE public.worker_task_health DROP CONSTRAINT worker_task_health_task_check;
        EXECUTE format(
            'ALTER TABLE public.worker_task_health ADD CONSTRAINT worker_task_health_task_check CHECK (task IN (%s))',
            (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(names) AS k)
        );
    END IF;
END
$$;
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'byteplus' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'byteplus')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')
                UNION ALL SELECT 'publish_sweep' WHERE EXISTS (SELECT 1 FROM public.social_posts WHERE status = 'scheduled' AND scheduled_at <= statement_timestamp() - interval '20 minutes')
                UNION ALL SELECT 'video_agent' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'video-agent')
                UNION ALL SELECT 'fal_dispatch' WHERE EXISTS (SELECT 1 FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id WHERE j.state = 'DEBITED')
                UNION ALL SELECT 'content_scan' WHERE EXISTS (SELECT 1 FROM public.content_scan_monitor m WHERE m.armed
                    AND (m.armed_at < statement_timestamp()-interval '20 minutes' OR EXISTS (SELECT 1 FROM public.worker_task_health sh
                        WHERE sh.task='content_scan' AND sh.last_attempt > m.armed_at AND NOT sh.last_ok)))) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
        'content_scan_overdue', (SELECT count(*) FROM public.content_scan_monitor m LEFT JOIN public.worker_task_health h ON h.task='content_scan'
            WHERE m.armed AND greatest(m.armed_at,h.last_success) < statement_timestamp()-interval '20 minutes'),
        'content_scan_backlogged', (SELECT count(*) FROM public.content_scans s WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed)
            AND (s.status='queued' OR (s.status='scanning' AND s.lease_until < statement_timestamp())) AND s.queued_at < statement_timestamp()-interval '30 minutes'),
        'content_scan_exhausted', (SELECT CASE WHEN count(*) > 20 THEN count(*) ELSE 0 END FROM public.content_scans s
            WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed) AND s.status='unavailable' AND s.scores->>'reason' IS DISTINCT FROM 'asset_gone' AND s.decided_at > statement_timestamp()-interval '24 hours'),
        'fal_dispatch_unknown', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND (d.state = 'UNKNOWN' OR (d.state = 'STARTED' AND d.started_at < statement_timestamp() - interval '2 minutes'))),
        'fal_dispatch_overdue', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND ((d.state = 'READY' AND d.created_at < statement_timestamp() - interval '10 minutes')
                OR (d.state = 'ACCEPTED' AND d.projected_at IS NULL AND d.resolved_at < statement_timestamp() - interval '5 minutes'))),
        'cinema_poll_overdue', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND stream_uid IS NOT NULL
            AND COALESCE(recovery_checked_at,created_at) < statement_timestamp()-interval '40 minutes'),
        'cinema_poll_failed', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND recovery_failed),
        'cinema_provisioning_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='provisioning' AND created_at < statement_timestamp()-interval '5 minutes'),
        'cinema_processing_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='processing' AND created_at < statement_timestamp()-interval '3 hours'),
        'cinema_cleanup_required', (SELECT count(*) FROM public.cinema_uploads WHERE state='error'
            OR (state='deleting' AND delete_requested_at < statement_timestamp()-interval '30 minutes')
            OR (state='uploading' AND expires_at < statement_timestamp()-interval '15 minutes')),
        'reap_exhausted', (SELECT count(*) FROM public.asset_reap_queue WHERE attempts >= 8),
        'reap_overdue', (SELECT count(*) FROM public.asset_reap_queue WHERE queued_at < statement_timestamp() - INTERVAL '1 hour'),
        'stale_jobs', (SELECT count(*) FROM public.jobs WHERE state IN ('DEBITED','SUBMITTED','SUCCEEDED','FAILOVER','FAILED')
            AND updated_at < statement_timestamp() - INTERVAL '3 hours'),
        'stale_top_up_returns', (SELECT count(*) FROM public.top_ups WHERE status = 'pending' AND return_order_id IS NOT NULL AND return_closed_at IS NULL
            AND COALESCE(backfill_checked_at, returned_at + INTERVAL '10 minutes') < statement_timestamp() - INTERVAL '8 hours'),
        'unreviewed_flagged_orders', (SELECT count(*) FROM public.top_up_flagged_orders f WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'flagged_order' AND r.incident_key = f.order_id)),
        'unreviewed_order_collisions', (SELECT count(*) FROM public.top_up_order_collisions c WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'order_collision' AND r.incident_key = c.id::TEXT))
    ) ON CONFLICT(singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at, summary = EXCLUDED.summary;
$$;
REVOKE ALL ON FUNCTION public.claim_content_scans(INTEGER,INTEGER) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.claim_content_scans(INTEGER,INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.record_content_scan(UUID,UUID,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.record_content_scan(UUID,UUID,TEXT,JSONB,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.release_content_hold(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.release_content_hold(TEXT,UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_held_asset(TEXT,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.admin_held_asset(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.arm_content_scan_monitor() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.arm_content_scan_monitor() TO service_role;
REVOKE ALL ON FUNCTION public.disarm_content_scan_monitor(TEXT,TEXT) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.disarm_content_scan_monitor(TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.get_user_asset(TEXT,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.get_user_asset(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT,INTEGER,TIMESTAMPTZ,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.list_user_jobs(TEXT,INTEGER,TIMESTAMPTZ,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.admin_lookup_user(TEXT,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.admin_lookup_user(TEXT,TEXT,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.create_social_post(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.create_social_post(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.claim_due_social_post_targets(INTEGER) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.claim_due_social_post_targets(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.list_content_reports(TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.list_content_reports(TEXT,TEXT,INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_recovery_health() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.refresh_recovery_health() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
