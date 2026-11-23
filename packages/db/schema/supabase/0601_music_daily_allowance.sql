-- Daily Music allowance: an exact quote reservation, never ordinary Credits.
-- Both the policy and application rollout ship disabled. Applying this migration
-- cannot create provider spend until an owner separately enables both controls.
BEGIN;

ALTER TABLE public.music_generation_quotes
  ADD COLUMN IF NOT EXISTS daily_free_candidates INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charged_credits INTEGER,
  ADD COLUMN IF NOT EXISTS daily_allowance_date DATE;

CREATE OR REPLACE FUNCTION private.music_quote_charged_default()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Older quote functions insert at one price and then update the unit/total
  -- after duration pricing. Keep their paid wire valid while deriving the
  -- discounted total from the same three immutable quote facts.
  NEW.charged_credits:=NEW.total_credits-(NEW.daily_free_candidates*NEW.unit_credits);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_quote_charged_default() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS music_quote_charged_default ON public.music_generation_quotes;
CREATE TRIGGER music_quote_charged_default BEFORE INSERT OR UPDATE OF unit_credits,total_credits,daily_free_candidates,charged_credits
  ON public.music_generation_quotes
  FOR EACH ROW EXECUTE FUNCTION private.music_quote_charged_default();
UPDATE public.music_generation_quotes SET charged_credits=total_credits WHERE charged_credits IS NULL;
ALTER TABLE public.music_generation_quotes ALTER COLUMN charged_credits SET NOT NULL;
ALTER TABLE public.music_generation_quotes DROP CONSTRAINT IF EXISTS music_generation_quotes_daily_allowance_check;
ALTER TABLE public.music_generation_quotes ADD CONSTRAINT music_generation_quotes_daily_allowance_check CHECK(
  daily_free_candidates BETWEEN 0 AND 2
  AND charged_credits BETWEEN 0 AND total_credits
  AND charged_credits=total_credits-(daily_free_candidates*unit_credits)
  AND (daily_free_candidates=0)=(daily_allowance_date IS NULL));
ALTER TABLE public.music_generation_requests DROP CONSTRAINT IF EXISTS music_generation_requests_credit_quote_check;
ALTER TABLE public.music_generation_requests ADD CONSTRAINT music_generation_requests_credit_quote_check CHECK(credit_quote>=0);

