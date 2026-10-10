-- Read-only Cinema discovery: published roots, series, and eligible voting targets.
-- No audience identities, private review state, signed media URLs, rankings or money.
BEGIN;
CREATE INDEX IF NOT EXISTS cinema_content_discovery_idx ON public.cinema_content(published_at DESC,id DESC)
 WHERE lifecycle_status='PUBLISHED' AND visibility='PUBLIC' AND published_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.list_cinema_discovery(
 p_mode TEXT,p_limit INTEGER,p_before TIMESTAMPTZ,p_before_id UUID,p_category TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_items JSONB;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('all','series','voting') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 24
 OR (p_before IS NULL) <> (p_before_id IS NULL)
 OR (p_category IS NOT NULL AND p_category !~ '^[a-z][a-z0-9-]{1,31}$')
 THEN RETURN jsonb_build_object('error','invalid_query'); END IF;
 WITH candidates AS MATERIALIZED (
  SELECT c.*,r.id AS root_id,r.title AS series_title,r.categories AS root_categories,p.username,p.display_name,
   (SELECT x.duration_seconds::INTEGER FROM public.cinema_uploads x WHERE x.content_id=c.id AND x.state='ready') AS duration_seconds
  FROM public.cinema_content c
  JOIN public.cinema_content r ON r.id=public.cinema_community_root(c.id)
  JOIN public.cinema_profiles p ON p.user_id=c.creator_id
  WHERE c.published_at IS NOT NULL
  AND ((p_mode='all' AND c.parent_id IS NULL) OR (p_mode='series' AND c.content_type='SERIES' AND c.parent_id IS NULL)
       OR (p_mode='voting' AND c.content_type IN ('FILM','SHORT','TRAILER','SERIES','EPISODE')
          AND EXISTS(SELECT 1 FROM public.cinema_competitions k WHERE k.status='open' AND k.starts_at<=now() AND k.ends_at>now() AND c.content_type=ANY(k.target_types))))
  AND (p_before IS NULL OR (c.published_at,c.id)<(p_before,p_before_id))
  AND (p_category IS NULL OR p_category=ANY(r.categories))
  AND ((c.content_type<>'SERIES' AND EXISTS(SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=c.id AND x.state='ready'))
       OR (c.content_type='SERIES' AND EXISTS(
        SELECT 1 FROM public.cinema_content e JOIN public.cinema_content s ON s.id=e.parent_id
        JOIN public.cinema_uploads x ON x.content_id=e.id AND x.state='ready'
        WHERE s.parent_id=c.id AND e.content_type='EPISODE' AND public.cinema_community_root(e.id)=c.id)))
  ORDER BY c.published_at DESC,c.id DESC LIMIT p_limit
 )
 SELECT coalesce(jsonb_agg(item ORDER BY published_at DESC,id DESC),'[]'::jsonb) INTO v_items FROM (
  SELECT c.published_at,c.id,jsonb_build_object(
   'id',c.id,'root_id',c.root_id,'content_type',c.content_type,'title',c.title,'synopsis',c.synopsis,
   'series_title',CASE WHEN c.parent_id IS NOT NULL THEN c.series_title ELSE NULL END,
   'categories',c.root_categories,'published_at',c.published_at,'username',c.username,'display_name',c.display_name,
   'duration_seconds',c.duration_seconds,
   'episode_count',(SELECT count(*)::INTEGER FROM public.cinema_content e JOIN public.cinema_content s ON s.id=e.parent_id
      JOIN public.cinema_uploads x ON x.content_id=e.id AND x.state='ready'
      WHERE s.parent_id=c.id AND e.content_type='EPISODE' AND public.cinema_community_root(e.id)=c.id),
   'competitions',CASE WHEN p_mode<>'voting' THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(k.item ORDER BY k.ends_at,k.id) FROM (
     SELECT k.id,k.ends_at,jsonb_build_object('id',k.id,'name',k.name,'ends_at',k.ends_at,
      'qualified_votes',(SELECT count(*)::INTEGER FROM public.cinema_votes v
       JOIN public.users u ON u.id=v.voter_id JOIN auth.users a ON a.id::TEXT=u.auth_id
       JOIN public.cinema_profiles p ON p.user_id=u.id JOIN public.cinema_memberships m ON m.user_id=u.id
       WHERE v.content_id=c.id AND v.competition_id=k.id AND v.status='qualified'
       AND u.frozen_at IS NULL AND m.account_status='active')) AS item
     FROM public.cinema_competitions k WHERE k.status='open' AND k.starts_at<=now() AND k.ends_at>now()
      AND c.content_type=ANY(k.target_types) ORDER BY k.ends_at,k.id LIMIT 25
    ) k),'[]'::jsonb) END
  ) AS item FROM candidates c
 ) page;
 RETURN jsonb_build_object('titles',v_items);
END $$;
REVOKE ALL ON FUNCTION public.list_cinema_discovery(TEXT,INTEGER,TIMESTAMPTZ,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_cinema_discovery(TEXT,INTEGER,TIMESTAMPTZ,UUID,TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
