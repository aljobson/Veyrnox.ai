-- Private creator aggregates for a fixed, completed 28-day UTC window.
BEGIN;
CREATE INDEX IF NOT EXISTS cinema_watch_sessions_target_time_idx ON public.cinema_watch_sessions(content_id,created_at);
CREATE OR REPLACE FUNCTION public.read_cinema_creator_analytics(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_metrics JSONB; v_viewers BIGINT;
BEGIN
 v_actor:=public.cinema_community_actor(p_auth_id);
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.cinema_memberships WHERE user_id=v_actor AND role='creator') THEN RETURN jsonb_build_object('error','creator_required'); END IF;
 IF p_content_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=p_content_id AND creator_id=v_actor AND parent_id IS NULL)
 OR NOT public.cinema_retention_title(p_content_id) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 v_end:=date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; v_start:=((v_end AT TIME ZONE 'UTC')-interval '28 days') AT TIME ZONE 'UTC';
 WITH media AS (
 SELECT c.id,u.id AS upload_id,u.stream_uid,ceil(u.duration_seconds)::INTEGER AS duration
 FROM public.cinema_content c JOIN public.cinema_uploads u ON u.content_id=c.id
 WHERE (c.id=p_content_id OR (c.content_type='EPISODE' AND public.cinema_community_root(c.id)=p_content_id))
 AND public.cinema_community_root(c.id) IS NOT NULL AND u.state='ready' AND u.duration_seconds BETWEEN 1 AND 600
 ), audience AS (
 SELECT s.user_id,m.id,m.duration,range_agg(r) AS covered
 FROM media m JOIN public.cinema_watch_sessions s ON s.content_id=m.id AND s.upload_id=m.upload_id AND s.stream_uid=m.stream_uid AND s.duration_seconds=m.duration
 JOIN public.cinema_watch_events w ON w.session_id=s.id CROSS JOIN LATERAL unnest(w.covered) r
 JOIN public.users a ON a.id=s.user_id JOIN auth.users au ON au.id::TEXT=a.auth_id
 JOIN public.cinema_profiles pr ON pr.user_id=a.id JOIN public.cinema_memberships am ON am.user_id=a.id
 WHERE s.created_at>=v_start-interval '15 minutes' AND s.created_at<v_end AND w.created_at>=v_start AND w.created_at<v_end AND am.account_status='active' AND a.frozen_at IS NULL AND a.id<>v_actor
 GROUP BY s.user_id,m.id,m.duration
 ), qualified AS (
 SELECT user_id,bool_and(seconds>=duration*0.9) AS completed
 FROM (SELECT user_id,duration,(SELECT coalesce(sum(upper(r)-lower(r)),0) FROM unnest(covered) r) AS seconds FROM audience) a
 WHERE seconds>=least(30,duration) GROUP BY user_id
 ), totals AS (
 SELECT (SELECT count(*) FROM qualified) AS viewers,(SELECT count(*) FROM qualified WHERE completed) AS completions,
 (SELECT count(DISTINCT v.voter_id) FROM public.cinema_votes v JOIN qualified q ON q.user_id=v.voter_id
 WHERE v.content_id=p_content_id AND v.status='qualified' AND v.created_at>=v_start AND v.created_at<v_end) AS voters,
 (SELECT count(DISTINCT sh.actor_id) FROM public.cinema_share_actions sh JOIN qualified q ON q.user_id=sh.actor_id
 WHERE (sh.content_id=p_content_id OR sh.content_id IN (SELECT id FROM media)) AND sh.created_at>=v_start AND sh.created_at<v_end) AS sharers,
 (SELECT count(DISTINCT cm.author_id) FROM public.cinema_comments cm JOIN qualified q ON q.user_id=cm.author_id
 WHERE (cm.content_id=p_content_id OR cm.content_id IN (SELECT id FROM media)) AND cm.status='approved' AND cm.created_at>=v_start AND cm.created_at<v_end
 AND NOT EXISTS(SELECT 1 FROM public.cinema_comment_reports cr WHERE cr.comment_id=cm.id AND cr.status='open')) AS commenters
 ) SELECT viewers,to_jsonb(t) INTO v_viewers,v_metrics FROM totals t;
 RETURN jsonb_build_object('content_id',p_content_id,'period_start',v_start,'period_end',v_end,'minimum_viewers',5,'suppressed',v_viewers<5,
 'metrics',CASE WHEN v_viewers>=5 THEN v_metrics ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.read_cinema_creator_analytics(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_cinema_creator_analytics(TEXT,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
