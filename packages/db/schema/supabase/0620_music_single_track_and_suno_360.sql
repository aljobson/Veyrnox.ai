-- New song creation produces one candidate. Historical pair requests and
-- pair-based edit/remix operations keep their stored output_count=2 contract.
-- CRUN's live Suno form (verified 2026-11-26) accepts duration 1..360 seconds.
-- Validate the wider checks before the short name-swap transaction so large
-- production tables are not held behind ACCESS EXCLUSIVE for the whole file.
ALTER TABLE public.music_generation_quotes
  DROP CONSTRAINT IF EXISTS music_generation_quotes_single_track_check;
ALTER TABLE public.music_generation_quotes
  ADD CONSTRAINT music_generation_quotes_single_track_check CHECK(output_count IN (1,2)) NOT VALID;
ALTER TABLE public.music_generation_quotes VALIDATE CONSTRAINT music_generation_quotes_single_track_check;
ALTER TABLE public.music_generation_requests
  DROP CONSTRAINT IF EXISTS music_generation_requests_single_track_check;
ALTER TABLE public.music_generation_requests
  ADD CONSTRAINT music_generation_requests_single_track_check CHECK(output_count IN (1,2)) NOT VALID;
ALTER TABLE public.music_generation_requests VALIDATE CONSTRAINT music_generation_requests_single_track_check;

ALTER TABLE public.music_prompt_specs
  DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_single_track_check;
ALTER TABLE public.music_prompt_specs
  ADD CONSTRAINT music_prompt_specs_duration_single_track_check CHECK(
    (provider_contract='crun-suno-v1' AND duration_seconds BETWEEN 1 AND 360)
    OR (provider_contract IS DISTINCT FROM 'crun-suno-v1' AND
       (duration_seconds BETWEEN 10 AND 60 OR (model_id='ace-step-1.5' AND duration_seconds BETWEEN 10 AND 135)))) NOT VALID;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_duration_single_track_check;

BEGIN;
ALTER TABLE public.music_generation_quotes DROP CONSTRAINT IF EXISTS music_generation_quotes_output_count_check;
ALTER TABLE public.music_generation_quotes RENAME CONSTRAINT music_generation_quotes_single_track_check TO music_generation_quotes_output_count_check;
ALTER TABLE public.music_generation_requests DROP CONSTRAINT IF EXISTS music_generation_requests_output_count_check;
ALTER TABLE public.music_generation_requests RENAME CONSTRAINT music_generation_requests_single_track_check TO music_generation_requests_output_count_check;
ALTER TABLE public.music_prompt_specs DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_by_contract_check;
ALTER TABLE public.music_prompt_specs RENAME CONSTRAINT music_prompt_specs_duration_single_track_check TO music_prompt_specs_duration_by_contract_check;

-- This trigger sorts before 0601's charged-credit trigger, so that trigger
-- always derives charged_credits from the one-track total.
CREATE OR REPLACE FUNCTION private.music_quote_single_generation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_mode TEXT;
BEGIN
  SELECT mode INTO v_mode FROM public.music_prompt_specs WHERE id=NEW.prompt_spec_id;
  IF v_mode IN ('simple','custom') THEN
    NEW.output_count:=1;
    NEW.total_credits:=NEW.unit_credits;
    NEW.daily_free_candidates:=LEAST(NEW.daily_free_candidates,1);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_quote_single_generation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS music_quote_aaa_single_generation ON public.music_generation_quotes;
