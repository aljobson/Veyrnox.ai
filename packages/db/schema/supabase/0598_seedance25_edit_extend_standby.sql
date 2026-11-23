-- Frozen Seedance 2.5 edit/extend order, 2026-11-23. Deploy Worker BEFORE apply.
-- Numbered 0598 (first 0587, then 0595, then 0597): main kept advancing (Crun Suno 0591-0593, template prompts 0594, Qwen3 TTS 0596, open PR 2669 0596-0597) while this
-- was in review, and an apply workflow skips a file numbered below production's latest. Recheck open PRs for 0598 before merging.
-- PLACEHOLDERS, NOT APPROVED CUSTOMER PRICES: ceil(cost / 0.01796) = 76 / 78.
-- Edit multiplies 76 by ceil(server-measured source seconds / 5): 5.055 s costs 152.
-- Extend is one 5-second output unit, only for measured 4–6s sources.
-- Raising the extend source cap requires a billed proof with a longer source.
-- Billing/max use conservative container seconds; the Worker checks the 4s picture minimum.
-- Both proof task IDs below must remain attached before activation.
-- Never use estimate-credits for pricing or holds.
-- Both rows remain inactive/gated; both routes standby. Activation needs a separate approved migration,
-- quality review and a billed adapter proof using signed R2. No live apply is authorized here.
BEGIN;
INSERT INTO public.model_catalog
    (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
    ('seedance-2.5-edit','Restyle clip','crun','crun:bytedance/seedance2-5-r2v:edit','video-to-video',76,1.3480,'per_second',5,true,false),
    ('seedance-2.5-extend','Extend clip','crun','crun:bytedance/seedance2-5-r2v:extend','video-to-video',78,1.3880,'per_second',5,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
    (model_id,supplier,endpoint,cost_per_unit,cost_unit,billing_seconds,priority,state,provenance,parity_record)
SELECT c.id, 'crun', c.provider_endpoint, c.provider_cost_per_unit, 'per_second', 5, 1, 'standby', 'licensed_reseller',
    'Owner proof 2026-11-23, 720p/audio/auto, 5.055 s source: edit 277.66 credits in 184 s; extend 5 s 286 credits in 418 s. Edit task 56f01a0a-3be4-4574-987e-c87bdaa6af42; extend task a0e30731-2552-47fd-91ae-f15a0f0395b0; both used the same 5.055 s source. Signed R2 and output quality unproved. Edit billed by source, extend by output; edit source cap 4–10 s, extend source cap 4–6 s. Raising the extend cap requires a billed proof with a longer source.'
FROM public.model_catalog c
WHERE c.id IN ('seedance-2.5-edit','seedance-2.5-extend')
  AND NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id=c.id)
ON CONFLICT (model_id,supplier,endpoint) DO NOTHING;

DO $$
DECLARE affected BIGINT;
BEGIN
    SELECT count(*) INTO affected FROM public.model_catalog c JOIN public.model_routes r ON r.model_id=c.id
    WHERE c.id IN ('seedance-2.5-edit','seedance-2.5-extend')
      AND c.provider='crun' AND NOT c.active AND c.gated_flag AND r.state='standby'
      AND position('56f01a0a-3be4-4574-987e-c87bdaa6af42' in r.parity_record)>0
      AND position('a0e30731-2552-47fd-91ae-f15a0f0395b0' in r.parity_record)>0
      AND r.supplier='crun' AND r.provenance='licensed_reseller' AND r.priority=1
      AND c.provider_endpoint=r.endpoint AND c.provider_cost_per_unit=r.cost_per_unit
      AND ((c.id='seedance-2.5-edit' AND c.credits_5s=76 AND c.provider_cost_per_unit=1.3480 AND c.provider_endpoint='crun:bytedance/seedance2-5-r2v:edit')
        OR (c.id='seedance-2.5-extend' AND c.credits_5s=78 AND c.provider_cost_per_unit=1.3880 AND c.provider_endpoint='crun:bytedance/seedance2-5-r2v:extend'));
    IF affected <> 2 THEN RAISE EXCEPTION 'Expected two inactive Seedance 2.5 standby offers, found %', affected; END IF;
END $$;

-- Preserve every older offer's spend contract. The server-persisted billing units, not client duration,
-- reserve the same number of supplier units as quote/debit. Admission alone writes this metadata.
DO $$ BEGIN
    IF to_regprocedure('private.provider_spend_model_cost_pre_0598(text,jsonb,integer)') IS NULL THEN
        ALTER FUNCTION private.provider_spend_model_cost(TEXT,JSONB,INTEGER) RENAME TO provider_spend_model_cost_pre_0598;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION private.provider_spend_model_cost(p_model_id TEXT,p_inputs JSONB,p_credits INTEGER)
RETURNS TABLE(provider TEXT,purpose TEXT,cost_microusd BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    b JSONB := p_inputs->'seedance25_billing';
    seconds NUMERIC;
    max_seconds NUMERIC;
    units INTEGER;
    c public.model_catalog%ROWTYPE;
BEGIN
    IF p_model_id NOT IN ('seedance-2.5-edit','seedance-2.5-extend') OR p_model_id IS NULL THEN
        RETURN QUERY SELECT * FROM private.provider_spend_model_cost_pre_0598(p_model_id,p_inputs,p_credits);
        RETURN;
    END IF;
    IF b IS NULL OR jsonb_typeof(b->'source_seconds') IS DISTINCT FROM 'number'
        OR jsonb_typeof(b->'units') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001';
    END IF;
    seconds := (b->>'source_seconds')::numeric;
    -- PL/pgSQL ends an IF condition at the first THEN, so the limit is computed before the test.
    max_seconds := CASE WHEN p_model_id='seedance-2.5-edit' THEN 10 ELSE 6 END;
    IF seconds < 4 OR seconds > max_seconds THEN RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001'; END IF;
    units := CASE WHEN p_model_id='seedance-2.5-edit' THEN ceil(seconds/5)::integer ELSE 1 END;
    SELECT * INTO STRICT c FROM public.model_catalog WHERE id=p_model_id;
    IF (b->>'units')::numeric <> units OR p_credits IS DISTINCT FROM c.credits_5s*units
        OR (b->>'credits')::integer IS DISTINCT FROM p_credits THEN
        RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001';
    END IF;
    RETURN QUERY SELECT c.provider, 'job'::text, ceil(c.provider_cost_per_unit*units*1000000)::bigint;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR no_data_found THEN
    -- Same typed refusal as jobs_provider_spend_guard: transaction aborts before any debit.
    IF p_model_id IN ('seedance-2.5-edit','seedance-2.5-extend') THEN
        RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001';
    END IF;
    RAISE;
END $$;
REVOKE ALL ON FUNCTION private.provider_spend_model_cost_pre_0598(TEXT,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.provider_spend_model_cost(TEXT,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
-- Public admission already has service-role-only execute; no new client-callable function or table grant.
REVOKE ALL ON FUNCTION public.provider_spend_admit_model(UUID,TEXT,TEXT,JSONB,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provider_spend_admit_model(UUID,TEXT,TEXT,JSONB,INTEGER) TO service_role;
-- Register the read-only quote route in the privacy-safe telemetry inventory.
DO $$ BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0598(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0598;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT p_path = '/api/v1/generations/quote' OR public.telemetry_path_allowed_pre_0598(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
-- Quotes inspect owned media but create no jobs. Keep their abuse bound at the
-- generation entry gate's 20 attempts/60s, on a separate per-user counter.
-- Conflicting upserts serialize concurrent Workers; denied calls saturate at 21.
CREATE TABLE IF NOT EXISTS public.seedance25_quote_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 21)
);
ALTER TABLE public.seedance25_quote_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seedance25_quote_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seedance25_quote_rate_limits FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.consume_seedance25_quote_request(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.user_ai_controls WHERE user_id=v_user AND ai_disabled) THEN
        RETURN jsonb_build_object('ok',false,'code','AI_DISABLED');
    END IF;
    INSERT INTO public.seedance25_quote_rate_limits AS r(user_id,window_started_at,request_count)
    VALUES(v_user,v_now,1)
    ON CONFLICT(user_id) DO UPDATE SET
        window_started_at=CASE WHEN r.window_started_at <= v_now-interval '60 seconds' THEN v_now ELSE r.window_started_at END,
        request_count=CASE WHEN r.window_started_at <= v_now-interval '60 seconds' THEN 1 ELSE LEAST(r.request_count+1,21) END
    RETURNING window_started_at,request_count INTO v_start,v_count;
    IF v_count>20 THEN
        RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','limit',20,
            'retry_after_seconds',LEAST(60,GREATEST(1,ceil(extract(epoch FROM (v_start+interval '60 seconds'-v_now)))::INTEGER)));
    END IF;
    RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.consume_seedance25_quote_request(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_seedance25_quote_request(TEXT) TO service_role;
COMMIT;
