-- ADR-0336 (proposed): the first-goal answer follows the person, not the device.
--
-- The Create screens ask "What do you want to make first?" once. Slice 1 kept the answer on the device; this keeps one
-- small answer per account so a second device, a second account on one phone and the web all agree. The value is one
-- word from a fixed list. It orders nothing and prices nothing; it never touches credits, the ledger or pricing.
--
-- Reached only through SECURITY DEFINER functions the Worker calls with the service role (the browser roles hold no grant):
--   get_first_goal(auth_id)        the stored answer, or none
--   set_first_goal(auth_id, goal)  validate + upsert; an answer is never lowered (see private.first_goal_rank)
--
-- Account deletion (ADR-0111): erase_account sets users.deleted_at; the trigger at the bottom removes the row in that
-- same transaction. The privacy export (ADR-0250) gains `first_goal` in the `profile` section through one more wrapper
-- over the existing function; nothing else about the export changes.
-- Idempotent: IF NOT EXISTS, OR REPLACE, DROP TRIGGER IF EXISTS, REVOKE/GRANT re-run, the export rename is guarded.

CREATE TABLE IF NOT EXISTS public.first_goals (
    user_id    UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    goal       TEXT        NOT NULL CHECK (goal IN ('image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.first_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_goals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_goals FROM PUBLIC, anon, authenticated, service_role;

-- A real goal outranks "not sure", which outranks "skipped". An answer is only ever replaced by one of equal or higher
-- rank, so a stale device that still thinks nothing was chosen can never throw away a real choice.
CREATE OR REPLACE FUNCTION private.first_goal_rank(p_goal TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_goal
        WHEN 'image' THEN 3 WHEN 'video' THEN 3 WHEN 'audio' THEN 3 WHEN 'edit' THEN 3 WHEN 'publish' THEN 3
        WHEN 'unsure' THEN 2
        WHEN 'skipped' THEN 1
        ELSE NULL
    END
$$;
REVOKE ALL ON FUNCTION private.first_goal_rank(TEXT) FROM PUBLIC, anon, authenticated;

-- ── Read ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_first_goal(p_auth_id TEXT)
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
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'goal', NULL); END IF;
    RETURN jsonb_build_object('ok', true, 'goal', v_row.goal, 'updated_at', v_row.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.get_first_goal(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_first_goal(TEXT) TO service_role;

-- ── Save ─────────────────────────────────────────────────────────────────────
-- Replaying the same answer changes nothing (`changed` false, updated_at untouched). A lower-ranked answer than the one
-- stored is ignored and the stored one is returned, so the caller can show what the account really holds.
CREATE OR REPLACE FUNCTION public.set_first_goal(p_auth_id TEXT, p_goal TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.first_goals%ROWTYPE;
BEGIN
    IF p_goal IS NULL OR private.first_goal_rank(p_goal) IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_goal');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    SELECT * INTO v_row FROM public.first_goals WHERE user_id = v_user_id FOR UPDATE;
    IF FOUND AND (v_row.goal = p_goal OR private.first_goal_rank(p_goal) < private.first_goal_rank(v_row.goal)) THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'goal', v_row.goal);
    END IF;

    INSERT INTO public.first_goals (user_id, goal) VALUES (v_user_id, p_goal)
    ON CONFLICT (user_id) DO UPDATE SET goal = EXCLUDED.goal, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', p_goal);
END $$;
REVOKE ALL ON FUNCTION public.set_first_goal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_goal(TEXT, TEXT) TO service_role;

-- ── Account deletion hook (ADR-0111) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.first_goal_forget_erased_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.first_goals WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.first_goal_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_first_goal_forget_erased ON public.users;
CREATE TRIGGER users_first_goal_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.first_goal_forget_erased_user();

-- ── Admin telemetry allowlist (0431, 0455, 0493) ─────────────────────────────
-- The new route /api/v1/first-goal is a normalized path the admin telemetry may name. Same wrapper as 0493: the current
-- function is renamed (keeping its revoked ACL) and a new one admits this route, then defers to the old one.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0494(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0494;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/api/v1/first-goal'
        OR public.telemetry_path_allowed_pre_0494(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

-- ── Privacy export (ADR-0250) ────────────────────────────────────────────────
-- Same approach as 0390: the current public function becomes a private, uncallable helper and a thin public wrapper adds
-- one key to the `profile` row. The projection is bounded by the request's as_of like every other key.
DO $$
BEGIN
    IF to_regprocedure('private.read_privacy_export_page_without_first_goal(text,text,uuid,text,uuid,text,text,integer)') IS NULL THEN
        ALTER FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            SET SCHEMA private;
        ALTER FUNCTION private.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            RENAME TO read_privacy_export_page_without_first_goal;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.read_privacy_export_page_without_first_goal(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;

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
        SELECT jsonb_build_object('goal', g.goal, 'created_at', g.created_at, 'updated_at', g.updated_at) INTO goal
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
