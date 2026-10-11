-- Versioned weekly scores, frozen provisional snapshots and separate moderator decisions.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_ranking_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), competition_id UUID NOT NULL REFERENCES public.cinema_competitions(id) ON DELETE RESTRICT,
 prepared_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 model_version TEXT NOT NULL CHECK(model_version='weighted-v1'),
 rows JSONB NOT NULL CHECK(jsonb_typeof(rows)='array'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS cinema_ranking_snapshots_comp_idx ON public.cinema_ranking_snapshots(competition_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_ranking_snapshots_actor_idx ON public.cinema_ranking_snapshots(prepared_by);
CREATE TABLE IF NOT EXISTS public.cinema_ranking_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id UUID NOT NULL UNIQUE REFERENCES public.cinema_ranking_snapshots(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK(decision IN ('published','rejected')), reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS cinema_ranking_decisions_actor_idx ON public.cinema_ranking_decisions(actor_id);
ALTER TABLE public.cinema_ranking_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_ranking_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_ranking_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_ranking_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_ranking_snapshots,public.cinema_ranking_decisions FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['cinema_ranking_snapshots','cinema_ranking_decisions'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS ranking_immutable ON public.%I',t);
 EXECUTE format('CREATE TRIGGER ranking_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only()',t);
 EXECUTE format('DROP TRIGGER IF EXISTS ranking_no_truncate ON public.%I',t);
 EXECUTE format('CREATE TRIGGER ranking_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate()',t);
 END LOOP;
END $$;
-- Internal calculation: no caller-supplied aggregates or scores are accepted.
CREATE OR REPLACE FUNCTION public.calculate_cinema_weekly_scores(p_competition_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH comp AS (SELECT * FROM public.cinema_competitions WHERE id=p_competition_id),
 eligible AS (
 SELECT c.id,c.content_type,c.creator_id,c.title,public.cinema_community_root(c.id) AS root_id FROM public.cinema_content c,comp
 WHERE c.content_type=ANY(comp.target_types) AND c.published_at<comp.ends_at
 AND public.cinema_community_root(c.id) IS NOT NULL
 AND (c.content_type='SERIES' OR EXISTS(SELECT 1 FROM public.cinema_uploads u WHERE u.content_id=c.id AND u.state='ready' AND u.stream_uid IS NOT NULL))
 ), mapping AS (
 SELECT e.id AS target_id,c.id AS media_id,u.id AS upload_id,u.stream_uid,ceil(u.duration_seconds)::integer AS duration
 FROM eligible e JOIN public.cinema_content c ON c.id=e.id OR (e.content_type='SERIES' AND c.content_type='EPISODE' AND public.cinema_community_root(c.id)=e.id)
 JOIN public.cinema_uploads u ON u.content_id=c.id AND u.state='ready' AND u.duration_seconds BETWEEN 1 AND 600
 WHERE public.cinema_community_root(c.id) IS NOT NULL
 ), audience AS (
 SELECT m.target_id,m.media_id,s.user_id,m.duration,range_agg(r) AS covered
 FROM mapping m JOIN public.cinema_watch_sessions s ON s.content_id=m.media_id AND s.upload_id=m.upload_id AND s.stream_uid=m.stream_uid AND s.duration_seconds=m.duration
 JOIN public.cinema_watch_events w ON w.session_id=s.id CROSS JOIN LATERAL unnest(w.covered) r
 JOIN eligible e ON e.id=m.target_id JOIN public.users a ON a.id=s.user_id JOIN auth.users au ON au.id::text=a.auth_id
 JOIN public.cinema_profiles pr ON pr.user_id=a.id JOIN public.cinema_memberships am ON am.user_id=a.id, comp
 WHERE w.created_at>=comp.starts_at AND w.created_at<comp.ends_at AND am.account_status='active' AND a.frozen_at IS NULL AND s.user_id<>e.creator_id
 GROUP BY m.target_id,m.media_id,s.user_id,m.duration
 ), qualified AS (
 SELECT target_id,user_id,avg(least(1.0,seconds::numeric/duration)) AS fraction,bool_and(seconds>=duration*0.9) AS completed
 FROM (SELECT target_id,user_id,duration,(SELECT coalesce(sum(upper(r)-lower(r)),0) FROM unnest(covered) r) AS seconds FROM audience) a
 WHERE seconds>=least(30,duration) GROUP BY target_id,user_id
 ), totals AS (
 SELECT e.id,e.title,e.content_type,e.root_id,
 (SELECT count(*) FROM public.cinema_votes v JOIN public.users u ON u.id=v.voter_id JOIN auth.users au ON au.id::text=u.auth_id
 JOIN public.cinema_profiles pr ON pr.user_id=u.id JOIN public.cinema_memberships um ON um.user_id=u.id,comp
 WHERE v.competition_id=comp.id AND v.content_id=e.id AND v.status='qualified' AND v.created_at>=comp.starts_at AND v.created_at<comp.ends_at
 AND um.account_status='active' AND u.frozen_at IS NULL AND u.id<>e.creator_id) AS votes,
 (SELECT count(*) FROM qualified q WHERE q.target_id=e.id) AS viewers,
 (SELECT count(*) FROM qualified q WHERE q.target_id=e.id AND q.completed) AS completions,
 (SELECT count(DISTINCT sh.actor_id) FROM public.cinema_share_actions sh JOIN qualified q ON q.target_id=e.id AND q.user_id=sh.actor_id,comp
 WHERE (sh.content_id=e.id OR EXISTS(SELECT 1 FROM mapping m WHERE m.target_id=e.id AND m.media_id=sh.content_id))
 AND sh.created_at>=comp.starts_at AND sh.created_at<comp.ends_at) AS shares,
 (SELECT count(DISTINCT cm.author_id) FROM public.cinema_comments cm JOIN qualified q ON q.target_id=e.id AND q.user_id=cm.author_id,comp
 WHERE (cm.content_id=e.id OR EXISTS(SELECT 1 FROM mapping m WHERE m.target_id=e.id AND m.media_id=cm.content_id))
 AND cm.status='approved' AND cm.created_at>=comp.starts_at AND cm.created_at<comp.ends_at AND NOT EXISTS(
 SELECT 1 FROM public.cinema_comment_reports cr WHERE cr.comment_id=cm.id AND cr.status='open')) AS engagement
 FROM eligible e
 ), samples AS (SELECT * FROM totals WHERE viewers>=5), normalized AS (
 SELECT *,coalesce(ln(1+votes::numeric)/nullif(max(ln(1+votes::numeric)) OVER(),0),0) AS vote_score,
 completions::numeric/(viewers+4) AS completion_score,
 coalesce(ln(1+viewers::numeric)/nullif(max(ln(1+viewers::numeric)) OVER(),0),0) AS viewer_score,
 coalesce(ln(1+shares::numeric)/nullif(max(ln(1+shares::numeric)) OVER(),0),0) AS share_score,
 coalesce(ln(1+engagement::numeric)/nullif(max(ln(1+engagement::numeric)) OVER(),0),0) AS engagement_score FROM samples
 ), scored AS (
 SELECT *,round((0.40*vote_score+0.25*completion_score+0.15*viewer_score+0.10*share_score+0.10*engagement_score)*100,6) AS score FROM normalized
 ), ranked AS (
 SELECT *,dense_rank() OVER(ORDER BY score DESC) AS rank FROM scored
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('content_id',id,'root_id',root_id,'title',title,'content_type',content_type,
 'rank',rank,'score',score,'signals',jsonb_build_object('votes',votes,'viewers',viewers,'completions',completions,'shares',shares,'engagement',engagement),
 'components',jsonb_build_object('votes',vote_score,'completion',completion_score,'viewers',viewer_score,'sharing',share_score,'engagement',engagement_score))
 ORDER BY rank,id),'[]'::jsonb) FROM ranked;
$$;
REVOKE ALL ON FUNCTION public.calculate_cinema_weekly_scores(UUID) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.manage_cinema_rankings(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_payload JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_action TEXT; v_target UUID; v_reason TEXT; v_old public.cinema_community_actions%ROWTYPE;
 v_comp public.cinema_competitions%ROWTYPE; v_snapshot public.cinema_ranking_snapshots%ROWTYPE; v_rows JSONB; v_result JSONB; v_status TEXT;
BEGIN
 v_actor:=public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at);
 IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_actor AND role='administrator' AND account_status='active' FOR SHARE;
 IF NOT FOUND OR public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 IF p_idempotency_key IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','id','reason'))
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500
 OR coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_action:=p_payload->>'action';v_reason:=btrim(p_payload->>'reason');v_target:=(p_payload->>'id')::uuid;
 IF v_action IS NULL OR v_action NOT IN ('prepare','publish','reject') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 -- Serialize this actor's audited actions; each calculation uses one MVCC snapshot.
 PERFORM pg_advisory_xact_lock(266,hashtext(v_actor::text));
 PERFORM pg_advisory_xact_lock(282,hashtext(v_target::text));
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 SELECT * INTO v_old FROM public.cinema_community_actions WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
 IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 RETURN v_old.result||jsonb_build_object('idempotent',true);
 END IF;
 IF v_action='prepare' THEN
 SELECT * INTO v_comp FROM public.cinema_competitions WHERE id=v_target FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','competition_not_found'); END IF;
 IF v_comp.status<>'closed' OR v_comp.ends_at>clock_timestamp() OR v_comp.ends_at-v_comp.starts_at>interval '8 days' THEN RETURN jsonb_build_object('error','competition_not_closed'); END IF;
 IF EXISTS(SELECT 1 FROM public.cinema_votes WHERE competition_id=v_target AND status='under_review') THEN RETURN jsonb_build_object('error','votes_need_review'); END IF;
 SELECT s.* INTO v_snapshot FROM public.cinema_ranking_snapshots s WHERE s.competition_id=v_target AND NOT EXISTS(SELECT 1 FROM public.cinema_ranking_decisions d WHERE d.snapshot_id=s.id AND d.decision='rejected');
 IF FOUND THEN RETURN jsonb_build_object('error','snapshot_exists'); END IF;
 -- One MVCC statement freezes the actual eligible aggregate, never submitted numbers.
 v_rows:=public.calculate_cinema_weekly_scores(v_target);
 IF jsonb_array_length(v_rows)=0 THEN RETURN jsonb_build_object('error','insufficient_audience'); END IF;
 IF jsonb_array_length(v_rows)>500 THEN RETURN jsonb_build_object('error','ranking_capacity'); END IF;
 IF EXISTS(SELECT 1 FROM public.cinema_content c JOIN jsonb_array_elements(v_rows) r ON c.id=(r->>'content_id')::uuid WHERE c.creator_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
 INSERT INTO public.cinema_ranking_snapshots(competition_id,prepared_by,model_version,rows) VALUES(v_target,v_actor,'weighted-v1',v_rows) RETURNING * INTO v_snapshot;
 v_target:=v_snapshot.id;v_status:='provisional';
 ELSE
 SELECT * INTO v_snapshot FROM public.cinema_ranking_snapshots WHERE id=v_target FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','snapshot_not_found'); END IF;
 IF v_snapshot.prepared_by=v_actor OR EXISTS(SELECT 1 FROM public.cinema_content c JOIN jsonb_array_elements(v_snapshot.rows) r ON c.id=(r->>'content_id')::uuid WHERE c.creator_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
 IF EXISTS(SELECT 1 FROM public.cinema_ranking_decisions WHERE snapshot_id=v_target) THEN RETURN jsonb_build_object('error','already_decided'); END IF;
 IF v_action='publish' AND EXISTS(SELECT 1 FROM public.cinema_votes WHERE competition_id=v_snapshot.competition_id AND status='under_review') THEN RETURN jsonb_build_object('error','votes_need_review'); END IF;
 IF v_action='publish' AND public.calculate_cinema_weekly_scores(v_snapshot.competition_id) IS DISTINCT FROM v_snapshot.rows THEN RETURN jsonb_build_object('error','snapshot_stale'); END IF;
 IF v_action='publish' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot.rows) r WHERE public.cinema_community_root((r->>'content_id')::uuid) IS NULL) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 v_status:=CASE WHEN v_action='publish' THEN 'published' ELSE 'rejected' END;
 INSERT INTO public.cinema_ranking_decisions(snapshot_id,actor_id,decision,reason) VALUES(v_target,v_actor,v_status,v_reason);
 END IF;
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'administrator changed during ranking decision' USING ERRCODE='42501'; END IF;
 v_result:=jsonb_build_object('id',v_target,'status',v_status,'idempotent',false);
 INSERT INTO public.cinema_community_actions(actor_id,idempotency_key,action,target_id,reason,prior_status,new_status,payload,result,request_id)
 VALUES(v_actor,p_idempotency_key,'ranking_'||v_action,v_target,v_reason,NULL,v_status,p_payload,v_result,p_request_id);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_ranking_review(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 RETURN jsonb_build_object('competitions',coalesce((SELECT jsonb_agg(x ORDER BY ends_at DESC,id) FROM (
 SELECT c.id,c.name,c.ends_at FROM public.cinema_competitions c WHERE c.status='closed' AND c.ends_at<=now()
 AND NOT EXISTS(SELECT 1 FROM public.cinema_ranking_snapshots s WHERE s.competition_id=c.id AND NOT EXISTS(SELECT 1 FROM public.cinema_ranking_decisions d WHERE d.snapshot_id=s.id AND d.decision='rejected')) ORDER BY c.ends_at DESC,c.id LIMIT 50) x),'[]'::jsonb),
 'snapshots',coalesce((SELECT jsonb_agg(x ORDER BY created_at DESC,id) FROM (
 SELECT s.id,c.name,s.model_version,s.rows,s.created_at,coalesce(d.decision,'provisional') AS status,s.prepared_by=public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) AS own
 FROM public.cinema_ranking_snapshots s JOIN public.cinema_competitions c ON c.id=s.competition_id LEFT JOIN public.cinema_ranking_decisions d ON d.snapshot_id=s.id
 ORDER BY s.created_at DESC,s.id LIMIT 50) x),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_winners()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',c.name,'ends_at',c.ends_at,'model_version',s.model_version,'published_at',d.created_at,
 'titles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->>'content_id','root_id',r->>'root_id','title',t.title,'content_type',t.content_type,
 'rank',(r->>'rank')::integer,'score',(r->>'score')::numeric) ORDER BY (r->>'rank')::integer,r->>'content_id'),'[]'::jsonb)
 FROM jsonb_array_elements(s.rows) r JOIN public.cinema_content t ON t.id=(r->>'content_id')::uuid
 WHERE (r->>'rank')::integer<=3 AND public.cinema_community_root(t.id) IS NOT NULL)) ORDER BY d.created_at DESC,s.id),'[]'::jsonb)
 FROM (SELECT * FROM public.cinema_ranking_decisions WHERE decision='published' ORDER BY created_at DESC,id LIMIT 12) d
 JOIN public.cinema_ranking_snapshots s ON s.id=d.snapshot_id JOIN public.cinema_competitions c ON c.id=s.competition_id;
$$;
REVOKE ALL ON FUNCTION public.manage_cinema_rankings(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_ranking_review(TEXT,TEXT,BIGINT),public.list_cinema_winners() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manage_cinema_rankings(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_ranking_review(TEXT,TEXT,BIGINT),public.list_cinema_winners() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
