-- ADR-0135: a person blocks another Cinema member (Apple App Review 1.2).
--
-- A block hides the blocked member's comments from the blocker. The signed-in titles route also
-- drops that member's titles (lib/cinema/titlesApi.js). Nothing here touches ledger_entries or
-- credit_balances. The only writers are block_cinema_user / unblock_cinema_user.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT re-run. Replaying a block or an unblock
-- is a no-op that says so.

CREATE TABLE IF NOT EXISTS public.user_blocks (
    blocker_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    blocked_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks FORCE ROW LEVEL SECURITY;
-- No policy and no grant: deny by default. The functions below are the whole surface.
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated, service_role;

-- A person holds at most 500 blocks (block_limit).
CREATE OR REPLACE FUNCTION public.block_cinema_user(p_auth_id TEXT, p_username TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID; v_target UUID; v_rows INTEGER;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error', 'account_not_found'); END IF;
    IF p_username IS NULL OR p_username !~ '^[a-z][a-z0-9_]{2,29}$' THEN RETURN jsonb_build_object('error', 'invalid_username'); END IF;
    SELECT p.user_id INTO v_target FROM public.cinema_profiles p
    JOIN public.users u ON u.id = p.user_id WHERE p.username = p_username AND u.deleted_at IS NULL;
    IF v_target IS NULL THEN RETURN jsonb_build_object('error', 'user_not_found'); END IF;
    IF v_target = v_me THEN RETURN jsonb_build_object('error', 'cannot_block_self'); END IF;
    PERFORM pg_advisory_xact_lock(353, hashtext(v_me::text));
    IF NOT EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_target)
       AND (SELECT count(*) FROM public.user_blocks WHERE blocker_id = v_me) >= 500 THEN
        RETURN jsonb_build_object('error', 'block_limit');
    END IF;
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_me, v_target) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'username', p_username, 'already', v_rows = 0);
END $$;

CREATE OR REPLACE FUNCTION public.unblock_cinema_user(p_auth_id TEXT, p_username TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID; v_target UUID; v_rows INTEGER;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error', 'account_not_found'); END IF;
    IF p_username IS NULL OR p_username !~ '^[a-z][a-z0-9_]{2,29}$' THEN RETURN jsonb_build_object('error', 'invalid_username'); END IF;
    SELECT user_id INTO v_target FROM public.cinema_profiles WHERE username = p_username;
    IF v_target IS NULL THEN RETURN jsonb_build_object('ok', true, 'username', p_username, 'already', true); END IF;
    DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_target;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'username', p_username, 'already', v_rows = 0);
END $$;

CREATE OR REPLACE FUNCTION public.list_blocked_cinema_users(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID;
BEGIN
    SELECT id INTO v_me FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_me IS NULL THEN RETURN jsonb_build_object('error', 'account_not_found'); END IF;
    RETURN jsonb_build_object('ok', true, 'blocks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('username', p.username, 'display_name', p.display_name, 'created_at', b.created_at)
                         ORDER BY b.created_at DESC, p.username)
        FROM public.user_blocks b JOIN public.cinema_profiles p ON p.user_id = b.blocked_id
        WHERE b.blocker_id = v_me), '[]'::jsonb));
END $$;

-- ── Comments: a blocker no longer receives the blocked member's comments ──────
-- Same body as 0267 plus one predicate. A reader with no account (p_auth_id NULL) has no blocks.
CREATE OR REPLACE FUNCTION public.read_cinema_comments(p_auth_id TEXT,p_content_id UUID,p_before_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_before TIMESTAMPTZ; v_items JSONB; v_own JSONB; v_next UUID;
BEGIN
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 IF p_auth_id IS NOT NULL THEN v_actor:=public.cinema_community_actor(p_auth_id); IF v_actor IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF; END IF;
 IF p_before_id IS NOT NULL THEN
  SELECT created_at INTO v_before FROM public.cinema_comments WHERE id=p_before_id AND content_id=p_content_id AND status='approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_cursor'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]') INTO v_items FROM (
  SELECT c.created_at,c.id,jsonb_build_object('id',c.id,'body',c.body,'created_at',c.created_at,'username',p.username,'display_name',p.display_name,'own',c.author_id=v_actor) AS item
  FROM public.cinema_comments c JOIN public.cinema_profiles p ON p.user_id=c.author_id JOIN public.users u ON u.id=c.author_id
  JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
  WHERE c.content_id=p_content_id AND c.status='approved' AND m.account_status='active' AND u.frozen_at IS NULL
   AND (v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.blocker_id=v_actor AND b.blocked_id=c.author_id))
   AND (v_before IS NULL OR (c.created_at,c.id)<(v_before,p_before_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT 26
 ) x;
 IF jsonb_array_length(v_items)>25 THEN v_next:=(v_items->24->>'id')::uuid; v_items:=v_items-25; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC,id DESC),'[]') INTO v_own FROM (
  SELECT id,body,status,created_at FROM public.cinema_comments WHERE author_id=v_actor AND content_id=p_content_id AND status<>'approved' ORDER BY created_at DESC,id DESC LIMIT 25
 ) x;
 RETURN jsonb_build_object('comments',v_items,'own_comments',v_own,'next_cursor',v_next);
END $$;

-- ── Account deletion hook (ADR-0111) ─────────────────────────────────────────
-- A tombstoned account keeps no blocks, its own or against it.
CREATE OR REPLACE FUNCTION private.blocks_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.user_blocks WHERE blocker_id = NEW.id OR blocked_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.blocks_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_blocks_forget_erased ON public.users;
CREATE TRIGGER users_blocks_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.blocks_forget_erased_user();

REVOKE ALL ON FUNCTION public.block_cinema_user(TEXT, TEXT), public.unblock_cinema_user(TEXT, TEXT),
    public.list_blocked_cinema_users(TEXT), public.read_cinema_comments(TEXT, UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_cinema_user(TEXT, TEXT), public.unblock_cinema_user(TEXT, TEXT),
    public.list_blocked_cinema_users(TEXT), public.read_cinema_comments(TEXT, UUID, UUID)
    TO service_role;
NOTIFY pgrst, 'reload schema';