CREATE TRIGGER music_quote_aaa_single_generation
  BEFORE INSERT OR UPDATE OF unit_credits,total_credits,output_count,daily_free_candidates
  ON public.music_generation_quotes FOR EACH ROW
  EXECUTE FUNCTION private.music_quote_single_generation();

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
  SELECT * INTO q FROM public.music_generation_quotes WHERE user_id=u AND id=(p_result->>'quote_id')::UUID FOR UPDATE;
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
  free_count:=greatest(0,least(q.output_count,policy.candidates_per_user_per_day-used_user,
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

-- 0593's extended simple quote is the only simple entry point with CRUN
-- controls. Keep its signature and widen only the verified Suno duration.
CREATE OR REPLACE FUNCTION public.music_create_quote(
 p_auth_id TEXT,p_prompt TEXT,p_title TEXT,p_model_id TEXT,p_variety INTEGER,
 p_style_influence INTEGER,p_exclude_styles TEXT,p_duration_seconds INTEGER,
 p_provider_contract TEXT,p_instrumental BOOLEAN,p_suno_model TEXT,
 p_vocal_gender TEXT,p_weirdness NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_spec UUID; v_quote UUID; v_custom BOOLEAN; v_active TEXT;
BEGIN
 IF p_provider_contract<>'crun-suno-v1'
  OR p_model_id NOT IN('ace-step','ace-step-1.5') OR p_instrumental IS NULL
  OR (p_model_id='ace-step' AND NOT p_instrumental)
  OR p_suno_model NOT IN('v6','v6_mini','v6_wild')
  OR p_vocal_gender NOT IN('auto','male','female')
  OR (p_variety IS NOT NULL AND p_variety NOT BETWEEN 0 AND 100)
  OR (p_style_influence IS NOT NULL AND p_style_influence NOT BETWEEN 0 AND 100)
  OR (p_weirdness IS NOT NULL AND p_weirdness NOT BETWEEN 0 AND 1)
  OR (p_exclude_styles IS NOT NULL AND char_length(btrim(p_exclude_styles)) NOT BETWEEN 1 AND 1000)
  OR p_duration_seconds NOT BETWEEN 1 AND 360
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF NOT private.music_crun_quote_available('crun:suno/music-generate',p_suno_model) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 SELECT CASE provider_endpoint WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1'
  WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1'
  WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1' END INTO v_active
 FROM public.model_catalog WHERE id=p_model_id AND active FOR SHARE;
 IF v_active IS DISTINCT FROM p_provider_contract THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 v_custom:=nullif(btrim(coalesce(p_title,'')),'') IS NOT NULL OR p_variety IS NOT NULL
  OR p_style_influence IS NOT NULL OR p_exclude_styles IS NOT NULL OR p_weirdness IS NOT NULL
  OR p_vocal_gender<>'auto' OR p_duration_seconds<>60;
 IF p_model_id='ace-step' AND v_custom THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF v_custom AND NOT p_instrumental THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 PERFORM set_config('veyrnox.crun_suno_model',p_suno_model,true);
 v_result:=public.music_create_quote(p_auth_id,p_prompt,p_title,p_model_id);
 PERFORM set_config('veyrnox.crun_suno_model','',true);
 IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
 v_quote:=(v_result->>'quote_id')::UUID;
 SELECT q.prompt_spec_id INTO v_spec FROM public.music_generation_quotes q JOIN public.users u ON u.id=q.user_id
  WHERE q.id=v_quote AND u.auth_id=p_auth_id FOR UPDATE OF q;
 UPDATE public.music_prompt_specs SET instrumental=p_instrumental,suno_model=p_suno_model,
  vocal_gender=p_vocal_gender,weirdness=p_weirdness,variety=p_variety,style_influence=p_style_influence,
  exclude_styles=nullif(btrim(p_exclude_styles),''),duration_seconds=p_duration_seconds
  WHERE id=v_spec AND provider_contract=p_provider_contract;
 IF NOT FOUND THEN RAISE EXCEPTION 'music quote prompt contract changed'; END IF;
 -- Re-run quote triggers after the duration snapshot changes; CRUN pricing is
 -- one provider request, independent of duration.
 UPDATE public.music_generation_quotes SET unit_credits=unit_credits WHERE id=v_quote;
 SELECT jsonb_build_object('ok',true,'quote_id',q.id,'model_id',q.model_id,'provider_contract',q.provider_contract,
  'unit_credits',q.unit_credits,'total_credits',q.total_credits,'balance',cb.balance-CASE WHEN cb.subscription_expires_at>now() THEN 0 ELSE cb.subscription_balance END,
  'balance_after',(cb.balance-CASE WHEN cb.subscription_expires_at>now() THEN 0 ELSE cb.subscription_balance END)-q.total_credits,
  'affordable',(cb.balance-CASE WHEN cb.subscription_expires_at>now() THEN 0 ELSE cb.subscription_balance END)>=q.total_credits,
  'expires_at',q.expires_at) INTO v_result
 FROM public.music_generation_quotes q JOIN public.credit_balances cb ON cb.user_id=q.user_id WHERE q.id=v_quote;
 RETURN v_result||jsonb_build_object('mode',CASE WHEN v_custom THEN 'custom' ELSE 'simple' END,
  'instrumental',p_instrumental,'suno_model',p_suno_model,'vocal_gender',p_vocal_gender,
  'style_weight',CASE WHEN p_style_influence IS NULL THEN NULL ELSE p_style_influence::NUMERIC/100 END,
  'weirdness',p_weirdness,'variety',CASE WHEN p_variety IS NULL THEN NULL ELSE round(p_variety::NUMERIC/25)::INTEGER END,
  'duration_seconds',p_duration_seconds,
  'exclude_styles_applied_chars',CASE WHEN p_exclude_styles IS NULL THEN 0 ELSE least(200,char_length(btrim(p_exclude_styles))) END);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC) TO service_role;

-- Base custom quote: retain fal's 135-second ceiling and allow CRUN 1..360.
CREATE OR REPLACE FUNCTION public.music_create_custom_quote(
 p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID,p_draft_revision INTEGER,
 p_instrumental BOOLEAN,p_rights_confirmed BOOLEAN,p_duration_seconds INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; d public.music_lyric_drafts%ROWTYPE; m public.model_catalog%ROWTYPE;
 spec UUID; q public.music_generation_quotes%ROWTYPE; v_balance INTEGER; v_active TEXT; v_blocks INTEGER;
BEGIN
 v_active:=private.music_active_provider_contract('ace-step-1.5');
 IF p_provider_contract IS DISTINCT FROM v_active THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF p_draft_id IS NULL OR p_draft_revision IS NULL OR p_draft_revision<0 OR p_instrumental IS NULL
  OR (p_instrumental AND p_rights_confirmed IS DISTINCT FROM false)
  OR (NOT p_instrumental AND p_rights_confirmed IS DISTINCT FROM true)
  OR p_duration_seconds IS NULL
  OR p_duration_seconds<(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1 ELSE 10 END)
  OR p_duration_seconds>(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 360 ELSE 135 END)
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF (SELECT count(*) FROM public.music_generation_quotes WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=20 THEN
  RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE id=p_draft_id AND user_id=v_user
  AND provider_contract=p_provider_contract AND revision=p_draft_revision FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 IF d.model_id<>'ace-step-1.5' OR char_length(btrim(d.styles)) NOT BETWEEN 1 AND (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END)
  OR (NOT p_instrumental AND char_length(btrim(d.lyrics)) NOT BETWEEN 1 AND (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END))
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id='ace-step-1.5';
 IF NOT FOUND OR NOT m.active OR m.gated_flag OR m.credits_5s IS NULL OR m.credits_5s<=0
  OR private.music_active_provider_contract(m.id) IS DISTINCT FROM p_provider_contract
  OR m.provider_endpoint IS DISTINCT FROM (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 'crun:suno/music-generate' ELSE 'fal-ai/ace-step-1.5' END)
 THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF p_provider_contract='crun-suno-v1' AND NOT private.music_crun_quote_available(m.provider_endpoint,
   coalesce(nullif(current_setting('veyrnox.crun_suno_model',true),''),'v6')) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
  FROM public.credit_balances WHERE user_id=v_user;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 INSERT INTO public.music_prompt_specs(user_id,mode,model_id,title,prompt,instrumental,schema_version,
  lyrics,styles,draft_revision,lyrics_rights_version,duration_seconds,provider_contract,suno_model)
 VALUES(v_user,'custom',m.id,nullif(btrim(d.title),''),left(btrim(d.styles),500),p_instrumental,'music-custom-v1',
  CASE WHEN p_instrumental THEN NULL ELSE d.lyrics END,d.styles,d.revision,
  CASE WHEN p_instrumental THEN NULL ELSE 'music-lyrics-rights-v1' END,p_duration_seconds,p_provider_contract,
  CASE p_provider_contract WHEN 'crun-suno-v1' THEN 'v6' ELSE NULL END) RETURNING id INTO spec;
 v_blocks:=private.music_duration_price_blocks(m.id,p_provider_contract,p_duration_seconds);
 INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,provider_contract,
  unit_credits,total_credits,catalog_updated_at,expires_at)
 VALUES(v_user,spec,m.id,m.provider_endpoint,p_provider_contract,m.credits_5s*v_blocks,m.credits_5s*v_blocks,m.updated_at,now()+interval '5 minutes')
 RETURNING * INTO q;
 RETURN jsonb_build_object('ok',true,'quote_id',q.id,'model_id',q.model_id,'provider_contract',q.provider_contract,
  'unit_credits',q.unit_credits,'total_credits',q.total_credits,'balance',v_balance,'balance_after',v_balance-q.total_credits,
  'affordable',v_balance>=q.total_credits,'expires_at',q.expires_at,'duration_seconds',p_duration_seconds,
  'mode','custom','draft_id',d.id,'draft_revision',d.revision,'instrumental',p_instrumental);
END $$;
REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER) TO service_role;

-- The public compatibility name stays music_submit_pair so deployed clients do
-- not break; the implementation admits exactly one job for create requests.
CREATE OR REPLACE FUNCTION private.music_submit_pair_unbounded(
 p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_recent INTEGER; q public.music_generation_quotes%ROWTYPE;
 p public.music_prompt_specs%ROWTYPE; m public.model_catalog%ROWTYPE; req public.music_generation_requests%ROWTYPE;
 existing public.music_generation_requests%ROWTYPE; one JSONB; job1 UUID; failure JSONB; jobs JSONB;
 payload JSONB; input JSONB; expected_contract TEXT; v_open BOOLEAN;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT * INTO q FROM public.music_generation_quotes WHERE id=existing.quote_id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
   'balance_after',v_balance,'idempotent',true,'provider_contract',q.provider_contract,
   'daily_free_candidates',q.daily_free_candidates,'charged_credits',q.charged_credits);
 END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 -- Required second receipt lookup after the balance lock closes the race
 -- between an initial request and an idempotent replay.
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,'balance_after',v_balance,'idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 SELECT * INTO q FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF q.output_count<>1 THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 IF q.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF q.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 SELECT * INTO p FROM public.music_prompt_specs WHERE id=q.prompt_spec_id AND user_id=v_user;
 SELECT * INTO m FROM public.model_catalog WHERE id=q.model_id FOR SHARE;
 expected_contract:=CASE m.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1' WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' END;
 IF NOT FOUND OR expected_contract IS NULL OR NOT m.active OR m.gated_flag OR m.modality<>'text-to-audio'
  OR m.provider_endpoint IS DISTINCT FROM q.provider_endpoint OR q.provider_contract IS DISTINCT FROM expected_contract
  OR (expected_contract='crun-suno-v1' AND (m.provider IS DISTINCT FROM 'crun' OR q.model_id NOT IN('ace-step','ace-step-1.5')))
  OR (expected_contract='fal-ace-v1' AND (m.provider IS DISTINCT FROM 'fal' OR m.provider_endpoint IS DISTINCT FROM CASE q.model_id
      WHEN 'ace-step' THEN 'fal-ai/ace-step' WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
      WHEN 'ace-step-loop' THEN 'fal-ai/ace-step-1.5' END))
  OR p.provider_contract IS DISTINCT FROM q.provider_contract
  OR m.credits_5s*private.music_duration_price_blocks(q.model_id,q.provider_contract,p.duration_seconds)<>q.unit_credits
  OR q.total_credits<>q.unit_credits OR m.updated_at IS DISTINCT FROM q.catalog_updated_at
 THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 IF q.provider_contract='crun-suno-v1' THEN
  SELECT NOT admission_open INTO v_open FROM public.provider_spend_provider_policy WHERE provider='crun';
  IF coalesce(v_open,true) OR EXISTS(SELECT 1 FROM public.model_routes r WHERE r.model_id=q.model_id AND r.supplier='crun' AND r.endpoint=q.provider_endpoint AND r.breaker_opened_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b WHERE b.endpoint=q.provider_endpoint AND b.suno_model=p.suno_model AND b.is_open)
  THEN RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
  IF p.bpm IS NOT NULL OR p.key_scale IS NOT NULL OR p.time_signature IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  IF (p.mode='custom' OR p.title IS NOT NULL OR p.styles IS NOT NULL OR p.exclude_styles IS NOT NULL
      OR p.style_influence IS NOT NULL OR p.variety IS NOT NULL OR p.duration_seconds<>60)
     AND NOT p.instrumental AND nullif(btrim(coalesce(p.lyrics,'')),'') IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 END IF;
 IF q.model_id IN('ace-step-1.5','ace-step-loop') AND NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 IF v_balance<q.total_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote,output_count)
   VALUES(v_user,q.id,p.id,m.id,p_idempotency_key,q.total_credits,1) RETURNING * INTO req;
  one:=public.ledger_debit(v_user,p_idempotency_key||'.1',q.unit_credits,'debit:music_generation',m.id,
   jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',1),0,60);
  IF one->>'ok' IS DISTINCT FROM 'true' THEN failure:=one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='track debit'; END IF;
  job1:=(one->>'job_id')::UUID;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id) VALUES(v_user,req.id,1,job1);
  IF q.provider_contract='crun-suno-v1' THEN
   input:=CASE WHEN p.mode='simple' AND p.title IS NULL AND p.styles IS NULL AND p.exclude_styles IS NULL AND p.style_influence IS NULL AND p.variety IS NULL AND p.duration_seconds=60
    THEN jsonb_build_object('mode','simple','prompt',p.prompt,'instrumental',p.instrumental,'suno_model',p.suno_model)
    ELSE jsonb_strip_nulls(jsonb_build_object('mode','custom','instrumental',p.instrumental,'suno_model',p.suno_model,
     'title',p.title,'tags',coalesce(nullif(p.styles,''),p.prompt),'lyrics',CASE WHEN p.instrumental THEN NULL ELSE p.lyrics END,
     'negative_tags',CASE WHEN p.exclude_styles IS NULL THEN NULL ELSE left(p.exclude_styles,200) END,
     'vocal_gender',CASE p.vocal_gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' ELSE NULL END,
     'style_weight',CASE WHEN p.style_influence IS NULL THEN NULL ELSE round(p.style_influence::NUMERIC/100,2) END,
     'weirdness_constraint',p.weirdness,'duration',p.duration_seconds,
     'variety',CASE WHEN p.variety IS NULL THEN NULL ELSE round(p.variety::NUMERIC/25)::INTEGER END)) END;
   payload:=jsonb_build_object('model','suno/music-generate','input',input);
   INSERT INTO public.crun_dispatch(job_id,endpoint,payload) VALUES(job1,q.provider_endpoint,payload);
  ELSE
   payload:=CASE m.id WHEN 'ace-step' THEN jsonb_build_object('tags',p.prompt,'duration',60)
    ELSE jsonb_build_object('prompt',p.prompt,'duration',60,'thinking',true,'num_outputs',1) END;
   INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(job1,q.provider_endpoint,payload);
  END IF;
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=q.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN coalesce(failure,jsonb_build_object('ok',false,'code','TRACK_DEBIT_FAILED'));
 END;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'request_id',req.id,'state','debited','job_ids',jsonb_build_array(job1),
  'balance_after',v_balance,'idempotent',false,'provider_contract',q.provider_contract);
