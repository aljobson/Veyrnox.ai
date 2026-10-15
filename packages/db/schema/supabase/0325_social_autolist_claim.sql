-- Execute the modifying claim CTE at the top level, preserving SKIP LOCKED.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_due_social_publish_autolists(p_limit INTEGER DEFAULT 5)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit INTEGER;v_autolists JSONB;
BEGIN
  v_limit:=least(greatest(coalesce(p_limit,5),1),10);
  WITH claimed AS (
    SELECT a.id FROM public.social_publish_autolists a JOIN public.social_publish_queues q ON q.id=a.queue_id
    WHERE a.enabled AND q.enabled AND a.next_refresh_at<=now() ORDER BY a.next_refresh_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT v_limit
  ), updated AS (
    UPDATE public.social_publish_autolists a SET next_refresh_at=now()+make_interval(mins=>a.refresh_interval_minutes),updated_at=now()
    FROM claimed c WHERE a.id=c.id RETURNING a.*
  ) SELECT jsonb_agg(jsonb_build_object('id',u.id,'feed_url',u.feed_url,'etag',u.etag,'last_modified',u.last_modified,'auto_schedule',u.auto_schedule) ORDER BY u.id) INTO v_autolists FROM updated u;
  RETURN jsonb_build_object('ok',true,'autolists',coalesce(v_autolists,'[]'::jsonb));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
