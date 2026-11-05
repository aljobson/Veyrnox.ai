-- 0441: tie a Publish brand to a workspace brand kit (ADR-0325).
-- A Publish brand (social_brands) groups connected accounts; a brand kit
-- (workspace_editor_brand_kits, 0280) holds name, palette, fonts, text styles
-- and licensed assets for one workspace. Until now they shared nothing.
-- This adds one optional link per Publish brand. Additive and idempotent.
--
-- Writes: the brand OWNER only, and only to a workspace the same person can
-- edit (organisation OWNER/ADMIN, or workspace CREATOR/EDITOR).
-- Reads: any brand member. They get the kit's presentation (name, palette,
-- fonts, text styles) and the licence-credit lines of its assets, never the
-- project or asset ids, so a team member does not need workspace access.
-- No client policies; service_role RPCs only, keyed by the verified auth id.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_brand_kit_links (
    brand_id     UUID        PRIMARY KEY REFERENCES public.social_brands(id) ON DELETE CASCADE,
    workspace_id UUID        NOT NULL REFERENCES public.workspaces(id),
    linked_by    UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    linked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_brand_kit_links_workspace_idx ON public.social_brand_kit_links (workspace_id);
ALTER TABLE public.social_brand_kit_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_brand_kit_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_brand_kit_links FROM PUBLIC, anon, authenticated, service_role;

-- The acting person's role in a workspace, resolved from a verified auth id
-- (private.workspace_role reads auth.uid(), which a service-role call lacks).
CREATE OR REPLACE FUNCTION private.social_kit_workspace_role(p_auth UUID, p_workspace UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT CASE WHEN m.role IN ('OWNER','ADMIN') THEN m.role ELSE coalesce(wm.role, m.role) END
    FROM public.workspaces w
    JOIN public.organisations o ON o.id = w.organisation_id AND o.deleted_at IS NULL
    JOIN public.organisation_members m ON m.organisation_id = o.id AND m.user_id = p_auth
    LEFT JOIN public.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = m.user_id
    WHERE w.id = p_workspace AND w.deleted_at IS NULL AND m.role <> 'BILLING';
$$;
REVOKE ALL ON FUNCTION private.social_kit_workspace_role(UUID,UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_social_brand_kit_link(p_auth_id TEXT, p_brand_id UUID, p_workspace_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_role TEXT;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u WHERE u.auth_id = p_auth_id AND u.deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    v_role := public.social_brand_role(p_auth_id, p_brand_id);
    IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
    IF v_role <> 'owner' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    IF p_workspace_id IS NULL THEN
        DELETE FROM public.social_brand_kit_links WHERE brand_id = p_brand_id;
        RETURN jsonb_build_object('ok',true,'linked',false);
    END IF;
    IF coalesce(private.social_kit_workspace_role(p_auth_id::UUID, p_workspace_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN
        RETURN jsonb_build_object('ok',false,'code','WORKSPACE_NOT_FOUND');
    END IF;
    INSERT INTO public.social_brand_kit_links(brand_id, workspace_id, linked_by)
    VALUES (p_brand_id, p_workspace_id, v_user)
    ON CONFLICT (brand_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, linked_by = EXCLUDED.linked_by, linked_at = now();
    RETURN jsonb_build_object('ok',true,'linked',true);
END $$;

CREATE OR REPLACE FUNCTION public.get_social_brand_kit(p_auth_id TEXT, p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role TEXT; v_link public.social_brand_kit_links; v_name TEXT; v_saved public.workspace_editor_brand_kits; v_can_link BOOLEAN;
BEGIN
    v_role := public.social_brand_role(p_auth_id, p_brand_id);
    IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
    v_can_link := v_role = 'owner';
    SELECT * INTO v_link FROM public.social_brand_kit_links WHERE brand_id = p_brand_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'linked',false,'canLink',v_can_link); END IF;
    SELECT w.name INTO v_name FROM public.workspaces w JOIN public.organisations o ON o.id = w.organisation_id
    WHERE w.id = v_link.workspace_id AND w.deleted_at IS NULL AND o.deleted_at IS NULL;
    IF v_name IS NULL THEN RETURN jsonb_build_object('ok',true,'linked',false,'stale',true,'canLink',v_can_link); END IF;
    SELECT * INTO v_saved FROM public.workspace_editor_brand_kits WHERE workspace_id = v_link.workspace_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok',true,'linked',true,'empty',true,'workspaceId',CASE WHEN v_can_link THEN v_link.workspace_id END,'workspaceName',v_name,'canLink',v_can_link);
    END IF;
    RETURN jsonb_build_object('ok',true,'linked',true,'empty',false,
        'workspaceId',CASE WHEN v_can_link THEN v_link.workspace_id END,'workspaceName',v_name,'canLink',v_can_link,'version',v_saved.version,
        'kit',jsonb_build_object(
            'name',v_saved.kit->'name','palette',v_saved.kit->'palette','fonts',v_saved.kit->'fonts','textStyles',v_saved.kit->'textStyles',
            'credits',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a->'name','credit',a->'credit','usage',a->'usage','url',a->'url'))
                FROM jsonb_array_elements(v_saved.kit->'assets') a),'[]'::jsonb)));
END $$;

REVOKE ALL ON FUNCTION public.set_social_brand_kit_link(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_social_brand_kit(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_social_brand_kit_link(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_social_brand_kit(TEXT,UUID) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
