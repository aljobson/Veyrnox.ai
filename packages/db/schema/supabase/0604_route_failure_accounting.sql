-- 0604 — route failure accounting and breaker recovery (ADR-0256).
-- Generic Crun routes probe after ten minutes; Suno still requires fenced reopen.
-- Only the two Seedance 2.5 edit/extend endpoints bypass the single-colon grammar.
-- No catalog, route, price or activation changes. Idempotent: CREATE OR REPLACE.

BEGIN;

ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS breaker_first_opened_at timestamptz;

-- Attempt time distinguishes evidence from the current probe window from older tasks.
-- Sibling reads do not lock; sibling resets never wait for another route's row.
CREATE OR REPLACE FUNCTION private.route_breaker_record(
    p_route_id uuid, p_ok boolean, p_attempt_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_supplier text;
    v_endpoint text;
    v_first_opened_at timestamptz;
    v_probe_from timestamptz;
BEGIN
    SELECT supplier, endpoint INTO v_supplier, v_endpoint FROM public.model_routes WHERE id = p_route_id;
    IF v_supplier = 'crun' AND v_endpoint <> 'crun:suno/music-generate' THEN
        IF p_ok THEN
            UPDATE public.model_routes
               SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL, updated_at = now()
             WHERE id = p_route_id
               AND (consecutive_failures <> 0 OR breaker_opened_at IS NOT NULL OR breaker_first_opened_at IS NOT NULL);
            UPDATE public.model_routes
               SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL, updated_at = now()
             WHERE id IN (
                SELECT sibling.id FROM public.model_routes sibling
                 WHERE sibling.id <> p_route_id AND sibling.supplier = 'crun' AND sibling.endpoint = v_endpoint
                   AND sibling.breaker_opened_at IS NOT NULL
                   AND p_attempt_at >= COALESCE(sibling.breaker_first_opened_at, sibling.breaker_opened_at) + interval '9 minutes'
                 FOR UPDATE SKIP LOCKED
             );
        ELSE
            -- Keep the period start for joining routes; failures use the latest probe window.
            SELECT min(COALESCE(breaker_first_opened_at, breaker_opened_at)),
                   max(breaker_opened_at) + interval '9 minutes'
              INTO v_first_opened_at, v_probe_from
              FROM public.model_routes
             WHERE supplier = 'crun' AND endpoint = v_endpoint AND breaker_opened_at IS NOT NULL;
            -- Sixty seconds of grace for attempts opened just before gate admission.
            UPDATE public.model_routes
               SET consecutive_failures = consecutive_failures + 1,
                   breaker_opened_at = CASE
                       WHEN (v_probe_from IS NULL AND consecutive_failures + 1 >= 5)
                           OR p_attempt_at >= v_probe_from THEN now()
                       ELSE breaker_opened_at END,
                   breaker_first_opened_at = CASE
                       WHEN (v_probe_from IS NULL AND consecutive_failures + 1 >= 5)
                           OR p_attempt_at >= v_probe_from
                       THEN CASE WHEN breaker_opened_at IS NULL THEN COALESCE(v_first_opened_at, now())
                                 ELSE COALESCE(breaker_first_opened_at, breaker_opened_at) END
                       ELSE breaker_first_opened_at END,
                   updated_at = now()
             WHERE id = p_route_id;
        END IF;
    ELSIF p_ok THEN
        UPDATE public.model_routes
           SET consecutive_failures = 0, breaker_opened_at = NULL, breaker_first_opened_at = NULL, updated_at = now()
         WHERE id = p_route_id AND (consecutive_failures <> 0 OR breaker_opened_at IS NOT NULL OR breaker_first_opened_at IS NOT NULL);
    ELSE
        UPDATE public.model_routes
           SET consecutive_failures = consecutive_failures + 1,
               breaker_opened_at = CASE WHEN consecutive_failures + 1 >= 5 THEN now() ELSE breaker_opened_at END,
               breaker_first_opened_at = NULL,
               updated_at = now()
         WHERE id = p_route_id;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.route_breaker_record(uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Submit-phase callers retain current-time evidence and their existing signature.
CREATE OR REPLACE FUNCTION private.route_breaker_record(p_route_id uuid, p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.route_breaker_record(p_route_id, p_ok, now());
END $$;
REVOKE ALL ON FUNCTION private.route_breaker_record(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_job_attempt_outcome(
    p_provider text, p_supplier_job_id text, p_outcome text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE a record; n integer := 0;
BEGIN
    IF p_outcome NOT IN ('completed', 'failed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
    END IF;
    FOR a IN
        UPDATE public.job_attempts x
           SET outcome = p_outcome, updated_at = now()
          FROM public.model_routes r
         WHERE r.id = x.route_id
           AND r.supplier = p_provider
           AND x.supplier_job_id = p_supplier_job_id
           AND x.outcome = 'submitted'
        RETURNING x.route_id, x.created_at
    LOOP
        n := n + 1;
        PERFORM private.route_breaker_record(a.route_id, p_outcome = 'completed', a.created_at);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'updated', n);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_job_attempt_outcome(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_attempt_outcome(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.job_route_close_refused(
    p_job_id uuid, p_route_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    j public.jobs%ROWTYPE;
    last_a public.job_attempts%ROWTYPE;
BEGIN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_found'); END IF;
    IF j.state::text <> 'DEBITED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'job_not_failable_over_or_accepted');
    END IF;

    SELECT * INTO last_a FROM public.job_attempts WHERE job_id = p_job_id ORDER BY attempt_no DESC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.job_attempts (job_id, attempt_no, route_id, outcome, cost_snapshot)
        VALUES (p_job_id, 1, p_route_id, 'failed', 0)
        ON CONFLICT (job_id, attempt_no) DO NOTHING;
    ELSE
        IF last_a.supplier_job_id IS NOT NULL THEN
            RETURN jsonb_build_object('ok', false, 'code', 'job_not_failable_over_or_accepted');
        END IF;
        IF last_a.route_id <> p_route_id THEN RETURN jsonb_build_object('ok', false, 'code', 'failed_route_mismatch'); END IF;
        UPDATE public.job_attempts SET outcome = 'failed', updated_at = now() WHERE id = last_a.id AND outcome IS DISTINCT FROM 'failed';
    END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.job_route_close_refused(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_route_close_refused(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_job_attempt_refused(
    p_provider text, p_supplier_job_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
    UPDATE public.job_attempts x
       SET outcome = 'failed', updated_at = now()
      FROM public.model_routes r
     WHERE r.id = x.route_id
       AND r.supplier = p_provider
       AND x.supplier_job_id = p_supplier_job_id
       AND x.outcome = 'submitted';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', n);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_job_attempt_refused(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_attempt_refused(text, text) TO service_role;

-- Restated from 0591; only the endpoint clause and route cooldown predicate differ.
CREATE OR REPLACE FUNCTION public.reserve_crun_create_slot(
 p_reservation_key TEXT,p_purpose TEXT,p_endpoint TEXT,p_suno_model TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now TIMESTAMPTZ; v_count INTEGER; v_retry INTEGER; v_admission BOOLEAN;
BEGIN
 IF p_reservation_key IS NULL OR p_reservation_key !~ '^[A-Za-z0-9._:-]{8,160}$'
 OR p_purpose IS NULL OR p_purpose !~ '^[a-z0-9._:-]{2,64}$'
 OR (p_endpoint IS NOT NULL AND p_endpoint !~ '^crun:[A-Za-z0-9._/-]{1,120}$' AND p_endpoint NOT IN ('crun:bytedance/seedance2-5-r2v:edit', 'crun:bytedance/seedance2-5-r2v:extend'))
 OR (p_suno_model IS NOT NULL AND (p_endpoint<>'crun:suno/music-generate'
     OR p_suno_model NOT IN ('v6','v6_mini','v6_wild'))) THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crun:create:account',0));
 SELECT admission_open INTO v_admission FROM public.provider_spend_provider_policy
  WHERE provider='crun' FOR UPDATE;
 IF NOT FOUND OR v_admission IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('ok',false,'code','PROVIDER_ADMISSION_PAUSED','retry_after_seconds',60);
 END IF;
 IF p_endpoint IS NOT NULL AND EXISTS(SELECT 1 FROM public.model_routes
   WHERE supplier='crun' AND endpoint=p_endpoint AND breaker_opened_at IS NOT NULL AND (p_endpoint = 'crun:suno/music-generate' OR breaker_opened_at > now() - interval '10 minutes')) THEN
  RETURN jsonb_build_object('ok',false,'code','CRUN_UNAVAILABLE','retry_after_seconds',60);
 END IF;
 IF p_endpoint='crun:suno/music-generate' AND p_suno_model IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.crun_suno_model_breakers
   WHERE endpoint=p_endpoint AND suno_model=p_suno_model AND is_open) THEN
  RETURN jsonb_build_object('ok',false,'code','CRUN_UNAVAILABLE','retry_after_seconds',60);
 END IF;
 v_now:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.crun_create_reservations WHERE reservation_key=p_reservation_key) THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 DELETE FROM public.crun_create_reservations WHERE reserved_at<=v_now-interval '10 seconds';
 SELECT count(*) INTO v_count FROM public.crun_create_reservations WHERE reserved_at > v_now - interval '10 seconds';
 IF v_count >= 20 THEN
  SELECT GREATEST(1,ceil(extract(epoch FROM min(reserved_at)+interval '10 seconds'-v_now)))::INTEGER
   INTO v_retry FROM public.crun_create_reservations WHERE reserved_at > v_now - interval '10 seconds';
  RETURN jsonb_build_object('ok',false,'code','CRUN_RATE_LIMITED','retry_after_seconds',COALESCE(v_retry,1));
 END IF;
 INSERT INTO public.crun_create_reservations(reservation_key,purpose,reserved_at)
  VALUES(p_reservation_key,p_purpose,v_now);
 RETURN jsonb_build_object('ok',true,'idempotent',false,'remaining',19-v_count);
END $$;
REVOKE ALL ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT,TEXT,TEXT) TO service_role;

COMMIT;
