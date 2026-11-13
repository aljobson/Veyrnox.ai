-- ADR-0339 (proposed): the first-run personal answers follow the account, like the first goal (0494, ADR-0336).
--
-- After the welcome screens the app asks up to three skippable questions: which describes you best (role), what to make
-- first (the existing goal) and where it will go (destination). Role and destination are one word each from a fixed list
-- (or "skipped"), stored beside the goal in public.first_goals. They only order and pre-fill screens; they never touch
-- credits, the ledger, prices or access.
--
-- Reached only through SECURITY DEFINER functions the Worker calls with the service role (the browser roles hold no grant):
--   get_first_answers(auth_id)                          goal, role, destination (null where never answered)
--   set_first_answers(auth_id, goal, role, destination) validate + upsert; a real answer is never lowered to "skipped"
-- The 0494 functions are left as they are. A row may now exist with only a role or destination, so goal becomes nullable
-- (null reads as "never chose", exactly like no row).
--
-- No new table: first_goals is already erased with the account (0494 trigger) and exported in the `profile` section. The
-- export wrapper from 0494 is replaced here to add the two new keys. Idempotent: ADD COLUMN IF NOT EXISTS, OR REPLACE,
-- REVOKE/GRANT re-run.

ALTER TABLE public.first_goals ALTER COLUMN goal DROP NOT NULL;
ALTER TABLE public.first_goals ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IS NULL OR role IN ('creator', 'business', 'pro', 'hobbyist', 'beginner', 'skipped'));
ALTER TABLE public.first_goals ADD COLUMN IF NOT EXISTS destination TEXT
    CHECK (destination IS NULL OR destination IN ('tiktok', 'reels', 'youtube', 'private', 'skipped'));

-- A real word outranks "skipped", so a stale device that skipped can never throw away a real choice.
CREATE OR REPLACE FUNCTION private.first_answer_rank(p_value TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT CASE WHEN p_value IS NULL THEN NULL WHEN p_value = 'skipped' THEN 1 ELSE 3 END $$;
REVOKE ALL ON FUNCTION private.first_answer_rank(TEXT) FROM PUBLIC, anon, authenticated;

-- ── Read ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_first_answers(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.first_goals%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    SELECT * INTO v_row FROM public.first_goals WHERE user_id = v_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'goal', NULL, 'role', NULL, 'destination', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'goal', v_row.goal, 'role', v_row.role, 'destination', v_row.destination);
END $$;
REVOKE ALL ON FUNCTION public.get_first_answers(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_first_answers(TEXT) TO service_role;

-- ── Save ─────────────────────────────────────────────────────────────────────
-- Any of the three may be sent; at least one must be. Each is checked against its own list. A word is replaced only by one
-- of equal or higher rank (goal keeps its 0494 ranks), so replaying the same body changes nothing and `changed` is false.
CREATE OR REPLACE FUNCTION public.set_first_answers(p_auth_id TEXT, p_goal TEXT, p_role TEXT, p_destination TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.first_goals%ROWTYPE;
    v_goal    TEXT;
    v_role    TEXT;
    v_dest    TEXT;
BEGIN
    IF p_goal IS NULL AND p_role IS NULL AND p_destination IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_answers');
    END IF;
    IF (p_goal IS NOT NULL AND private.first_goal_rank(p_goal) IS NULL)
       OR (p_role IS NOT NULL AND p_role NOT IN ('creator', 'business', 'pro', 'hobbyist', 'beginner', 'skipped'))
       OR (p_destination IS NOT NULL AND p_destination NOT IN ('tiktok', 'reels', 'youtube', 'private', 'skipped')) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_answers');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    SELECT * INTO v_row FROM public.first_goals WHERE user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.first_goals (user_id, goal, role, destination) VALUES (v_user_id, p_goal, p_role, p_destination);
        RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', p_goal, 'role', p_role, 'destination', p_destination);
    END IF;

    v_goal := v_row.goal; v_role := v_row.role; v_dest := v_row.destination;
    IF p_goal IS NOT NULL AND (v_goal IS NULL OR (p_goal <> v_goal AND private.first_goal_rank(p_goal) >= private.first_goal_rank(v_goal))) THEN
        v_goal := p_goal;
    END IF;
    IF p_role IS NOT NULL AND (v_role IS NULL OR (p_role <> v_role AND private.first_answer_rank(p_role) >= private.first_answer_rank(v_role))) THEN
        v_role := p_role;
    END IF;
    IF p_destination IS NOT NULL AND (v_dest IS NULL OR (p_destination <> v_dest AND private.first_answer_rank(p_destination) >= private.first_answer_rank(v_dest))) THEN
        v_dest := p_destination;
    END IF;

    IF v_goal IS NOT DISTINCT FROM v_row.goal AND v_role IS NOT DISTINCT FROM v_row.role AND v_dest IS NOT DISTINCT FROM v_row.destination THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'goal', v_goal, 'role', v_role, 'destination', v_dest);
    END IF;
    UPDATE public.first_goals SET goal = v_goal, role = v_role, destination = v_dest, updated_at = now() WHERE user_id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', v_goal, 'role', v_role, 'destination', v_dest);
END $$;
REVOKE ALL ON FUNCTION public.set_first_answers(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_answers(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── Privacy export (ADR-0250) ────────────────────────────────────────────────
-- 0494 made the previous export function a private helper and put a wrapper in front of it. This replaces that wrapper
-- (same signature, same helper) so the `first_goal` key also carries the role and the destination.
CREATE OR REPLACE FUNCTION public.read_privacy_export_page(
    p_auth_id TEXT, p_aal TEXT, p_export_id UUID, p_section TEXT,
    p_thread_id UUID, p_after TEXT, p_key TEXT, p_page_size INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result JSONB;
    goal   JSONB;
BEGIN
    result := private.read_privacy_export_page_without_first_goal(
        p_auth_id, p_aal, p_export_id, p_section, p_thread_id, p_after, p_key, p_page_size);
    IF p_section = 'profile' AND result->>'ok' = 'true' THEN
        SELECT jsonb_build_object('goal', g.goal, 'role', g.role, 'destination', g.destination,
                                  'created_at', g.created_at, 'updated_at', g.updated_at) INTO goal
          FROM public.first_goals g
          JOIN public.users u ON u.id = g.user_id AND u.auth_id = p_auth_id AND u.deleted_at IS NULL
          JOIN public.privacy_export_requests r ON r.id = p_export_id AND r.user_id = u.id
         WHERE g.created_at <= r.as_of;
        result := jsonb_set(result, '{rows,0,first_goal}', COALESCE(goal, 'null'::jsonb), true);
    END IF;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    TO service_role;
