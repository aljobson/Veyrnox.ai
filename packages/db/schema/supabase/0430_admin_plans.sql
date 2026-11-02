-- ADR-0320. Sale availability is not settlement eligibility. No price edits.
-- Current launch web IDs from 0420; checkout itself uses active web catalog rows.
CREATE OR REPLACE FUNCTION public.admin_editable_pack_ids() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['web-209','web-523','web-1571']::text[];
$$;
REVOKE ALL ON FUNCTION public.admin_editable_pack_ids() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_plans_list(p_auth_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plans JSONB; v_packs JSONB; v_history JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'plans.read');
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO v_plans FROM (
        SELECT p.id,p.billing_interval,p.price_usd_cents,p.credits,p.active,
            round(p.price_usd_cents::numeric/p.credits,4) AS per_credit_cents,
            coalesce((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'product',s.store_product_id) ORDER BY s.channel,s.store_product_id)
                FROM public.credit_subscription_store_products s WHERE s.plan_id=p.id),'[]') AS store_products
        FROM public.credit_subscription_plans p
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO v_packs FROM (
        SELECT p.id,p.sales_channel,p.price_usd_cents,p.credits,p.active,p.variant_id,p.store_product_id,
            round(p.price_usd_cents::numeric/p.credits,4) AS per_credit_cents,
            p.sales_channel='web' AND p.id=ANY(public.admin_editable_pack_ids()) AS editable,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'channel',s.sales_channel,'active',s.active) ORDER BY s.sales_channel,s.id)
              FROM public.credit_packs s WHERE p.sales_channel='web' AND s.credits=p.credits AND s.sales_channel IN ('ios','android')),'[]') AS matching_store_packs
        FROM public.credit_packs p
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id DESC),'[]') INTO v_history FROM (
        SELECT id,subject,action,"before","after",reason,actor_email,created_at FROM public.admin_change_log
        WHERE area='plan' ORDER BY created_at DESC,id DESC LIMIT 100
    ) t;
    RETURN jsonb_build_object('ok',true,'plans',v_plans,'packs',v_packs,'history',v_history);
END $$;
REVOKE ALL ON FUNCTION public.admin_plans_list(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_plans_list(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_plan_set_active(
    p_auth_id UUID,p_kind TEXT,p_id TEXT,p_active BOOLEAN,p_reason TEXT,p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_email TEXT; v_pack public.credit_packs%ROWTYPE;
    v_seen public.admin_mutation_receipts%ROWTYPE; v_request JSONB; v_result JSONB; v_id UUID; v_pending INT;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'plans.write');
    IF p_kind IS NULL OR p_kind NOT IN ('subscription','pack') OR p_id IS NULL OR p_id !~ '^[a-z0-9-]{1,32}$'
        OR p_active IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_reason ~ '[[:cntrl:]]'
        OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
    END IF;
    v_actor := public.admin_lock_mutation(p_auth_id,'plans.write',p_aal,p_mfa_at);
    IF p_kind='subscription' THEN
        RETURN jsonb_build_object('ok',false,'code','plan_read_only','counts',jsonb_build_object(
            'not_ended',(SELECT count(*) FROM public.credit_subscriptions WHERE plan_id=p_id AND status<>'ended'),
            'store_mappings',(SELECT count(*) FROM public.credit_subscription_store_products WHERE plan_id=p_id)));
    END IF;
    SELECT * INTO v_pack FROM public.credit_packs WHERE id=p_id FOR UPDATE;
    v_request := jsonb_build_object('area','plan','kind',p_kind,'id',p_id,'active',p_active,'reason',btrim(p_reason));
    SELECT * INTO v_seen FROM public.admin_mutation_receipts WHERE actor_user_id=v_actor AND idem_key=p_idem_key;
    IF FOUND THEN
        IF v_seen.actor_user_id<>v_actor OR v_seen.request<>v_request THEN RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused'); END IF;
        RETURN v_seen.result;
    END IF;
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR NOT isfinite(p_mfa_at)
        OR p_mfa_at NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '5 seconds' THEN
        RAISE EXCEPTION 'mfa_required' USING ERRCODE='P0001';
    END IF;

    IF v_pack.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','catalog_not_found'); END IF;
    IF v_pack.sales_channel<>'web' OR NOT p_id=ANY(public.admin_editable_pack_ids()) THEN
        RETURN jsonb_build_object('ok',false,'code','plan_read_only');
    END IF;
    SELECT count(*) INTO v_pending FROM public.top_ups WHERE pack_id=p_id AND status='pending'
    AND created_at>=clock_timestamp()-interval '3 hours';
    IF NOT p_active AND v_pending>0 THEN
        RETURN jsonb_build_object('ok',false,'code','plan_in_use','counts',jsonb_build_object('unsettled_top_ups',v_pending));
    END IF;
    UPDATE public.credit_packs SET active=p_active,updated_at=now() WHERE id=p_id;
    SELECT email INTO v_email FROM public.users WHERE id=v_actor;
    INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
        VALUES(v_actor,v_email,'plan','set_active','pack:'||p_id,jsonb_build_object('active',v_pack.active),jsonb_build_object('active',p_active),btrim(p_reason)) RETURNING id INTO v_id;
    v_result := jsonb_build_object('ok',true,'change_id',v_id,'kind',p_kind,'id',p_id,'active',p_active);
    INSERT INTO public.admin_mutation_receipts(idem_key,actor_user_id,request,result) VALUES(p_idem_key,v_actor,v_request,v_result);
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_plan_set_active(UUID,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_plan_set_active(UUID,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
