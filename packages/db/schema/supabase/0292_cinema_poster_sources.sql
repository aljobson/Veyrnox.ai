-- Server-only lookup for automatic Social Cinema poster frames.
-- The Stream UID never crosses the application API boundary.
BEGIN;

CREATE OR REPLACE FUNCTION public.read_cinema_poster_source(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target UUID;
  v_type TEXT;
  v_upload public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_content_id IS NULL THEN
    RETURN jsonb_build_object('error','poster_not_found');
  END IF;

  IF p_auth_id IS NOT NULL THEN
    -- Private preview: only the active creator who owns this draft.
    IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN
      RETURN jsonb_build_object('error','poster_not_found');
    END IF;
    v_target := p_content_id;
  ELSE
    -- Public poster: every ancestor must still be public and published.
    IF public.cinema_community_root(p_content_id) IS NULL THEN
      RETURN jsonb_build_object('error','poster_not_found');
    END IF;
    SELECT content_type INTO v_type FROM public.cinema_content WHERE id=p_content_id;
    IF v_type='SERIES' THEN
      -- A series poster comes from its first playable published episode.
      SELECT e.id INTO v_target
      FROM public.cinema_content e
      JOIN public.cinema_content s ON s.id=e.parent_id
      JOIN public.cinema_uploads x ON x.content_id=e.id AND x.state='ready' AND x.stream_uid IS NOT NULL
      WHERE s.parent_id=p_content_id AND s.content_type='SEASON' AND e.content_type='EPISODE'
        AND s.lifecycle_status='PUBLISHED' AND s.visibility='PUBLIC'
        AND e.lifecycle_status='PUBLISHED' AND e.visibility='PUBLIC'
        AND public.cinema_community_root(e.id)=p_content_id
      ORDER BY s.position,e.position,e.id LIMIT 1;
    ELSIF v_type IN ('FILM','SHORT','TRAILER','EPISODE') THEN
      v_target := p_content_id;
    ELSE
      RETURN jsonb_build_object('error','poster_not_found');
    END IF;
  END IF;

  SELECT * INTO v_upload FROM public.cinema_uploads
  WHERE content_id=v_target AND state='ready' AND stream_uid IS NOT NULL
    AND duration_seconds BETWEEN 0.1 AND 600;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','poster_not_found'); END IF;
  RETURN jsonb_build_object('stream_uid',v_upload.stream_uid,'duration_seconds',v_upload.duration_seconds);
END $$;

REVOKE ALL ON FUNCTION public.read_cinema_poster_source(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_cinema_poster_source(TEXT,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