CREATE TABLE IF NOT EXISTS public.music_daily_allowance_policy(
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled BOOLEAN NOT NULL DEFAULT false,
  candidates_per_user_per_day INTEGER NOT NULL DEFAULT 10 CHECK(candidates_per_user_per_day BETWEEN 0 AND 20),
  global_candidates_per_day INTEGER NOT NULL DEFAULT 100 CHECK(global_candidates_per_day BETWEEN 0 AND 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(NOT enabled OR (candidates_per_user_per_day>0 AND global_candidates_per_day>0))
);
INSERT INTO public.music_daily_allowance_policy(singleton,enabled,candidates_per_user_per_day,global_candidates_per_day)
VALUES(true,false,10,100) ON CONFLICT(singleton) DO NOTHING;
ALTER TABLE public.music_daily_allowance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_daily_allowance_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_daily_allowance_policy FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON TABLE public.music_daily_allowance_policy TO service_role;
DROP POLICY IF EXISTS music_daily_allowance_policy_service ON public.music_daily_allowance_policy;
CREATE POLICY music_daily_allowance_policy_service ON public.music_daily_allowance_policy
  FOR ALL TO service_role USING(true) WITH CHECK(singleton);

CREATE TABLE IF NOT EXISTS public.music_daily_allowance_reservations(
  quote_id UUID PRIMARY KEY REFERENCES public.music_generation_quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL CONSTRAINT music_daily_allowance_reservations_user_fkey REFERENCES public.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  candidates INTEGER NOT NULL CHECK(candidates BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK(state IN('LIVE','CONSUMED','SUPERSEDED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  CHECK((state='CONSUMED')=(consumed_at IS NOT NULL)),
  CHECK((state='SUPERSEDED')=(superseded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS music_daily_allowance_reservations_user_day_idx
  ON public.music_daily_allowance_reservations(user_id,day,state,expires_at);
CREATE INDEX IF NOT EXISTS music_daily_allowance_reservations_day_idx
  ON public.music_daily_allowance_reservations(day,state,expires_at);
ALTER TABLE public.music_daily_allowance_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_daily_allowance_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_daily_allowance_reservations FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.music_daily_allowance_claims(
  job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES public.music_generation_quotes(id) ON DELETE CASCADE,
  user_id UUID CONSTRAINT music_daily_allowance_claims_user_fkey REFERENCES public.users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._-]{8,128}$'),
  model_id TEXT NOT NULL REFERENCES public.model_catalog(id),
  day DATE NOT NULL,
  state TEXT NOT NULL CHECK(state IN('TAKEN','RETURNED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  UNIQUE(user_id,idempotency_key),
  CHECK((state='RETURNED')=(returned_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS music_daily_allowance_claims_user_day_idx
  ON public.music_daily_allowance_claims(user_id,day,state);
CREATE INDEX IF NOT EXISTS music_daily_allowance_claims_day_idx
  ON public.music_daily_allowance_claims(day,state);
ALTER TABLE public.music_daily_allowance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_daily_allowance_claims FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_daily_allowance_claims FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.music_daily_allowance_claims ALTER COLUMN user_id DROP NOT NULL;

-- A migration replay may meet tables written by an earlier 0601 draft. Restore
-- the same explicit privacy classification without replacing either table.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='music_daily_allowance_reservations_user_fkey'
      AND conrelid='public.music_daily_allowance_reservations'::regclass) THEN
    ALTER TABLE public.music_daily_allowance_reservations ADD CONSTRAINT music_daily_allowance_reservations_user_fkey
      FOREIGN KEY(user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='music_daily_allowance_claims_user_fkey'
      AND conrelid='public.music_daily_allowance_claims'::regclass) THEN
    ALTER TABLE public.music_daily_allowance_claims ADD CONSTRAINT music_daily_allowance_claims_user_fkey
      FOREIGN KEY(user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.music_daily_allowance_eligible(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user AND u.deleted_at IS NULL
    AND u.frozen_at IS NULL AND (u.hold_until IS NULL OR u.hold_until<=now()))
    AND EXISTS(SELECT 1 FROM public.ledger_entries l WHERE l.user_id=p_user AND l.reason='grant:signup')
$$;
REVOKE ALL ON FUNCTION private.music_daily_allowance_eligible(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_daily_allowance_status(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; d DATE:=(now() AT TIME ZONE 'UTC')::DATE; policy public.music_daily_allowance_policy%ROWTYPE;
 used_user INTEGER; used_global INTEGER; eligible BOOLEAN; remaining INTEGER;
BEGIN
  SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
  IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT * INTO policy FROM public.music_daily_allowance_policy WHERE singleton;
  eligible:=private.music_daily_allowance_eligible(u);
  IF NOT FOUND OR NOT policy.enabled OR NOT eligible THEN
    RETURN jsonb_build_object('ok',true,'enabled',false,'eligible',eligible,
      'candidates_remaining',0,'pairs_remaining',0,
      'reset_at',((d+1)::timestamp AT TIME ZONE 'UTC'));
  END IF;
  SELECT coalesce(sum(x.candidates),0)::INTEGER INTO used_user FROM(
    SELECT 1 AS candidates FROM public.music_daily_allowance_claims c
      WHERE c.user_id=u AND c.day=d AND c.state='TAKEN'
    UNION ALL SELECT r.candidates FROM public.music_daily_allowance_reservations r
      WHERE r.user_id=u AND r.day=d AND r.state='LIVE' AND r.expires_at>now())x;
  SELECT coalesce(sum(x.candidates),0)::INTEGER INTO used_global FROM(
    SELECT 1 AS candidates FROM public.music_daily_allowance_claims c WHERE c.day=d AND c.state='TAKEN'
    UNION ALL SELECT r.candidates FROM public.music_daily_allowance_reservations r
      WHERE r.day=d AND r.state='LIVE' AND r.expires_at>now())x;
  remaining:=greatest(0,least(policy.candidates_per_user_per_day-used_user,
    policy.global_candidates_per_day-used_global));
  RETURN jsonb_build_object('ok',true,'enabled',true,'eligible',true,
    'candidates_remaining',remaining,'pairs_remaining',floor(remaining/2.0)::INTEGER,
    'reset_at',((d+1)::timestamp AT TIME ZONE 'UTC'));
END $$;
REVOKE ALL ON FUNCTION public.music_daily_allowance_status(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_daily_allowance_status(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION private.music_reserve_daily_allowance(p_auth_id TEXT,p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; q public.music_generation_quotes%ROWTYPE; policy public.music_daily_allowance_policy%ROWTYPE;
 d DATE:=(now() AT TIME ZONE 'UTC')::DATE; used_user INTEGER; used_global INTEGER; free_count INTEGER; charged INTEGER;
BEGIN
  IF p_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN p_result; END IF;
  SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id;
  IF u IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||d::TEXT,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||d::TEXT||':'||u::TEXT,0));
  END IF;
  SELECT * INTO q FROM public.music_generation_quotes
    WHERE user_id=u AND id=(p_result->>'quote_id')::UUID FOR UPDATE;
  IF u IS NULL OR q.provider_contract<>'crun-suno-v1' OR q.model_id NOT IN('ace-step','ace-step-1.5') THEN
    RETURN p_result||jsonb_build_object('list_credits',(p_result->>'total_credits')::INTEGER,
      'charged_credits',(p_result->>'total_credits')::INTEGER,'daily_free_candidates',0); END IF;
  SELECT * INTO policy FROM public.music_daily_allowance_policy WHERE singleton FOR SHARE;
  IF NOT FOUND OR NOT policy.enabled OR NOT private.music_daily_allowance_eligible(u) THEN
    RETURN p_result||jsonb_build_object('list_credits',q.total_credits,'charged_credits',q.total_credits,'daily_free_candidates',0); END IF;
  UPDATE public.music_daily_allowance_reservations SET state='SUPERSEDED',superseded_at=now()
    WHERE user_id=u AND state='LIVE';
  SELECT coalesce(sum(x.candidates),0)::INTEGER INTO used_user FROM(
    SELECT 1 AS candidates FROM public.music_daily_allowance_claims c WHERE c.user_id=u AND c.day=d AND c.state='TAKEN'
    UNION ALL SELECT r.candidates FROM public.music_daily_allowance_reservations r
      WHERE r.user_id=u AND r.day=d AND r.state='LIVE' AND r.expires_at>now())x;
  SELECT coalesce(sum(x.candidates),0)::INTEGER INTO used_global FROM(
    SELECT 1 AS candidates FROM public.music_daily_allowance_claims c WHERE c.day=d AND c.state='TAKEN'
    UNION ALL SELECT r.candidates FROM public.music_daily_allowance_reservations r
      WHERE r.day=d AND r.state='LIVE' AND r.expires_at>now())x;
  free_count:=greatest(0,least(2,policy.candidates_per_user_per_day-used_user,
    policy.global_candidates_per_day-used_global));
  charged:=q.total_credits-(free_count*q.unit_credits);
  IF free_count>0 THEN
    UPDATE public.music_generation_quotes SET daily_free_candidates=free_count,charged_credits=charged,daily_allowance_date=d
      WHERE id=q.id RETURNING * INTO q;
    INSERT INTO public.music_daily_allowance_reservations(quote_id,user_id,day,candidates,state,expires_at)
      VALUES(q.id,u,d,free_count,'LIVE',q.expires_at);
  END IF;
  RETURN p_result||jsonb_build_object('list_credits',q.total_credits,'total_credits',charged,
    'charged_credits',charged,'daily_free_candidates',free_count,
    'balance_after',(p_result->>'balance')::INTEGER-charged,
    'affordable',(p_result->>'balance')::INTEGER>=charged,
    'daily_allowance_reset_at',((d+1)::timestamp AT TIME ZONE 'UTC'));
END $$;
REVOKE ALL ON FUNCTION private.music_reserve_daily_allowance(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote_with_daily_allowance(
 p_auth_id TEXT,p_prompt TEXT,p_title TEXT,p_model_id TEXT,p_variety INTEGER,
 p_style_influence INTEGER,p_exclude_styles TEXT,p_duration_seconds INTEGER,
 p_provider_contract TEXT,p_instrumental BOOLEAN,p_suno_model TEXT,p_vocal_gender TEXT,p_weirdness NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN private.music_reserve_daily_allowance(p_auth_id,public.music_create_quote(p_auth_id,p_prompt,p_title,p_model_id,
  p_variety,p_style_influence,p_exclude_styles,p_duration_seconds,p_provider_contract,p_instrumental,p_suno_model,p_vocal_gender,p_weirdness));
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote_with_daily_allowance(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote_with_daily_allowance(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_custom_quote_with_daily_allowance(
 p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID,p_draft_revision INTEGER,
 p_instrumental BOOLEAN,p_rights_confirmed BOOLEAN,p_duration_seconds INTEGER,
 p_suno_model TEXT,p_vocal_gender TEXT,p_style_influence INTEGER,p_weirdness NUMERIC,p_variety INTEGER,p_exclude_styles TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN private.music_reserve_daily_allowance(p_auth_id,public.music_create_custom_quote(p_auth_id,p_provider_contract,p_draft_id,
  p_draft_revision,p_instrumental,p_rights_confirmed,p_duration_seconds,p_suno_model,p_vocal_gender,p_style_influence,p_weirdness,p_variety,p_exclude_styles));
END $$;
REVOKE ALL ON FUNCTION public.music_create_custom_quote_with_daily_allowance(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER,TEXT,TEXT,INTEGER,NUMERIC,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote_with_daily_allowance(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER,TEXT,TEXT,INTEGER,NUMERIC,INTEGER,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION private.music_admit_daily_free_job(
 p_user UUID,p_key TEXT,p_model TEXT,p_inputs JSONB,p_quote UUID,p_day DATE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing UUID; job UUID; spendable INTEGER; hold_until TIMESTAMPTZ;
BEGIN
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO spendable
    FROM public.credit_balances WHERE user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
  SELECT id INTO existing FROM public.jobs WHERE user_id=p_user AND idempotency_key=p_key;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'job_id',existing,'idempotent',true,'balance_after',spendable); END IF;
  IF private.fal_admission_paused(p_model,false) THEN
    RETURN jsonb_build_object('ok',false,'code','PROVIDER_ADMISSION_PAUSED','retry_after_seconds',60); END IF;
  IF NOT private.music_daily_allowance_eligible(p_user) THEN
    SELECT u.hold_until INTO hold_until FROM public.users u WHERE u.id=p_user AND u.hold_until>now();
    RETURN jsonb_build_object('ok',false,'code',CASE WHEN hold_until IS NULL THEN 'ACCOUNT_FROZEN' ELSE 'ACCOUNT_ON_HOLD' END,
      'hold_until',hold_until); END IF;
  INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state,free_allowance)
    VALUES(p_user,p_key,p_model,0,p_inputs,'DEBITED',true) RETURNING id INTO job;
  INSERT INTO public.music_daily_allowance_claims(job_id,quote_id,user_id,idempotency_key,model_id,day,state)
    VALUES(job,p_quote,p_user,p_key,p_model,p_day,'TAKEN');
  RETURN jsonb_build_object('ok',true,'job_id',job,'idempotent',false,'balance_after',spendable);
END $$;
REVOKE ALL ON FUNCTION private.music_admit_daily_free_job(UUID,TEXT,TEXT,JSONB,UUID,DATE) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_submit_pair_daily(
 p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_recent INTEGER; q public.music_generation_quotes%ROWTYPE;
 p public.music_prompt_specs%ROWTYPE; m public.model_catalog%ROWTYPE; req public.music_generation_requests%ROWTYPE;
 existing public.music_generation_requests%ROWTYPE; reservation public.music_daily_allowance_reservations%ROWTYPE;
 one JSONB; two JSONB; job1 UUID; job2 UUID; failure JSONB; jobs JSONB; payload JSONB; input JSONB;
 expected_contract TEXT; v_open BOOLEAN; policy_enabled BOOLEAN;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs
    FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
    FROM public.credit_balances WHERE user_id=v_user;
  SELECT * INTO q FROM public.music_generation_quotes WHERE id=existing.quote_id;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
    'balance_after',v_balance,'idempotent',true,'provider_contract',q.provider_contract,
    'daily_free_candidates',q.daily_free_candidates,'charged_credits',q.charged_credits);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||(now() AT TIME ZONE 'UTC')::DATE::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||(now() AT TIME ZONE 'UTC')::DATE::TEXT||':'||v_user::TEXT,0));
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
   FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs
    FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT * INTO q FROM public.music_generation_quotes WHERE id=existing.quote_id;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
    'balance_after',v_balance,'idempotent',true,'provider_contract',q.provider_contract,
    'daily_free_candidates',q.daily_free_candidates,'charged_credits',q.charged_credits);
 END IF;
 IF NOT private.music_daily_allowance_eligible(v_user) THEN
  RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 SELECT * INTO q FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF q.daily_free_candidates<=0 THEN RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 IF q.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF q.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 SELECT * INTO reservation FROM public.music_daily_allowance_reservations WHERE quote_id=q.id FOR UPDATE;
 SELECT enabled INTO policy_enabled FROM public.music_daily_allowance_policy WHERE singleton FOR SHARE;
 IF NOT FOUND OR policy_enabled IS DISTINCT FROM true OR reservation.quote_id IS NULL OR reservation.state<>'LIVE'
   OR reservation.user_id<>v_user OR reservation.day<>q.daily_allowance_date
   OR reservation.candidates<>q.daily_free_candidates OR reservation.expires_at<=now()
   OR reservation.day<>(now() AT TIME ZONE 'UTC')::DATE
 THEN RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 SELECT * INTO p FROM public.music_prompt_specs WHERE id=q.prompt_spec_id AND user_id=v_user;
 SELECT * INTO m FROM public.model_catalog WHERE id=q.model_id FOR SHARE;
 expected_contract:=CASE m.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1'
  WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' END;
 IF NOT FOUND OR expected_contract IS NULL OR NOT m.active OR m.gated_flag OR m.modality<>'text-to-audio'
  OR m.provider_endpoint IS DISTINCT FROM q.provider_endpoint OR q.provider_contract IS DISTINCT FROM expected_contract
  OR expected_contract<>'crun-suno-v1' OR m.provider IS DISTINCT FROM 'crun' OR q.model_id NOT IN('ace-step','ace-step-1.5')
  OR p.provider_contract IS DISTINCT FROM q.provider_contract
  OR m.credits_5s*private.music_duration_price_blocks(q.model_id,q.provider_contract,p.duration_seconds)<>q.unit_credits
  OR m.updated_at IS DISTINCT FROM q.catalog_updated_at
  OR q.charged_credits<>q.total_credits-(q.daily_free_candidates*q.unit_credits)
 THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 SELECT NOT admission_open INTO v_open FROM public.provider_spend_provider_policy WHERE provider='crun';
 IF coalesce(v_open,true) OR EXISTS(SELECT 1 FROM public.model_routes r WHERE r.model_id=q.model_id AND r.supplier='crun'
   AND r.endpoint=q.provider_endpoint AND r.breaker_opened_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b WHERE b.endpoint=q.provider_endpoint AND b.suno_model=p.suno_model AND b.is_open)
 THEN RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 IF p.bpm IS NOT NULL OR p.key_scale IS NOT NULL OR p.time_signature IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF (p.mode='custom' OR p.title IS NOT NULL OR p.styles IS NOT NULL OR p.exclude_styles IS NOT NULL
    OR p.style_influence IS NOT NULL OR p.variety IS NOT NULL OR p.duration_seconds<>60)
   AND NOT p.instrumental AND nullif(btrim(coalesce(p.lyrics,'')),'') IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF q.model_id='ace-step-1.5' AND NOT private.music_paid_plan_active(v_user) THEN
  RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 IF v_balance<q.charged_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
    VALUES(v_user,q.id,p.id,m.id,p_idempotency_key,q.charged_credits) RETURNING * INTO req;
  IF q.daily_free_candidates>=1 THEN
    one:=private.music_admit_daily_free_job(v_user,p_idempotency_key||'.1',m.id,
      jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',1),q.id,reservation.day);
  ELSE
    one:=public.ledger_debit(v_user,p_idempotency_key||'.1',q.unit_credits,'debit:music_generation',m.id,
      jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',1),0,60);
  END IF;
  IF one->>'ok' IS DISTINCT FROM 'true' THEN failure:=one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='pair debit one'; END IF;
  IF q.daily_free_candidates>=2 THEN
    two:=private.music_admit_daily_free_job(v_user,p_idempotency_key||'.2',m.id,
      jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',2),q.id,reservation.day);
  ELSE
    two:=public.ledger_debit(v_user,p_idempotency_key||'.2',q.unit_credits,'debit:music_generation',m.id,
      jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',2),0,60);
  END IF;
  IF two->>'ok' IS DISTINCT FROM 'true' THEN failure:=two; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='pair debit two'; END IF;
  job1:=(one->>'job_id')::UUID; job2:=(two->>'job_id')::UUID;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
    VALUES(v_user,req.id,1,job1),(v_user,req.id,2,job2);
  input:=CASE WHEN p.mode='simple' AND p.title IS NULL AND p.styles IS NULL AND p.exclude_styles IS NULL
      AND p.style_influence IS NULL AND p.variety IS NULL AND p.duration_seconds=60
    THEN jsonb_build_object('mode','simple','prompt',p.prompt,'instrumental',p.instrumental,'suno_model',p.suno_model)
    ELSE jsonb_strip_nulls(jsonb_build_object('mode','custom','instrumental',p.instrumental,'suno_model',p.suno_model,
     'title',p.title,'tags',coalesce(nullif(p.styles,''),p.prompt),'lyrics',CASE WHEN p.instrumental THEN NULL ELSE p.lyrics END,
     'negative_tags',CASE WHEN p.exclude_styles IS NULL THEN NULL ELSE left(p.exclude_styles,200) END,
     'vocal_gender',CASE p.vocal_gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' ELSE NULL END,
     'style_weight',CASE WHEN p.style_influence IS NULL THEN NULL ELSE round(p.style_influence::NUMERIC/100,2) END,
     'weirdness_constraint',p.weirdness,'duration',p.duration_seconds,
     'variety',CASE WHEN p.variety IS NULL THEN NULL ELSE round(p.variety::NUMERIC/25)::INTEGER END)) END;
  payload:=jsonb_build_object('model','suno/music-generate','input',input);
  INSERT INTO public.crun_dispatch(job_id,endpoint,payload)
    VALUES(job1,q.provider_endpoint,payload),(job2,q.provider_endpoint,payload);
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=q.id;
  UPDATE public.music_daily_allowance_reservations SET state='CONSUMED',consumed_at=now() WHERE quote_id=q.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN coalesce(failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED'));
 END;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
   FROM public.credit_balances WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'request_id',req.id,'state','debited','job_ids',jsonb_build_array(job1,job2),
  'balance_after',v_balance,'idempotent',false,'provider_contract',q.provider_contract,
  'daily_free_candidates',q.daily_free_candidates,'charged_credits',q.charged_credits);
END $$;
REVOKE ALL ON FUNCTION private.music_submit_pair_daily(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_submit_pair(p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_active INTEGER; v_replay BOOLEAN; v_result JSONB; v_contract TEXT; free_count INTEGER;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user::TEXT||':'||p_idempotency_key,0));
 SELECT EXISTS(SELECT 1 FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key) INTO v_replay;
 IF NOT v_replay THEN
  SELECT count(*) INTO v_active FROM public.music_generation_requests WHERE user_id=v_user AND status IN('debited','running');
  IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
 END IF;
 SELECT daily_free_candidates INTO free_count FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user;
 v_result:=CASE WHEN coalesce(free_count,0)>0 THEN private.music_submit_pair_daily(p_auth_id,p_quote_id,p_idempotency_key)
   ELSE private.music_submit_pair_unbounded(p_auth_id,p_quote_id,p_idempotency_key) END;
 IF v_result->>'ok'='true' AND NOT(v_result?'provider_contract') THEN
  SELECT q.provider_contract INTO v_contract FROM public.music_generation_requests r
    JOIN public.music_generation_quotes q ON q.id=r.quote_id
    WHERE r.user_id=v_user AND r.id=(v_result->>'request_id')::UUID;
  v_result:=v_result||jsonb_build_object('provider_contract',v_contract);
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) TO service_role;

-- The existing ledger_refund calls this one choke point for every zero-credit
-- failure/cancellation. Resolve the Music claim first, then preserve the generic behavior.
CREATE OR REPLACE FUNCTION public.free_allowance_return(p_user_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed INTEGER;
BEGIN
 UPDATE public.music_daily_allowance_claims c SET state='RETURNED',returned_at=now()
  WHERE c.user_id=p_user_id AND c.idempotency_key=p_idempotency_key AND c.state='TAKEN';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 THEN RETURN jsonb_build_object('ok',true,'returned',true); END IF;
 UPDATE public.model_free_allowance_claims SET state='RETURNED',returned_at=now()
  WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key AND state='TAKEN';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'returned',changed=1);
END $$;
REVOKE ALL ON FUNCTION public.free_allowance_return(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.free_allowance_return(UUID,TEXT) TO service_role;

-- Music claims have a durable job identity even after privacy erasure removes
-- their user id. Refund by that identity, then fall back to the legacy
-- per-model allowance for non-Music zero-credit jobs.
CREATE OR REPLACE FUNCTION private.return_free_allowance_for_job(p_job_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed INTEGER; j public.jobs%ROWTYPE;
BEGIN
 UPDATE public.music_daily_allowance_claims SET state='RETURNED',returned_at=now()
  WHERE job_id=p_job_id AND state='TAKEN';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 THEN RETURN true; END IF;
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.model_free_allowance_claims SET state='RETURNED',returned_at=now()
  WHERE user_id=j.user_id AND idempotency_key=j.idempotency_key AND state='TAKEN';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION private.return_free_allowance_for_job(UUID) FROM PUBLIC,anon,authenticated;

-- Preserve the 0206 paid-refund body while making the zero-credit result tell
-- the truth about whether this call actually returned an allowance slot.
CREATE OR REPLACE FUNCTION public.ledger_refund(
 p_job_id UUID,p_user_id UUID,p_credits INTEGER,p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_job public.jobs%ROWTYPE; v_existing UUID; v_entry_id UUID; v_new_balance INTEGER;
 v_free_part INTEGER; v_sub_part INTEGER; v_sub_live INTEGER; v_sub_stale INTEGER;
 v_sub_cycle INTEGER; v_sub_expires TIMESTAMPTZ; v_returned BOOLEAN;
BEGIN
 IF p_credits IS NULL OR p_credits<0 THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_CREDITS',
   'message',format('refund credits must be a positive integer (got %s)',p_credits));
 END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); END IF;
 IF v_job.user_id<>p_user_id THEN RETURN jsonb_build_object('ok',false,'code','USER_MISMATCH'); END IF;
 IF p_credits>v_job.credits THEN
  RETURN jsonb_build_object('ok',false,'code','REFUND_EXCEEDS_DEBIT',
   'message',format('refund %s exceeds job credits %s',p_credits,v_job.credits));
 END IF;
 IF v_job.state IN('SUCCEEDED','STORED') THEN RETURN jsonb_build_object('ok',false,'code','JOB_SUCCEEDED'); END IF;
 IF p_credits=0 THEN
  IF NOT v_job.free_allowance THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_CREDITS',
    'message','refund credits must be a positive integer (got 0)');
  END IF;
  v_returned:=private.return_free_allowance_for_job(v_job.id);
  UPDATE public.jobs SET state='REFUNDED',updated_at=now()
   WHERE id=p_job_id AND state IN('DEBITED','SUBMITTED','FAILOVER','FAILED');
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
   INTO v_new_balance FROM public.credit_balances WHERE user_id=p_user_id;
  RETURN jsonb_build_object('ok',true,'entry_id',NULL,'idempotent',NOT v_returned,
   'allowance_returned',v_returned,'balance_after',v_new_balance);
 END IF;
 SELECT id INTO v_existing FROM public.ledger_entries
  WHERE job_id=p_job_id AND delta>0 AND reason LIKE 'refund:%';
 IF v_existing IS NOT NULL THEN
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
   INTO v_new_balance FROM public.credit_balances WHERE user_id=p_user_id;
  RETURN jsonb_build_object('ok',true,'entry_id',v_existing,'idempotent',true,'balance_after',v_new_balance);
 END IF;
 SELECT subscription_cycle,subscription_expires_at INTO v_sub_cycle,v_sub_expires
  FROM public.credit_balances WHERE user_id=p_user_id FOR UPDATE;
 SELECT LEAST(p_credits,COALESCE(-SUM(subscription_delta),0)),
   CASE WHEN v_sub_expires>now() THEN COALESCE(-SUM(subscription_delta)
    FILTER(WHERE subscription_cycle=v_sub_cycle),0) ELSE 0 END
  INTO v_sub_part,v_sub_live FROM public.ledger_entries WHERE job_id=p_job_id AND delta<0;
 v_sub_stale:=v_sub_part-LEAST(v_sub_part,v_sub_live);
 SELECT LEAST(p_credits-v_sub_part,COALESCE(-SUM(COALESCE(free_delta,delta-subscription_delta)),0))
  INTO v_free_part FROM public.ledger_entries WHERE job_id=p_job_id AND delta<0;
 INSERT INTO public.ledger_entries(user_id,delta,free_delta,subscription_delta,subscription_cycle,reason,job_id)
  VALUES(p_user_id,p_credits,v_free_part,v_sub_part,
   CASE WHEN v_sub_part>0 THEN v_sub_cycle END,p_reason,p_job_id) RETURNING id INTO v_entry_id;
 IF v_sub_stale>0 THEN
  INSERT INTO public.ledger_entries(user_id,delta,free_delta,subscription_delta,subscription_cycle,reason,job_id)
   VALUES(p_user_id,-v_sub_stale,0,-v_sub_stale,v_sub_cycle,'expire:subscription',NULL);
 END IF;
 UPDATE public.credit_balances SET balance=balance+p_credits-v_sub_stale,
  free_balance=free_balance+v_free_part,
  subscription_balance=subscription_balance+v_sub_part-v_sub_stale,updated_at=now()
  WHERE user_id=p_user_id
  RETURNING balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
  INTO v_new_balance;
 UPDATE public.jobs SET state='REFUNDED',updated_at=now()
  WHERE id=p_job_id AND state IN('DEBITED','SUBMITTED','FAILOVER','FAILED');
 RETURN jsonb_build_object('ok',true,'entry_id',v_entry_id,'idempotent',false,'balance_after',v_new_balance);
END $$;
REVOKE ALL ON FUNCTION public.ledger_refund(UUID,UUID,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_refund(UUID,UUID,INTEGER,TEXT) TO service_role;

-- 0591 deliberately protects live Crun dispatches. Once a dispatch is
-- terminal, sweep zero-credit FAILED Music jobs just like paid FAILED jobs so
-- an interrupted refund cannot consume a daily slot forever.
CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
 p_debited_minutes INTEGER DEFAULT 15,p_submitted_minutes INTEGER DEFAULT 120,
 p_limit INTEGER DEFAULT 200,p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job RECORD; v_refunded INTEGER:=0; v_failed INTEGER:=0; v_unstored INTEGER:=0; v_unpaid INTEGER:=0; v_res JSONB;
BEGIN
 FOR v_job IN SELECT j.id,j.user_id,j.credits,j.state FROM public.jobs j
  WHERE j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
   AND NOT EXISTS(SELECT 1 FROM public.crun_dispatch d WHERE d.job_id=j.id
    AND d.state IN('READY','STARTED','ACCEPTED','UNKNOWN','DEFERRED'))
   AND ((j.state='DEBITED' AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT(j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS(
       SELECT 1 FROM public.provider_spend_reservations r WHERE r.user_id=j.user_id
        AND (r.effect_key=j.idempotency_key OR starts_with(r.effect_key,j.idempotency_key||':a')))))
    OR (j.state IN('SUBMITTED','FAILOVER') AND j.updated_at<now()-make_interval(mins=>p_submitted_minutes))
    OR (j.state='SUCCEEDED' AND j.updated_at<now()-make_interval(mins=>p_succeeded_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=j.id))
    OR (j.state='FAILED' AND (j.credits>0 OR j.free_allowance)
      AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.ledger_entries le WHERE le.job_id=j.id AND le.delta>0)))
  ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
 LOOP
  IF v_job.state IN('SUBMITTED','FAILOVER') THEN
   UPDATE public.jobs SET state='FAILED',error_code='stuck_timeout',updated_at=now() WHERE id=v_job.id; v_failed:=v_failed+1;
  ELSIF v_job.state='SUCCEEDED' THEN
   UPDATE public.jobs SET state='FAILED',error_code='asset_store_failed',updated_at=now() WHERE id=v_job.id; v_unstored:=v_unstored+1;
  ELSIF v_job.state='FAILED' THEN v_unpaid:=v_unpaid+1; END IF;
  v_res:=public.ledger_refund(v_job.id,v_job.user_id,v_job.credits,CASE v_job.state
   WHEN 'DEBITED' THEN 'refund:stuck_debited' WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
   WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
  IF (v_res->>'ok')::BOOLEAN AND NOT COALESCE((v_res->>'idempotent')::BOOLEAN,false) THEN v_refunded:=v_refunded+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'failed',v_failed,'unstored',v_unstored,'unpaid_failures',v_unpaid,'refunded',v_refunded);
END $$;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_free_allowance()
RETURNS TABLE(kind TEXT,ref TEXT,detail TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT 'user_over_cap',c.user_id::TEXT||' '||c.model_id||' '||c.day::TEXT,
   count(*)::TEXT||' taken, cap '||m.free_allowance_per_day::TEXT
 FROM public.model_free_allowance_claims c JOIN public.model_catalog m ON m.id=c.model_id
 WHERE c.state='TAKEN' AND c.day=(now() AT TIME ZONE 'UTC')::DATE
 GROUP BY c.user_id,c.model_id,c.day,m.free_allowance_per_day HAVING count(*)>m.free_allowance_per_day
 UNION ALL SELECT 'model_over_budget',c.model_id||' '||c.day::TEXT,
   count(*)::TEXT||' taken, budget '||m.free_allowance_daily_budget::TEXT
 FROM public.model_free_allowance_claims c JOIN public.model_catalog m ON m.id=c.model_id
 WHERE c.state='TAKEN' AND c.day=(now() AT TIME ZONE 'UTC')::DATE
 GROUP BY c.model_id,c.day,m.free_allowance_daily_budget HAVING count(*)>m.free_allowance_daily_budget
 UNION ALL SELECT 'total_budget_over_5_dollars','all models',sum(free_allowance_daily_budget*provider_cost_per_unit)::TEXT
 FROM public.model_catalog WHERE active AND free_allowance_per_day>0
 HAVING sum(free_allowance_daily_budget*provider_cost_per_unit)>5.00
 UNION ALL SELECT 'music_user_over_cap',c.user_id::TEXT||' '||c.day::TEXT,
   count(*)::TEXT||' taken, cap '||p.candidates_per_user_per_day::TEXT
 FROM public.music_daily_allowance_claims c CROSS JOIN public.music_daily_allowance_policy p
 WHERE c.user_id IS NOT NULL AND c.state='TAKEN' AND c.day=(now() AT TIME ZONE 'UTC')::DATE
 GROUP BY c.user_id,c.day,p.candidates_per_user_per_day HAVING count(*)>p.candidates_per_user_per_day
 UNION ALL SELECT 'music_global_over_budget',c.day::TEXT,
   count(*)::TEXT||' taken, budget '||p.global_candidates_per_day::TEXT
 FROM public.music_daily_allowance_claims c CROSS JOIN public.music_daily_allowance_policy p
 WHERE c.state='TAKEN' AND c.day=(now() AT TIME ZONE 'UTC')::DATE
 GROUP BY c.day,p.global_candidates_per_day HAVING count(*)>p.global_candidates_per_day
 UNION ALL SELECT 'music_return_drift',c.job_id::TEXT,'returned job still has a taken allowance'
 FROM public.music_daily_allowance_claims c JOIN public.jobs j ON j.id=c.job_id
 WHERE c.state='TAKEN' AND j.state='REFUNDED'
 UNION ALL SELECT 'music_failed_unreturned',c.job_id::TEXT,'failed job still has a taken allowance'
 FROM public.music_daily_allowance_claims c JOIN public.jobs j ON j.id=c.job_id
 WHERE c.state='TAKEN' AND j.state='FAILED'
 UNION ALL SELECT 'music_orphan_claim',c.job_id::TEXT,'claim is missing a candidate or consumed reservation'
 FROM public.music_daily_allowance_claims c
 LEFT JOIN public.music_generation_candidates candidate ON candidate.job_id=c.job_id
 LEFT JOIN public.music_daily_allowance_reservations r ON r.quote_id=c.quote_id AND r.state='CONSUMED'
 WHERE c.state='TAKEN' AND (candidate.job_id IS NULL OR r.quote_id IS NULL)
 UNION ALL SELECT 'music_reservation_drift',r.quote_id::TEXT,'quote and reservation allowance differ'
 FROM public.music_daily_allowance_reservations r JOIN public.music_generation_quotes q ON q.id=r.quote_id
 WHERE r.state IN('LIVE','CONSUMED') AND r.candidates<>q.daily_free_candidates
$$;
REVOKE ALL ON FUNCTION public.reconcile_free_allowance() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_free_allowance() TO service_role;

CREATE OR REPLACE FUNCTION public.read_music_daily_allowance_export_page(
 p_auth_id TEXT,p_aal TEXT,p_export_id UUID,p_after TEXT,p_key TEXT,p_page_size INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; request public.privacy_export_requests%ROWTYPE; rows JSONB; boundary JSONB; n INTEGER;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO request FROM public.privacy_export_requests WHERE id=p_export_id AND user_id=u.id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','export_not_found'); END IF;
 IF request.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'error','export_expired'); END IF;
 IF private.account_deletion_blockers(u.id,p_auth_id) && ARRAY['account_frozen','account_on_hold']::TEXT[] THEN
  RETURN jsonb_build_object('ok',false,'error','account_restricted'); END IF;
 IF coalesce(p_aal,'')<>'aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=p_auth_id::UUID AND factor_type='totp' AND status='verified') THEN
  RETURN jsonb_build_object('ok',false,'error','mfa_required'); END IF;
 IF p_page_size IS NOT NULL AND p_page_size NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('ok',false,'error','invalid_section'); END IF;
 n:=least(coalesce(p_page_size,200),200);
 WITH events AS(
  SELECT jsonb_build_object('kind','policy','enabled',p.enabled,
      'candidates_per_user_per_day',p.candidates_per_user_per_day,
      'global_candidates_per_day',p.global_candidates_per_day,
      'reset_at',(((request.as_of AT TIME ZONE 'UTC')::DATE+1)::TIMESTAMP AT TIME ZONE 'UTC')) data,
    '1970-01-01 00:00:00+00'::TIMESTAMPTZ ord,'00000000-0000-0000-0000-000000000000'::UUID tie
  FROM public.music_daily_allowance_policy p WHERE p.singleton
  UNION ALL
  SELECT jsonb_build_object('kind','reservation','quote_id',r.quote_id,'day',r.day,'candidates',r.candidates,
      'state',r.state,'expires_at',r.expires_at,'created_at',r.created_at,
      'consumed_at',r.consumed_at,'superseded_at',r.superseded_at),r.created_at,r.quote_id
  FROM public.music_daily_allowance_reservations r WHERE r.user_id=u.id AND r.created_at<=request.as_of
  UNION ALL
  SELECT jsonb_build_object('kind','claim','job_id',c.job_id,'quote_id',c.quote_id,'model_id',c.model_id,'day',c.day,
      'state',c.state,'created_at',c.created_at,'returned_at',c.returned_at),c.created_at,c.job_id
  FROM public.music_daily_allowance_claims c WHERE c.user_id=u.id AND c.created_at<=request.as_of
 ), page AS(
  SELECT data,ord,tie FROM events
  WHERE p_after IS NULL OR (ord,tie)>(p_after::TIMESTAMPTZ,p_key::UUID)
  ORDER BY ord,tie LIMIT n
 ) SELECT coalesce(jsonb_agg(data ORDER BY ord,tie),'[]'::JSONB),
   (SELECT jsonb_build_object('after',ord,'key',tie) FROM page ORDER BY ord DESC,tie DESC LIMIT 1) INTO rows,boundary FROM page;
 IF jsonb_array_length(rows)<n THEN boundary:=NULL; END IF;
 RETURN jsonb_build_object('ok',true,'rows',rows,'next',boundary);
END $$;
REVOKE ALL ON FUNCTION public.read_music_daily_allowance_export_page(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_music_daily_allowance_export_page(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION private.music_daily_allowance_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  DELETE FROM public.music_daily_allowance_reservations WHERE user_id=NEW.id;
  -- Keep anonymous same-day claims until the UTC budget window ends; deleting
  -- them here would make already-billed provider work look like free capacity.
  UPDATE public.music_daily_allowance_claims SET user_id=NULL WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_daily_allowance_forget_erased_user() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS users_music_daily_allowance_forget_erased ON public.users;
CREATE TRIGGER users_music_daily_allowance_forget_erased AFTER UPDATE OF deleted_at ON public.users
 FOR EACH ROW EXECUTE FUNCTION private.music_daily_allowance_forget_erased_user();

-- Allowance bookkeeping is incidental, not owned Music content. Keep these two
-- classified FKs out of the generic Music-content blocker: reservations are
-- erased and claims are anonymized by the trigger above.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID,p_auth_id TEXT)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_blockers TEXT[]; v_auth UUID; v_ref RECORD; v_music_present BOOLEAN; BEGIN
  v_blockers:=ARRAY[]::TEXT[];
  BEGIN v_auth:=p_auth_id::UUID; EXCEPTION WHEN invalid_text_representation THEN v_auth:=NULL; END;
  IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS(SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS(SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN('active','past_due'))
     OR EXISTS(SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS(SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS(SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS(SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS(SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.music_albums a WHERE a.user_id=p_user_id AND a.status<>'deleted') THEN
      v_blockers:=array_append(v_blockers,'music_content_present');
  END IF;
  FOR v_ref IN SELECT c.conrelid,a.attname FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
      AND r.relname NOT IN('music_reference_links','music_song_reactions','music_creator_follows','music_social_mutations',
          'music_comments','music_comment_reports','music_comment_mutations','music_play_listens','music_song_reports',
          'music_mixdown_reservations','music_actors','music_user_blocks','music_albums','music_album_items','music_album_reports','music_album_mutations',
          'music_daily_allowance_reservations','music_daily_allowance_claims')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)',v_ref.conrelid::REGCLASS,v_ref.attname) INTO v_music_present USING p_user_id;
    IF v_music_present THEN v_blockers:=array_append(v_blockers,'music_content_present'); EXIT; END IF;
  END LOOP;
  RETURN v_blockers;
END $$;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
