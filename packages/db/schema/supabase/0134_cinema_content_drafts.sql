-- Private creator drafts only. Publishing, uploads and rights approval are separate capabilities.
CREATE TABLE IF NOT EXISTS public.cinema_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('FILM','SHORT','TRAILER','SERIES','SEASON','EPISODE')),
  parent_id UUID,
  position INTEGER,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  synopsis TEXT NOT NULL DEFAULT '' CHECK (length(synopsis)<=2000),
  language TEXT NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  ai_disclosures TEXT[] NOT NULL DEFAULT '{}',
  lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status='DRAFT'),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility='PRIVATE'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id,creator_id),
  FOREIGN KEY(parent_id,creator_id) REFERENCES public.cinema_content(id,creator_id) ON DELETE CASCADE,
  UNIQUE(parent_id,position),
  CHECK ((content_type IN ('SEASON','EPISODE') AND parent_id IS NOT NULL AND position IS NOT NULL AND position BETWEEN 1 AND 10000)
    OR (content_type IN ('FILM','SHORT','TRAILER','SERIES') AND parent_id IS NULL AND position IS NULL)),
  CHECK (ai_disclosures <@ ARRAY['generated_video','generated_voice','generated_music','synthetic_people','face_replacement','cloned_voice','generated_script','manipulated_real_world_footage']::TEXT[])
);
CREATE INDEX IF NOT EXISTS cinema_content_owner_parent_idx ON public.cinema_content(creator_id,parent_id,position,id);
CREATE TABLE IF NOT EXISTS public.cinema_content_mutations (
  creator_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  payload JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,idempotency_key)
);
ALTER TABLE public.cinema_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_content FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_content_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_content_mutations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_content,public.cinema_content_mutations FROM PUBLIC,anon,authenticated,service_role;

