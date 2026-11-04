-- ADR-0069: atomically cap new durable fal admissions; replays remain exempt.
-- Apply through apply-migrations after owner approval (ADR-0023), before Worker rollout.
-- Rollback: DROP FUNCTION public.admit_fal_dispatch_capped(uuid,text,text,jsonb,jsonb,text,boolean,integer);
-- The old Worker only calls the unchanged seven-argument admit_fal_dispatch.
CREATE OR REPLACE FUNCTION public.admit_fal_dispatch_capped(
    p_user_id UUID, p_idempotency_key TEXT, p_model_id TEXT, p_inputs JSONB,
    p_payload JSONB, p_endpoint TEXT, p_allow_free BOOLEAN, p_max_charge INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_price INTEGER;
    v_result JSONB;
BEGIN
    IF p_max_charge IS NULL OR p_max_charge < 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MAX_CHARGE');
    END IF;

    -- Hold this lock outside the subtransaction so the checked price is the
    -- same price the inner admission reads, including concurrent catalog edits.
    -- A missing model is left to the inner function's normal refusal/replay.
    SELECT credits_5s INTO v_price FROM public.model_catalog WHERE id = p_model_id FOR SHARE;

    BEGIN
        v_result := public.admit_fal_dispatch(p_user_id, p_idempotency_key, p_model_id,
            p_inputs, p_payload, p_endpoint, p_allow_free);
        IF v_result->>'ok' IS DISTINCT FROM 'true'
           OR v_result->>'idempotent' = 'true' OR v_result->>'free' = 'true' THEN
            RETURN v_result;
        END IF;
        IF v_price > p_max_charge THEN
            -- Only this private SQLSTATE is caught. Its subtransaction rollback
            -- undoes every admission effect, including debit, job and capacity.
            RAISE EXCEPTION USING ERRCODE = 'VFC01', MESSAGE = 'durable fal price exceeds ceiling';
        END IF;
        RETURN v_result;
    EXCEPTION WHEN SQLSTATE 'VFC01' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PRICE_EXCEEDS_CEILING', 'expected_credits', v_price);
    END;
END $$;

REVOKE ALL ON FUNCTION public.admit_fal_dispatch_capped(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch_capped(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN,INTEGER) TO service_role;
