-- 0316: paid inbox volume, delivery and response-time analytics.
BEGIN;

CREATE INDEX IF NOT EXISTS social_inbox_messages_sent_idx
  ON public.social_inbox_messages(sent_at DESC,thread_id);

CREATE OR REPLACE FUNCTION public.get_social_inbox_analytics(
  p_auth_id TEXT,p_brand_id UUID,p_account_id UUID DEFAULT NULL,p_days INTEGER DEFAULT 30
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_since TIMESTAMPTZ;v_summary JSONB;v_trend JSONB;v_platforms JSONB;v_heatmap JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_days NOT IN (7,30,90) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RANGE'); END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id)
    THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  v_since:=date_trunc('day',now())-make_interval(days=>p_days-1);

  WITH messages AS (
    SELECT m.*,t.account_id FROM public.social_inbox_messages m JOIN public.social_inbox_threads t ON t.id=m.thread_id
    WHERE t.brand_id=p_brand_id AND m.sent_at>=v_since AND (p_account_id IS NULL OR t.account_id=p_account_id)
  ),responses AS (
    SELECT extract(epoch FROM (reply.sent_at-inbound.sent_at)) seconds FROM messages inbound
    CROSS JOIN LATERAL (SELECT outbound.sent_at FROM messages outbound WHERE outbound.thread_id=inbound.thread_id
      AND outbound.direction='outbound' AND outbound.delivery_status='sent' AND outbound.sent_at>=inbound.sent_at
      ORDER BY outbound.sent_at,outbound.id LIMIT 1) reply
    WHERE inbound.direction='inbound'
  ) SELECT jsonb_build_object(
    'conversations',(SELECT count(DISTINCT thread_id) FROM messages),
    'received',(SELECT count(*) FROM messages WHERE direction='inbound'),
    'sent',(SELECT count(*) FROM messages WHERE direction='outbound' AND delivery_status='sent'),
    'failed',(SELECT count(*) FROM messages WHERE direction='outbound' AND delivery_status='failed'),
    'read_actions',(SELECT count(*) FROM public.social_inbox_actions a JOIN public.social_inbox_threads t ON t.id=a.thread_id
      WHERE a.brand_id=p_brand_id AND a.action='read' AND a.created_at>=v_since AND (p_account_id IS NULL OR t.account_id=p_account_id)),
    'median_response_seconds',(SELECT round(percentile_cont(0.5) WITHIN GROUP(ORDER BY seconds)::NUMERIC) FROM responses)
  ) INTO v_summary;

  WITH days AS (SELECT generate_series(v_since::DATE,(now() AT TIME ZONE 'UTC')::DATE,'1 day'::INTERVAL)::DATE day),counts AS (
    SELECT (m.sent_at AT TIME ZONE 'UTC')::DATE day,count(*) FILTER(WHERE m.direction='inbound') received,
      count(*) FILTER(WHERE m.direction='outbound' AND m.delivery_status='sent') sent,
      count(*) FILTER(WHERE m.direction='outbound' AND m.delivery_status='failed') failed
    FROM public.social_inbox_messages m JOIN public.social_inbox_threads t ON t.id=m.thread_id
    WHERE t.brand_id=p_brand_id AND m.sent_at>=v_since AND (p_account_id IS NULL OR t.account_id=p_account_id) GROUP BY 1
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.day,'received',coalesce(c.received,0),'sent',coalesce(c.sent,0),'failed',coalesce(c.failed,0)) ORDER BY d.day),'[]'::JSONB)
    INTO v_trend FROM days d LEFT JOIN counts c USING(day);

  SELECT coalesce(jsonb_agg(jsonb_build_object('network',q.network,'received',q.received,'sent',q.sent,'failed',q.failed) ORDER BY q.received DESC,q.network),'[]'::JSONB)
    INTO v_platforms FROM (SELECT a.network,count(*) FILTER(WHERE m.direction='inbound') received,
      count(*) FILTER(WHERE m.direction='outbound' AND m.delivery_status='sent') sent,
      count(*) FILTER(WHERE m.direction='outbound' AND m.delivery_status='failed') failed
    FROM public.social_inbox_messages m JOIN public.social_inbox_threads t ON t.id=m.thread_id JOIN public.social_accounts a ON a.id=t.account_id
    WHERE t.brand_id=p_brand_id AND m.sent_at>=v_since AND (p_account_id IS NULL OR t.account_id=p_account_id) GROUP BY a.network) q;

  SELECT coalesce(jsonb_agg(jsonb_build_object('weekday',q.weekday,'hour',q.hour,'received',q.received) ORDER BY q.weekday,q.hour),'[]'::JSONB)
    INTO v_heatmap FROM (SELECT extract(isodow FROM m.sent_at AT TIME ZONE 'UTC')::INTEGER weekday,
      extract(hour FROM m.sent_at AT TIME ZONE 'UTC')::INTEGER hour,count(*) received
    FROM public.social_inbox_messages m JOIN public.social_inbox_threads t ON t.id=m.thread_id
    WHERE t.brand_id=p_brand_id AND m.direction='inbound' AND m.sent_at>=v_since AND (p_account_id IS NULL OR t.account_id=p_account_id)
    GROUP BY 1,2) q;

  RETURN jsonb_build_object('ok',true,'range_days',p_days,'since',v_since,'summary',v_summary,'trend',v_trend,'platforms',v_platforms,'heatmap',v_heatmap);
END $$;

REVOKE ALL ON FUNCTION public.get_social_inbox_analytics(TEXT,UUID,UUID,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_inbox_analytics(TEXT,UUID,UUID,INTEGER) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
