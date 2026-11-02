-- Admin reporting, ADR-0083. Only recorded values; no money writes.
-- Install the initial guard only when absent; never downgrade S2 on replay.
DO $install$ BEGIN
 IF to_regprocedure('public.admin_require_permission(text,text)') IS NULL THEN
  EXECUTE $guard$
CREATE FUNCTION public.admin_require_permission(p_auth_id TEXT, p_permission TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = p_auth_id AND is_admin) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
END $$;
  $guard$;
 END IF;
END $install$;
REVOKE ALL ON FUNCTION public.admin_require_permission(TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_require_permission(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_referrals_summary(p_auth_id TEXT, p_days INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_since TIMESTAMPTZ; v_totals JSONB; v_top JSONB; v_recent JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id, 'affiliates');
    IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'filters_invalid' USING ERRCODE = '22023';
    END IF;
    v_since := now() - make_interval(days => p_days);
    SELECT jsonb_build_object(
        'codes', (SELECT count(*) FROM public.referral_codes WHERE created_at >= v_since),
        'signups', (SELECT count(*) FROM public.referrals WHERE created_at >= v_since),
        'rewarded', count(*) FILTER (WHERE status = 'released'),
        'clawed_back', count(*) FILTER (WHERE clawed_back_credits > 0),
        'credits_granted', coalesce(sum(credits) FILTER (WHERE status = 'released'),0),
        'credits_reversed', coalesce(sum(clawed_back_credits),0),
        'clawback_shortfall', coalesce(sum(clawback_shortfall),0))
    INTO v_totals FROM public.referral_rewards WHERE created_at >= v_since;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.signups DESC,t.user_id), '[]'::jsonb) INTO v_top
    FROM (
        SELECT r.referrer_user_id AS user_id, u.email, count(*) AS signups,
            count(w.referee_user_id) FILTER (WHERE w.status = 'released') AS rewarded,
            coalesce(sum(w.credits) FILTER (WHERE w.status = 'released'),0) AS credits,
            coalesce(sum(w.clawed_back_credits),0) AS reversed
        FROM public.referrals r JOIN public.users u ON u.id = r.referrer_user_id
        LEFT JOIN public.referral_rewards w ON w.referee_user_id = r.referee_user_id
        WHERE r.created_at >= v_since GROUP BY r.referrer_user_id,u.email
        ORDER BY signups DESC,r.referrer_user_id LIMIT p_limit
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.referee_user_id), '[]'::jsonb) INTO v_recent
    FROM (
        SELECT w.referee_user_id, u.email AS referrer_email,w.status,w.credits,w.clawed_back_credits,
            w.clawback_shortfall,w.cancel_reason,w.created_at,w.released_at
        FROM public.referral_rewards w JOIN public.users u ON u.id = w.referrer_user_id
        WHERE w.created_at >= v_since ORDER BY w.created_at DESC,w.referee_user_id LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('ok',true,'since',v_since,'days',p_days,'totals',v_totals,'top_referrers',v_top,'recent_rewards',v_recent);
END $$;
REVOKE ALL ON FUNCTION public.admin_referrals_summary(TEXT,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_referrals_summary(TEXT,INTEGER,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_revenue_summary(p_auth_id TEXT, p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_since TIMESTAMPTZ; v_mrr JSONB; v_status JSONB; v_packs JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id, 'payments');
    IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION 'filters_invalid' USING ERRCODE = '22023';
    END IF;
    v_since := now() - make_interval(days => p_days);
    WITH subs AS (
        SELECT s.*, p.billing_interval,
            CASE WHEN s.store_channel IS NULL THEN 'stripe' ELSE s.store_channel END AS channel,
            EXISTS (SELECT 1 FROM public.credit_subscription_events e WHERE e.subscription_id = s.id
                AND e.status = 'granted' AND
                ((s.store_channel IS NULL AND e.type = 'invoice.paid')
                 OR (s.store_channel IN ('ios','android') AND e.type IN ('initial_purchase','renewal')))) AS paid
        -- Only the interval comes from the plan. Never read its current price or active flag.
        FROM public.credit_subscriptions s JOIN public.credit_subscription_plans p ON p.id = s.plan_id
    ), totals AS (
        SELECT c.channel,
            coalesce(sum(CASE WHEN s.status = 'active' AND s.current_period_end > now() AND s.paid
                THEN CASE s.billing_interval WHEN 'month' THEN s.price_usd_cents
                    WHEN 'year' THEN round(s.price_usd_cents::numeric / 12) ELSE 0 END ELSE 0 END),0) AS mrr_cents,
            count(s.id) FILTER (WHERE s.status = 'active' AND s.current_period_end > now() AND s.paid
                AND s.billing_interval NOT IN ('month','year')) AS excluded_interval_count
        FROM (VALUES ('stripe'),('ios'),('android')) c(channel) LEFT JOIN subs s ON s.channel = c.channel
        GROUP BY c.channel
    )
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.channel) INTO v_mrr FROM totals t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.channel,t.status,t.paid_invoice_recorded),'[]'::jsonb) INTO v_status
    FROM (
        SELECT channel,status,paid_invoice_recorded,count(*) AS subscriptions FROM (
            SELECT coalesce(s.store_channel,'stripe') AS channel,s.status,
                EXISTS (SELECT 1 FROM public.credit_subscription_events e WHERE e.subscription_id=s.id AND e.status='granted'
                    AND ((s.store_channel IS NULL AND e.type='invoice.paid') OR
                        (s.store_channel IN ('ios','android') AND e.type IN ('initial_purchase','renewal')))) AS paid_invoice_recorded
            FROM public.credit_subscriptions s
        ) evidence GROUP BY channel,status,paid_invoice_recorded
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.purchase_day DESC),'[]'::jsonb) INTO v_packs
    FROM (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS purchase_day,count(*) AS purchases,
            sum(price_usd_cents::bigint) AS gross_cents,sum(refunded_cents::bigint) AS refunded_to_date_cents,
            sum(price_usd_cents::bigint - refunded_cents::bigint) AS net_cents
        FROM public.top_ups WHERE status = 'credited' AND credited_at IS NOT NULL
            AND sales_channel = 'web' AND created_at >= v_since
        GROUP BY purchase_day
    ) t;
    RETURN jsonb_build_object('ok',true,'since',v_since,'days',p_days,'mrr_by_channel',v_mrr,
        'subscriptions_by_status',v_status,'pack_purchase_cohorts',v_packs,
        'store_cash_revenue','not_included','disputed_top_ups','not_recorded');
END $$;
REVOKE ALL ON FUNCTION public.admin_revenue_summary(TEXT,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_summary(TEXT,INTEGER) TO service_role;