END $$;
REVOKE ALL ON FUNCTION private.music_submit_pair_unbounded(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_submit_pair_daily(
 p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_recent INTEGER; q public.music_generation_quotes%ROWTYPE; p public.music_prompt_specs%ROWTYPE;
 m public.model_catalog%ROWTYPE; req public.music_generation_requests%ROWTYPE; reservation public.music_daily_allowance_reservations%ROWTYPE;
 existing public.music_generation_requests%ROWTYPE; one JSONB; failure JSONB; job1 UUID; jobs JSONB; payload JSONB; input JSONB;
 expected_contract TEXT; v_open BOOLEAN; policy_enabled BOOLEAN;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,'balance_after',v_balance,'idempotent',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||(now() AT TIME ZONE 'UTC')::DATE::TEXT,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('music-daily-allowance:'||(now() AT TIME ZONE 'UTC')::DATE::TEXT||':'||v_user::TEXT,0));
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT coalesce(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT * INTO q FROM public.music_generation_quotes WHERE id=existing.quote_id;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
   'balance_after',v_balance,'idempotent',true,'provider_contract',q.provider_contract,
   'daily_free_candidates',q.daily_free_candidates,'charged_credits',q.charged_credits);
 END IF;
 IF NOT private.music_daily_allowance_eligible(v_user) THEN
  RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 SELECT * INTO q FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF q.output_count<>1 OR q.daily_free_candidates<>1 THEN RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 IF q.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF q.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 SELECT * INTO reservation FROM public.music_daily_allowance_reservations WHERE quote_id=q.id FOR UPDATE;
 SELECT enabled INTO policy_enabled FROM public.music_daily_allowance_policy WHERE singleton FOR SHARE;
 IF NOT FOUND OR policy_enabled IS DISTINCT FROM true OR reservation.quote_id IS NULL OR reservation.state<>'LIVE'
  OR reservation.user_id<>v_user OR reservation.day<>q.daily_allowance_date OR reservation.candidates<>1
  OR reservation.expires_at<=now() OR reservation.day<>(now() AT TIME ZONE 'UTC')::DATE
 THEN RETURN jsonb_build_object('ok',false,'code','DAILY_ALLOWANCE_STALE'); END IF;
 SELECT * INTO p FROM public.music_prompt_specs WHERE id=q.prompt_spec_id AND user_id=v_user;
 SELECT * INTO m FROM public.model_catalog WHERE id=q.model_id FOR SHARE;
 expected_contract:=CASE m.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1'
  WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' END;
 IF NOT FOUND OR expected_contract IS NULL OR NOT m.active OR m.gated_flag OR m.modality<>'text-to-audio'
  OR q.provider_contract<>'crun-suno-v1' OR expected_contract<>'crun-suno-v1'
  OR m.provider IS DISTINCT FROM 'crun' OR q.model_id NOT IN('ace-step','ace-step-1.5')
  OR q.total_credits<>q.unit_credits OR q.charged_credits<>0
  OR m.provider_endpoint IS DISTINCT FROM q.provider_endpoint OR p.provider_contract IS DISTINCT FROM q.provider_contract
  OR m.credits_5s*private.music_duration_price_blocks(q.model_id,q.provider_contract,p.duration_seconds)<>q.unit_credits
  OR m.updated_at IS DISTINCT FROM q.catalog_updated_at
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
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote,output_count)
   VALUES(v_user,q.id,p.id,m.id,p_idempotency_key,0,1) RETURNING * INTO req;
  one:=private.music_admit_daily_free_job(v_user,p_idempotency_key||'.1',m.id,
   jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',1),q.id,reservation.day);
  IF one->>'ok' IS DISTINCT FROM 'true' THEN failure:=one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='track admission'; END IF;
  job1:=(one->>'job_id')::UUID;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id) VALUES(v_user,req.id,1,job1);
  input:=CASE WHEN p.mode='simple' AND p.title IS NULL AND p.styles IS NULL AND p.exclude_styles IS NULL AND p.style_influence IS NULL AND p.variety IS NULL AND p.duration_seconds=60
   THEN jsonb_build_object('mode','simple','prompt',p.prompt,'instrumental',p.instrumental,'suno_model',p.suno_model)
   ELSE jsonb_strip_nulls(jsonb_build_object('mode','custom','instrumental',p.instrumental,'suno_model',p.suno_model,
    'title',p.title,'tags',coalesce(nullif(p.styles,''),p.prompt),'lyrics',CASE WHEN p.instrumental THEN NULL ELSE p.lyrics END,
    'negative_tags',CASE WHEN p.exclude_styles IS NULL THEN NULL ELSE left(p.exclude_styles,200) END,
    'vocal_gender',CASE p.vocal_gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' ELSE NULL END,
    'style_weight',CASE WHEN p.style_influence IS NULL THEN NULL ELSE round(p.style_influence::NUMERIC/100,2) END,
    'weirdness_constraint',p.weirdness,'duration',p.duration_seconds,
    'variety',CASE WHEN p.variety IS NULL THEN NULL ELSE round(p.variety::NUMERIC/25)::INTEGER END)) END;
  payload:=jsonb_build_object('model','suno/music-generate','input',input);
  INSERT INTO public.crun_dispatch(job_id,endpoint,payload) VALUES(job1,q.provider_endpoint,payload);
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=q.id;
  UPDATE public.music_daily_allowance_reservations SET state='CONSUMED',consumed_at=now() WHERE quote_id=q.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN coalesce(failure,jsonb_build_object('ok',false,'code','TRACK_ADMISSION_FAILED'));
 END;
 RETURN jsonb_build_object('ok',true,'request_id',req.id,'state','debited','job_ids',jsonb_build_array(job1),
  'balance_after',v_balance,'idempotent',false,'provider_contract',q.provider_contract,
  'daily_free_candidates',1,'charged_credits',0);
