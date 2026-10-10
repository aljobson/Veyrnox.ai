-- Operator-only post-0243 probe for staging yrqzwqywxfesmbvhzjgj.
-- Run as one request. All fixtures/policy changes roll back; no provider calls.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $$
DECLARE
    fixture_user uuid := '2511e237-a61a-4d88-87ce-c837a7b1e624';
    fixture_model text := 'deployed-fault-84850a43';
    before_effects jsonb; after_effects jsonb; result jsonb; replay jsonb;
    max_prompt int; changed_rows int; free_case boolean; multibyte boolean;
    payload jsonb; request_key text; accepted_job uuid;
BEGIN
    IF position('IF octet_length(p_payload::text) > 16384' IN
        pg_get_functiondef('public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION '0243 final payload guard required';
    END IF;
    PERFORM 1 FROM public.credit_balances WHERE user_id=fixture_user AND balance>=2 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fixture balance unavailable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog WHERE id=fixture_model AND NOT active
        AND provider='fal' AND provider_endpoint='staging-fault/controlled') THEN
        RAISE EXCEPTION 'dedicated inactive fixture model required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.fal_capacity_policy WHERE enabled)
        OR EXISTS (SELECT 1 FROM public.fal_admission_control WHERE paused)
        OR EXISTS (SELECT 1 FROM public.fal_capacity_reservations WHERE released_at IS NULL)
        OR EXISTS (SELECT 1 FROM public.fal_dispatch WHERE state IN ('READY','STARTED','UNKNOWN')) THEN
        RAISE EXCEPTION 'staging baseline must be idle and disabled';
    END IF;
    IF NOT has_function_privilege('service_role','public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)','EXECUTE')
        OR has_function_privilege('anon','public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)','EXECUTE')
        OR has_function_privilege('authenticated','public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)','EXECUTE') THEN
        RAISE EXCEPTION 'admission execution grants changed';
    END IF;
    SELECT jsonb_build_object('balance',balance,'free',free_balance,'subscription',subscription_balance,
        'jobs',(SELECT count(*) FROM public.jobs WHERE user_id=fixture_user),
        'ledger',(SELECT count(*) FROM public.ledger_entries WHERE user_id=fixture_user),
        'claims',(SELECT count(*) FROM public.model_free_allowance_claims WHERE user_id=fixture_user),
        'dispatch',(SELECT count(*) FROM public.fal_dispatch),
        'reservations',(SELECT count(*) FROM public.fal_capacity_reservations))
    INTO before_effects FROM public.credit_balances WHERE user_id=fixture_user;
    max_prompt := 16384-octet_length((jsonb_build_object('prompt','')||'{"image_size":{"width":1024,"height":768}}'::jsonb)::text);
    UPDATE public.model_catalog SET active=true,provider_endpoint='fal-ai/flux-2-pro',modality='text-to-image',
        provider_cost_per_unit=0.03,credits_5s=2,free_allowance_per_day=2,free_allowance_daily_budget=2 WHERE id=fixture_model;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    IF changed_rows<>1 THEN RAISE EXCEPTION 'fixture model update failed'; END IF;
    UPDATE public.fal_capacity_policy SET enabled=true,provider_account='rollback-only-fixture',model_id=fixture_model WHERE singleton;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    IF changed_rows<>1 THEN RAISE EXCEPTION 'fixture policy update failed'; END IF;
    FOREACH free_case IN ARRAY ARRAY[false,true] LOOP
        request_key := 'pinned-boundary-20261010-'||free_case::text;
        FOREACH multibyte IN ARRAY ARRAY[false,true] LOOP
            payload := jsonb_build_object('prompt',CASE WHEN multibyte THEN repeat('é',max_prompt/2+1) ELSE repeat('x',max_prompt+1) END);
            IF octet_length(payload::text)>16384 OR octet_length((payload||'{"image_size":{"width":1024,"height":768}}'::jsonb)::text)<=16384 THEN
                RAISE EXCEPTION 'invalid boundary fixture';
            END IF;
            result := public.admit_fal_dispatch(fixture_user,request_key,fixture_model,
                '{"prompt":"rollback-only fixture"}'::jsonb,payload,'fal-ai/flux-2-pro',free_case);
            IF result IS DISTINCT FROM '{"ok":false,"code":"INVALID_INPUTS"}'::jsonb THEN
                RAISE EXCEPTION 'unexpected oversized admission result: %',result;
            END IF;
        END LOOP;
        -- Exercise a valid exact-limit admission and replay, then undo that case.
        BEGIN
            payload := jsonb_build_object('prompt',repeat('x',max_prompt));
            result := public.admit_fal_dispatch(fixture_user,request_key,fixture_model,
                '{"prompt":"rollback-only fixture"}'::jsonb,payload,'fal-ai/flux-2-pro',free_case);
            IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'free')::boolean IS DISTINCT FROM free_case THEN
                RAISE EXCEPTION 'exact-limit admission failed: %',result;
            END IF;
            accepted_job := (result->>'job_id')::uuid;
            IF (SELECT octet_length(d.payload::text) FROM public.fal_dispatch d WHERE job_id=accepted_job) IS DISTINCT FROM 16384 THEN
                RAISE EXCEPTION 'stored byte limit mismatch';
            END IF;
            replay := public.admit_fal_dispatch(fixture_user,request_key,fixture_model,
                '{"prompt":"rollback-only fixture"}'::jsonb,payload,'fal-ai/flux-2-pro',free_case);
            IF replay->>'idempotent' IS DISTINCT FROM 'true' OR replay->>'job_id' IS DISTINCT FROM result->>'job_id'
                OR (SELECT balance FROM public.credit_balances WHERE user_id=fixture_user) IS DISTINCT FROM
                    (before_effects->>'balance')::int-(CASE WHEN free_case THEN 0 ELSE 2 END)
                OR (SELECT count(*) FROM public.jobs WHERE user_id=fixture_user)<>(before_effects->>'jobs')::bigint+1
                OR (SELECT count(*) FROM public.ledger_entries WHERE user_id=fixture_user)<>(before_effects->>'ledger')::bigint+(CASE WHEN free_case THEN 0 ELSE 1 END)
                OR (SELECT count(*) FROM public.model_free_allowance_claims WHERE user_id=fixture_user)<>(before_effects->>'claims')::bigint+(CASE WHEN free_case THEN 1 ELSE 0 END)
                OR (SELECT count(*) FROM public.fal_dispatch)<>(before_effects->>'dispatch')::bigint+1
                OR (SELECT count(*) FROM public.fal_capacity_reservations)<>(before_effects->>'reservations')::bigint+1 THEN
                RAISE EXCEPTION 'exact-limit admission/replay effects mismatch';
            END IF;
            RAISE SQLSTATE 'ZP001'; -- rollback this successful admission, never publish it
        EXCEPTION WHEN SQLSTATE 'ZP001' THEN NULL;
        END;
        SELECT jsonb_build_object('balance',balance,'free',free_balance,'subscription',subscription_balance,
            'jobs',(SELECT count(*) FROM public.jobs WHERE user_id=fixture_user),
            'ledger',(SELECT count(*) FROM public.ledger_entries WHERE user_id=fixture_user),
            'claims',(SELECT count(*) FROM public.model_free_allowance_claims WHERE user_id=fixture_user),
            'dispatch',(SELECT count(*) FROM public.fal_dispatch),
            'reservations',(SELECT count(*) FROM public.fal_capacity_reservations))
        INTO after_effects FROM public.credit_balances WHERE user_id=fixture_user;
        IF after_effects IS DISTINCT FROM before_effects THEN RAISE EXCEPTION 'probe effects escaped rollback'; END IF;
    END LOOP;
END $$;
ROLLBACK;
SELECT 'paid/free ASCII and UTF-8 overflow rejected; exact-limit admission/replay passed; all fixture effects rolled back' AS result;