-- Authority is the current membership, never application status or a client claim.
CREATE OR REPLACE FUNCTION public.save_cinema_draft(p_auth_id TEXT,p_idempotency_key UUID,p_content_id UUID,p_revision INTEGER,p_draft JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user UUID; v_member public.cinema_memberships%ROWTYPE;
  v_row public.cinema_content%ROWTYPE; v_parent public.cinema_content%ROWTYPE;
  v_old public.cinema_content_mutations%ROWTYPE;
  v_payload JSONB; v_result JSONB; v_parent_id UUID; v_position INTEGER; v_ai TEXT[];
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.role<>'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_idempotency_key IS NULL OR p_revision IS NULL OR p_revision<0
    OR p_draft IS NULL OR jsonb_typeof(p_draft)<>'object' THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('content_type','parent_id','position','title','synopsis','language','ai_disclosures'))
    OR jsonb_typeof(p_draft->'content_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'title') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'synopsis') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'language') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'ai_disclosures') IS DISTINCT FROM 'array'
    OR NOT (p_draft ?& ARRAY['parent_id','position']) THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF p_draft->>'content_type' NOT IN ('FILM','SHORT','TRAILER','SERIES','SEASON','EPISODE')
    OR length(btrim(p_draft->>'title')) NOT BETWEEN 1 AND 160 OR length(p_draft->>'synopsis')>2000
    OR p_draft->>'language' !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    OR jsonb_array_length(p_draft->'ai_disclosures')>8 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'ai_disclosures') x WHERE jsonb_typeof(x)<>'string') THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_ai FROM jsonb_array_elements_text(p_draft->'ai_disclosures') x;
  IF NOT (v_ai <@ ARRAY['generated_video','generated_voice','generated_music','synthetic_people','face_replacement','cloned_voice','generated_script','manipulated_real_world_footage']::TEXT[])
    OR cardinality(v_ai)<>(SELECT count(DISTINCT x) FROM unnest(v_ai) x) THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF p_draft->>'content_type' IN ('SEASON','EPISODE') THEN
    IF jsonb_typeof(p_draft->'parent_id') IS DISTINCT FROM 'string' OR p_draft->>'parent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_draft->'position') IS DISTINCT FROM 'number' OR p_draft->>'position' !~ '^[1-9][0-9]{0,4}$' THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
    v_parent_id := (p_draft->>'parent_id')::UUID; v_position := (p_draft->>'position')::INTEGER;
    IF v_position>10000 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  ELSIF p_draft->'parent_id'<>'null'::JSONB OR p_draft->'position'<>'null'::JSONB THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  v_payload := jsonb_build_object('id',p_content_id,'revision',p_revision,'draft',p_draft);
  SELECT * INTO v_old FROM public.cinema_content_mutations WHERE creator_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_old.payload<>v_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN v_old.result || jsonb_build_object('idempotent',true);
  END IF;
  IF v_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.cinema_content WHERE id=v_parent_id AND creator_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
    IF v_parent.lifecycle_status<>'DRAFT' OR v_parent.content_type<>(CASE WHEN p_draft->>'content_type'='SEASON' THEN 'SERIES' ELSE 'SEASON' END) THEN
      RETURN jsonb_build_object('error','invalid_parent'); END IF;
  END IF;
  IF p_content_id IS NULL THEN
    IF p_revision<>0 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
    -- Serialized by membership lock; bounded lists and storage even under concurrent creates.
    IF (SELECT count(*) FROM public.cinema_content WHERE creator_id=v_user)>=1000
      OR (SELECT count(*) FROM public.cinema_content WHERE creator_id=v_user AND parent_id IS NOT DISTINCT FROM v_parent_id)>=100 THEN
      RETURN jsonb_build_object('error','draft_limit_reached'); END IF;
    BEGIN
      INSERT INTO public.cinema_content(creator_id,content_type,parent_id,position,title,synopsis,language,ai_disclosures)
      VALUES(v_user,p_draft->>'content_type',v_parent_id,v_position,btrim(p_draft->>'title'),p_draft->>'synopsis',p_draft->>'language',v_ai) RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('error','position_taken'); END;
  ELSE
    SELECT * INTO v_row FROM public.cinema_content WHERE id=p_content_id AND creator_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
    IF v_row.lifecycle_status<>'DRAFT' THEN RETURN jsonb_build_object('error','draft_locked'); END IF;
    IF v_row.revision<>p_revision THEN RETURN jsonb_build_object('error','revision_conflict'); END IF;
    IF v_row.content_type<>p_draft->>'content_type' OR v_row.parent_id IS DISTINCT FROM v_parent_id OR v_row.position IS DISTINCT FROM v_position THEN
      RETURN jsonb_build_object('error','structure_locked'); END IF;
    UPDATE public.cinema_content SET title=btrim(p_draft->>'title'),synopsis=p_draft->>'synopsis',language=p_draft->>'language',ai_disclosures=v_ai,revision=revision+1,updated_at=now()
      WHERE id=p_content_id RETURNING * INTO v_row;
  END IF;
  v_result := jsonb_build_object('id',v_row.id,'revision',v_row.revision,'idempotent',false);
  INSERT INTO public.cinema_content_mutations(creator_id,idempotency_key,payload,result) VALUES(v_user,p_idempotency_key,v_payload,v_result);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.list_own_cinema_content(p_auth_id TEXT,p_parent_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_member public.cinema_memberships%ROWTYPE;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user;
  IF NOT FOUND OR v_member.role<>'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=p_parent_id AND creator_id=v_user) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  RETURN jsonb_build_object('content',coalesce((SELECT jsonb_agg(to_jsonb(c)-'creator_id' ORDER BY c.position,c.created_at,c.id)
    FROM public.cinema_content c WHERE c.creator_id=v_user AND c.parent_id IS NOT DISTINCT FROM p_parent_id),'[]'::JSONB));
END $$;
REVOKE ALL ON FUNCTION public.save_cinema_draft(TEXT,UUID,UUID,INTEGER,JSONB),public.list_own_cinema_content(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_cinema_draft(TEXT,UUID,UUID,INTEGER,JSONB),public.list_own_cinema_content(TEXT,UUID) TO service_role;
