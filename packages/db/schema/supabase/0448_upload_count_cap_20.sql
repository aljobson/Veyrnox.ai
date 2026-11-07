-- One account may hold up to 20 stored/reserved uploads at once (was 10). The 200 MiB total and the
-- 100 MiB per-file limits stay, so this raises the file count, not the storage an account can use.
-- Both functions keep their 0129 / 0401 bodies except for the count (10 -> 20), which is also the
-- longest p_stored list the Worker may send (its LIST is MAX_PENDING_UPLOADS + 1 keys).
-- A new argument list or body means explicit privileges: revoke from the browser roles, grant service_role.
CREATE OR REPLACE FUNCTION public.reserve_upload(p_auth_id TEXT, p_key TEXT, p_size BIGINT, p_stored JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_count BIGINT;
    v_bytes BIGINT;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_size IS NULL OR p_size < 1 OR p_size > 104857600
       OR p_stored IS NULL OR jsonb_typeof(p_stored) <> 'array' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    IF jsonb_array_length(p_stored) > 21 OR p_key IS NULL
       OR p_key !~ ('^uploads/' || lower(p_auth_id) || '/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mp3|wav)$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    -- Same account lock serializes the count, bytes and insertion across Workers.
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.upload_reservations WHERE r2_key = p_key) THEN
        -- Do not renew an old URL's expiry by signing an existing reservation.
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_RESERVED');
    END IF;
    SELECT count(*), COALESCE(sum(size_bytes), 0) INTO v_count, v_bytes
      FROM public.upload_reservations WHERE user_id = v_user;
    -- Legacy objects have no reservation. Include them without counting new
    -- objects twice. p_stored comes from the Worker's authenticated R2 LIST.
    SELECT v_count + count(*), v_bytes + COALESCE(sum(GREATEST(0, (o->>'size')::BIGINT)), 0)
      INTO v_count, v_bytes FROM jsonb_array_elements(p_stored) o
      WHERE NOT EXISTS (SELECT 1 FROM public.upload_reservations r WHERE r.r2_key = o->>'key' AND r.user_id = v_user);
    IF v_count >= 20 OR v_bytes + p_size > 209715200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'UPLOAD_BUDGET_EXCEEDED');
    END IF;
    INSERT INTO public.upload_reservations(r2_key, user_id, size_bytes) VALUES(p_key, v_user, p_size);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.check_upload_batch_budget(p_auth_id TEXT,p_stored JSONB,p_count INTEGER,p_bytes BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid UUID; held_count BIGINT; held_bytes BIGINT;
BEGIN
 IF p_count IS NULL OR p_count<1 OR p_bytes IS NULL OR p_bytes<1
 OR p_stored IS NULL OR jsonb_typeof(p_stored)<>'array' OR jsonb_array_length(p_stored)>21 THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 SELECT id INTO uid FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT count(*),coalesce(sum(size_bytes),0) INTO held_count,held_bytes
 FROM public.upload_reservations WHERE user_id=uid;
 SELECT held_count+count(*),held_bytes+coalesce(sum(greatest(0,(o->>'size')::bigint)),0)
 INTO held_count,held_bytes FROM jsonb_array_elements(p_stored) o
 WHERE NOT EXISTS(SELECT 1 FROM public.upload_reservations r WHERE r.r2_key=o->>'key' AND r.user_id=uid);
 IF held_count+p_count>20 OR held_bytes+p_bytes>209715200 THEN
  RETURN jsonb_build_object('ok',false,'code','UPLOAD_BUDGET_EXCEEDED'); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.check_upload_batch_budget(TEXT,JSONB,INTEGER,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_upload_batch_budget(TEXT,JSONB,INTEGER,BIGINT) TO service_role;
