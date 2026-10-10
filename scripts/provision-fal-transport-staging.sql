-- Operator fixture setup only on staging yrqzwqywxfesmbvhzjgj, after app recovery is off.
-- No provider traffic or persisted capacity-policy activation. Retain audit rows.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$
DECLARE
    a uuid:=gen_random_uuid(); u uuid; m text:='transport-fixture-'||substr(a::text,1,8);
    paid jsonb; free_job jsonb; changed_rows int;
    inputs jsonb:='{"prompt":"controlled staging transport fixture"}'::jsonb;
BEGIN
    IF EXISTS(SELECT 1 FROM public.fal_capacity_policy WHERE enabled)
        OR EXISTS(SELECT 1 FROM public.fal_admission_control WHERE paused)
        OR EXISTS(SELECT 1 FROM public.fal_capacity_reservations WHERE released_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.fal_dispatch WHERE state IN ('READY','STARTED','UNKNOWN')) THEN
        RAISE EXCEPTION 'idle disabled staging baseline required';
    END IF;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(a,a::text||'@example.invalid',now());
    SELECT id INTO u FROM public.users WHERE auth_id=a::text;
    IF (SELECT balance FROM public.credit_balances WHERE user_id=u) IS DISTINCT FROM 10 THEN
        RAISE EXCEPTION 'fresh fixture grant mismatch';
    END IF;
    INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active,free_allowance_per_day,free_allowance_daily_budget)
        VALUES(m,'Controlled transport fixture','fal','staging-transport/controlled','text-to-image',2,0.03,'per_generation',false,true,2,2);
    paid:=public.ledger_debit(u,'transport-20261010-lost-reply',2,'debit:staging-transport-fixture',m,inputs,10,60);
    free_job:=public.submit_free_job(u,'transport-20261010-lost-body',m,inputs,10,60);
    IF paid->>'ok' IS DISTINCT FROM 'true' OR free_job->>'ok' IS DISTINCT FROM 'true' OR free_job->>'taken' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'fixture financial admission failed';
    END IF;
    INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES
        ((paid->>'job_id')::uuid,'staging-transport/controlled',inputs||'{"image_size":{"width":1024,"height":768}}'::jsonb),
        ((free_job->>'job_id')::uuid,'staging-transport/controlled',inputs||'{"image_size":{"width":1024,"height":768}}'::jsonb);
    INSERT INTO public.fal_capacity_reservations(job_id,admission_day,cost_microusd) VALUES
        ((paid->>'job_id')::uuid,(now() AT TIME ZONE 'UTC')::date,30000),
        ((free_job->>'job_id')::uuid,(now() AT TIME ZONE 'UTC')::date,30000);
    UPDATE public.model_catalog SET active=false WHERE id=m AND active;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    IF changed_rows<>1 THEN RAISE EXCEPTION 'fixture deactivation failed'; END IF;
    IF (SELECT balance FROM public.credit_balances WHERE user_id=u)<>8 THEN RAISE EXCEPTION 'fixture balance mismatch'; END IF;
    PERFORM set_config('veyrnox.transport_user',u::text,false);
END $$;
COMMIT;
SELECT user_id,id AS job_id,model_id,free_allowance,
    CASE WHEN free_allowance THEN 'lost_body' ELSE 'lost_reply' END AS scenario
FROM public.jobs WHERE user_id=current_setting('veyrnox.transport_user')::uuid;