END $$;
REVOKE ALL ON FUNCTION private.music_submit_pair_daily(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the battle-tested projection for historical pairs, then normalize
-- request state and default title using each request's stored output_count.
DO $$ BEGIN
 IF to_regprocedure('public.music_project_candidate_pair_legacy(uuid)') IS NULL THEN
  ALTER FUNCTION public.music_project_candidate(UUID) RENAME TO music_project_candidate_pair_legacy;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.music_project_candidate_pair_legacy(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_project_candidate_pair_legacy(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_project_candidate(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; c public.music_generation_candidates%ROWTYPE; expected INTEGER;
 ready_count INTEGER; terminal_count INTEGER; refunded_count INTEGER; running_count INTEGER; next_status TEXT;
 prompt_title TEXT;
BEGIN
 result:=public.music_project_candidate_pair_legacy(p_job_id);
 SELECT * INTO c FROM public.music_generation_candidates WHERE job_id=p_job_id;
 IF NOT FOUND THEN RETURN result; END IF;
 SELECT r.output_count,p.title INTO expected,prompt_title FROM public.music_generation_requests r
  JOIN public.music_prompt_specs p ON p.id=r.prompt_spec_id WHERE r.id=c.generation_request_id;
 SELECT count(*) FILTER(WHERE status='ready'),count(*) FILTER(WHERE status IN('ready','failed','refunded')),
  count(*) FILTER(WHERE status='refunded'),count(*) FILTER(WHERE status='running')
 INTO ready_count,terminal_count,refunded_count,running_count
 FROM public.music_generation_candidates WHERE generation_request_id=c.generation_request_id;
 next_status:=CASE WHEN ready_count=expected THEN 'succeeded'
  WHEN terminal_count=expected AND ready_count>0 THEN 'partial'
  WHEN terminal_count=expected AND refunded_count=expected THEN 'refunded'
  WHEN terminal_count=expected THEN 'failed'
  WHEN running_count>0 THEN 'running' ELSE 'debited' END;
 UPDATE public.music_generation_requests SET status=next_status,updated_at=now() WHERE id=c.generation_request_id;
 IF expected=1 AND c.song_id IS NOT NULL AND prompt_title IS NULL THEN
  UPDATE public.music_songs SET title='Music draft',updated_at=now() WHERE id=c.song_id AND user_id=c.user_id;
 END IF;
 IF terminal_count=expected THEN
  INSERT INTO public.asset_reap_queue(r2_key)
   SELECT r2_key FROM public.music_remix_sources WHERE generation_request_id=c.generation_request_id AND reap_queued_at IS NULL
   ON CONFLICT(r2_key) DO NOTHING;
  UPDATE public.music_remix_sources SET reap_queued_at=now()
   WHERE generation_request_id=c.generation_request_id AND reap_queued_at IS NULL;
 END IF;
 RETURN result||jsonb_build_object('status',next_status);
END $$;
REVOKE ALL ON FUNCTION public.music_project_candidate(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_project_candidate(UUID) TO service_role;

-- A one-track request stays labelled Track after polling or reloading, while
-- legacy two-track requests retain their A/B identities.
CREATE OR REPLACE FUNCTION public.music_get_generation(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB; v_job UUID;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 FOR v_job IN SELECT job_id FROM public.music_generation_candidates
  WHERE generation_request_id=p_request_id AND user_id=v_user LOOP
  PERFORM public.music_project_candidate(v_job);
 END LOOP;
 SELECT jsonb_build_object('id',r.id,'state',r.status,'model_id',r.model_id,
  'prompt',p.prompt,'title',p.title,'total_credits',r.credit_quote,'created_at',r.created_at,
  'candidates',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'ordinal',c.ordinal,'label',CASE WHEN r.output_count=1 THEN 'Track' WHEN c.ordinal=1 THEN 'A' ELSE 'B' END,
   'state',c.status,'job_id',c.job_id,'song_id',c.song_id,'version_id',c.song_version_id,
   'error_code',c.failure_code,'credits',j.credits,
   'audio_url',CASE WHEN c.status='ready' THEN '/api/v1/jobs/'||c.job_id||'/asset' END
  ) ORDER BY c.ordinal),'[]'::jsonb) FROM public.music_generation_candidates c
   JOIN public.jobs j ON j.id=c.job_id AND j.user_id=c.user_id
   WHERE c.generation_request_id=r.id)) INTO v_row
 FROM public.music_generation_requests r JOIN public.music_prompt_specs p ON p.id=r.prompt_spec_id
 WHERE r.id=p_request_id AND r.user_id=v_user;
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'generation',v_row);
END $$;
REVOKE ALL ON FUNCTION public.music_get_generation(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_generation(TEXT,UUID) TO service_role;

COMMIT;
