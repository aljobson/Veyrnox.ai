-- Operator-only rollback probe for staging project yrqzwqywxfesmbvhzjgj.
-- Execute as one request. No DDL, commit, provider calls or persisted activation.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $$
DECLARE
    fixture_user uuid := '2511e237-a61a-4d88-87ce-c837a7b1e624';
    fixture_model text := 'deployed-fault-84850a43';
    payload jsonb := jsonb_build_object('prompt', repeat('x',16350));
    original_balance int; original_free int; original_subscription int; changed_rows int; original_jobs bigint; original_ledger bigint; original_claims bigint;
    original_dispatch bigint; original_reservations bigint; result jsonb; constraint_name text;
    free_case boolean; expected_failure boolean;
BEGIN
    -- Fixture balance precedes policy locks; no operator policy update is committed.
    SELECT balance,free_balance,subscription_balance INTO original_balance,original_free,original_subscription FROM public.credit_balances WHERE user_id=fixture_user FOR UPDATE;
    IF original_balance IS NULL OR original_balance < 2 THEN RAISE EXCEPTION 'fixture balance unavailable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog WHERE id=fixture_model AND NOT active
        AND provider='fal' AND provider_endpoint='staging-fault/controlled') THEN
        RAISE EXCEPTION 'dedicated inactive model required';
    END IF;
    IF EXISTS(SELECT 1 FROM public.fal_capacity_policy WHERE enabled)
        OR EXISTS(SELECT 1 FROM public.fal_admission_control WHERE paused)
        OR EXISTS(SELECT 1 FROM public.fal_capacity_reservations WHERE released_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.fal_dispatch WHERE state IN ('READY','STARTED','UNKNOWN')) THEN
        RAISE EXCEPTION 'staging baseline not idle and disabled';
    END IF;
    SELECT count(*) INTO original_jobs FROM public.jobs WHERE user_id=fixture_user;
    SELECT count(*) INTO original_ledger FROM public.ledger_entries WHERE user_id=fixture_user;
    SELECT count(*) INTO original_claims FROM public.model_free_allowance_claims WHERE user_id=fixture_user;
    SELECT count(*) INTO original_dispatch FROM public.fal_dispatch;
    SELECT count(*) INTO original_reservations FROM public.fal_capacity_reservations;
    IF octet_length(payload::text)>16384 OR octet_length((payload||'{"image_size":{"width":1024,"height":768}}'::jsonb)::text)<=16384 THEN
        RAISE EXCEPTION 'invalid boundary fixture';
    END IF;
    UPDATE public.model_catalog SET active=true,provider_endpoint='fal-ai/flux-2-pro',modality='text-to-image',
        provider_cost_per_unit=0.03,credits_5s=2,free_allowance_per_day=2,free_allowance_daily_budget=2 WHERE id=fixture_model;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    IF changed_rows<>1 THEN RAISE EXCEPTION 'fixture model update failed'; END IF;
    UPDATE public.fal_capacity_policy SET enabled=true,provider_account='rollback-only-fixture',model_id=fixture_model;
    FOREACH free_case IN ARRAY ARRAY[false,true] LOOP
        expected_failure:=false;
        BEGIN
            result:=public.admit_fal_dispatch(fixture_user,'rollback-size-20261010-'||free_case::text,
                fixture_model,'{"prompt":"rollback-only fixture"}'::jsonb,payload,'fal-ai/flux-2-pro',free_case);
            RAISE EXCEPTION 'expected outbox constraint failure, got %',result;
        EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
            IF constraint_name<>'fal_dispatch_payload_check' THEN RAISE EXCEPTION 'unexpected constraint %',constraint_name; END IF;
            expected_failure:=true;
        END;
        IF NOT expected_failure
            OR (SELECT balance FROM public.credit_balances WHERE user_id=fixture_user)<>original_balance
            OR (SELECT free_balance FROM public.credit_balances WHERE user_id=fixture_user)<>original_free
            OR (SELECT subscription_balance FROM public.credit_balances WHERE user_id=fixture_user)<>original_subscription
            OR (SELECT count(*) FROM public.jobs WHERE user_id=fixture_user)<>original_jobs
            OR (SELECT count(*) FROM public.ledger_entries WHERE user_id=fixture_user)<>original_ledger
            OR (SELECT count(*) FROM public.model_free_allowance_claims WHERE user_id=fixture_user)<>original_claims
            OR (SELECT count(*) FROM public.fal_dispatch)<>original_dispatch
            OR (SELECT count(*) FROM public.fal_capacity_reservations)<>original_reservations THEN
            RAISE EXCEPTION 'admission effects escaped subtransaction rollback';
        END IF;
    END LOOP;
END $$;
ROLLBACK;
SELECT 'paid and free outbox failures rolled back; no persisted policy activation' AS result;
