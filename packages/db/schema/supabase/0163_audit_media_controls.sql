-- Bounded project storage and inspection, retryable cleanup, and stable Cinema cursors.
-- Applied name: 0151_audit_media_controls
-- Renumbered after production advanced to 0162; staging already records 0151.
BEGIN;
CREATE TABLE IF NOT EXISTS private.project_asset_storage (
 asset_id uuid PRIMARY KEY REFERENCES public.project_assets(id),
 claim_key uuid, claimed_at timestamptz, purged_at timestamptz
);
CREATE TABLE IF NOT EXISTS private.project_asset_inspections (
 actor_id uuid NOT NULL, asset_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_asset_inspections_actor ON private.project_asset_inspections(actor_id,requested_at);
ALTER TABLE private.project_asset_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.project_asset_storage FORCE ROW LEVEL SECURITY;
ALTER TABLE private.project_asset_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.project_asset_inspections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.project_asset_storage,private.project_asset_inspections FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.project_asset_storage(asset_id) SELECT id FROM public.project_assets ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.project_asset_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; used_bytes bigint; objects bigint; pending bigint;
BEGIN
 SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id=p.workspace_id WHERE p.id=NEW.project_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,151));
 SELECT coalesce(sum(a.declared_bytes),0),count(*),count(*) FILTER(WHERE a.state='quarantined')
 INTO used_bytes,objects,pending FROM public.project_assets a
 JOIN public.projects p ON p.id=a.project_id JOIN public.workspaces w ON w.id=p.workspace_id
 LEFT JOIN private.project_asset_storage st ON st.asset_id=a.id
 WHERE w.organisation_id=org AND st.purged_at IS NULL;
 IF used_bytes+NEW.declared_bytes>1073741824 OR objects>=200 OR pending>=20 THEN
  RAISE EXCEPTION 'STORAGE_QUOTA_EXCEEDED' USING ERRCODE='PT429';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_asset_quota ON public.project_assets;
CREATE TRIGGER project_asset_quota BEFORE INSERT ON public.project_assets FOR EACH ROW EXECUTE FUNCTION private.project_asset_quota();
CREATE OR REPLACE FUNCTION private.project_asset_track_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN INSERT INTO private.project_asset_storage(asset_id) VALUES(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_asset_track_storage ON public.project_assets;
CREATE TRIGGER project_asset_track_storage AFTER INSERT ON public.project_assets FOR EACH ROW EXECUTE FUNCTION private.project_asset_track_storage();

CREATE OR REPLACE FUNCTION public.consume_project_asset_inspection(p_project_id uuid,p_asset_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 IF coalesce(private.project_role(p_project_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR','VIEWER','REVIEWER')
 OR NOT EXISTS(SELECT 1 FROM public.project_assets WHERE id=p_asset_id AND project_id=p_project_id) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,152));
 DELETE FROM private.project_asset_inspections WHERE actor_id=actor AND requested_at<clock_timestamp()-interval '1 minute';
 IF (SELECT count(*) FROM private.project_asset_inspections WHERE actor_id=actor)>=10 THEN
  RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';
 END IF;
 INSERT INTO private.project_asset_inspections(actor_id,asset_id) VALUES(actor,p_asset_id);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.claim_project_asset_cleanup(p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.project_assets; items jsonb:='[]'::jsonb;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 DELETE FROM private.project_asset_inspections WHERE requested_at<clock_timestamp()-interval '1 day';
 FOR a IN SELECT pa.* FROM public.project_assets pa JOIN private.project_asset_storage s ON s.asset_id=pa.id
 WHERE pa.state IN ('quarantined','rejected') AND pa.created_at<now()-interval '24 hours'
 AND s.purged_at IS NULL AND (s.claimed_at IS NULL OR s.claimed_at<now()-interval '5 minutes')
 ORDER BY pa.created_at,pa.id LIMIT 20 FOR UPDATE OF pa,s SKIP LOCKED LOOP
  IF a.state='quarantined' THEN
   PERFORM public.record_project_asset_inspection(a.id,NULL,NULL,NULL,NULL,NULL,'upload_expired');
  END IF;
  UPDATE private.project_asset_storage SET claim_key=p_key,claimed_at=now() WHERE asset_id=a.id;
  items:=items||jsonb_build_array(jsonb_build_object('id',a.id,'r2_key',a.r2_key));
 END LOOP;
 RETURN jsonb_build_object('items',items);
END $$;
CREATE OR REPLACE FUNCTION public.finish_project_asset_cleanup(p_id uuid,p_key uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE private.project_asset_storage SET purged_at=now() WHERE asset_id=p_id AND claim_key=p_key AND purged_at IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION private.project_asset_quota(),private.project_asset_track_storage(),
 public.consume_project_asset_inspection(uuid,uuid),public.claim_project_asset_cleanup(uuid),public.finish_project_asset_cleanup(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.consume_project_asset_inspection(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_asset_cleanup(uuid),public.finish_project_asset_cleanup(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_public_cinema_titles_page(p_limit INTEGER, p_before TIMESTAMPTZ, p_category TEXT, p_before_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT c.id, c.content_type, c.title, c.synopsis, c.language, c.ai_disclosures, c.categories, c.published_at,
               p.username, p.display_name,
               (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id
                WHERE s.parent_id = c.id AND e.content_type = 'EPISODE' AND e.lifecycle_status = 'PUBLISHED') AS episode_count,
               (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = c.id AND x.state = 'ready') AS duration_seconds
        FROM public.cinema_content c
        JOIN public.cinema_profiles p ON p.user_id = c.creator_id
        JOIN public.cinema_memberships m ON m.user_id = c.creator_id
        WHERE c.parent_id IS NULL AND c.lifecycle_status = 'PUBLISHED' AND c.visibility = 'PUBLIC'
          AND c.published_at IS NOT NULL AND m.account_status = 'active'
          AND (p_before IS NULL OR (p_before_id IS NULL AND c.published_at <= p_before) OR (c.published_at, c.id) < (p_before, p_before_id))
          AND (p_category IS NULL OR p_category = ANY(c.categories))
        ORDER BY c.published_at DESC, c.id DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
    ) t;
$$;
REVOKE ALL ON FUNCTION public.list_public_cinema_titles_page(integer,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_public_cinema_titles_page(integer,timestamptz,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
