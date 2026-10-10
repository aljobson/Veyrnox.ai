-- Operator DML only, after owner approval and pausing staging app schema recovery.
-- One real fal image is authorized separately; this SQL itself submits nothing.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$
DECLARE a uuid:=gen_random_uuid(); u uuid; m text:='signed-retry-fixture-'||substr(a::text,1,8); admitted jsonb;
    inputs jsonb:='{"prompt":"A small blue ceramic teapot on a plain white background."}'::jsonb;
BEGIN
    IF EXISTS(SELECT 1 FROM public.fal_capacity_policy WHERE enabled)
        OR EXISTS(SELECT 1 FROM public.fal_admission_control WHERE paused)
        OR EXISTS(SELECT 1 FROM public.fal_capacity_reservations WHERE released_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.fal_dispatch WHERE state IN ('READY','STARTED','UNKNOWN')) THEN
        RAISE EXCEPTION 'idle disabled staging baseline required';
    END IF;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(a,a::text||'@example.invalid',now());
    SELECT id INTO u FROM public.users WHERE auth_id=a::text;
    IF (SELECT balance FROM public.credit_balances WHERE user_id=u) IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'fresh fixture mismatch'; END IF;
    INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active)
        VALUES(m,'Signed callback retry fixture','fal','fal-ai/flux-2-pro','text-to-image',2,0.03,'per_generation',false,true);
    admitted:=public.ledger_debit(u,'signed-retry-'||a::text,2,'debit:staging-signed-retry-fixture',m,inputs,10,60);
    IF admitted->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture debit failed'; END IF;
    INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES((admitted->>'job_id')::uuid,'fal-ai/flux-2-pro',
        inputs||'{"image_size":{"width":1024,"height":768},"num_images":1}'::jsonb);
    INSERT INTO public.fal_capacity_reservations(job_id,admission_day,cost_microusd)
        VALUES((admitted->>'job_id')::uuid,(now() AT TIME ZONE 'UTC')::date,30000);
    UPDATE public.model_catalog SET active=false WHERE id=m;
    PERFORM set_config('veyrnox.signed_retry_user',u::text,false);
END $$;
COMMIT;
SELECT user_id,id AS job_id,model_id FROM public.jobs WHERE user_id=current_setting('veyrnox.signed_retry_user')::uuid;
