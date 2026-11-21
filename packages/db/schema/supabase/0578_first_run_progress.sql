-- ADR-0339 amendment: first-run progress follows the account as well as the three fixed-word answers.
--
-- Version 0 is a grandfathered, completed legacy answer. Version 1 is the resumable journey:
-- goal -> destination -> role -> recap -> complete. A skipped goal takes the short path after role.
-- Existing goal-only rows are deliberately grandfathered because they cannot be distinguished from ADR-0336 users.
-- Existing rows that contain a role or destination but are missing another answer are resumable partial journeys.
--
-- Old clients and the 0494/0499 RPC signatures remain valid. New clients use set_first_onboarding; old writes update
-- progress only when they touch an existing version-1 journey. No answer values are logged or added to telemetry.

ALTER TABLE public.first_goals ADD COLUMN IF NOT EXISTS onboarding_version SMALLINT;
ALTER TABLE public.first_goals ADD COLUMN IF NOT EXISTS onboarding_current_step TEXT;
ALTER TABLE public.first_goals ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN;

UPDATE public.first_goals
   SET onboarding_version = CASE
           WHEN goal IS NOT NULL AND role IS NULL AND destination IS NULL THEN 0
           ELSE 1
       END,
       onboarding_completed = CASE
           WHEN goal IS NOT NULL AND role IS NULL AND destination IS NULL THEN true
           WHEN goal IS NOT NULL AND role IS NOT NULL AND destination IS NOT NULL THEN true
           ELSE false
       END,
       onboarding_current_step = CASE
           WHEN goal IS NOT NULL AND role IS NULL AND destination IS NULL THEN NULL
           WHEN goal IS NOT NULL AND role IS NOT NULL AND destination IS NOT NULL THEN NULL
           WHEN goal IS NULL THEN 'goal'
           WHEN destination IS NULL THEN 'destination'
           ELSE 'role'
       END
 WHERE onboarding_version IS NULL AND onboarding_completed IS NULL;

ALTER TABLE public.first_goals ALTER COLUMN onboarding_version SET DEFAULT 0;
ALTER TABLE public.first_goals ALTER COLUMN onboarding_version SET NOT NULL;
ALTER TABLE public.first_goals ALTER COLUMN onboarding_completed SET DEFAULT true;
ALTER TABLE public.first_goals ALTER COLUMN onboarding_completed SET NOT NULL;

ALTER TABLE public.first_goals DROP CONSTRAINT IF EXISTS first_goals_onboarding_state_check;
ALTER TABLE public.first_goals ADD CONSTRAINT first_goals_onboarding_state_check CHECK (
    (onboarding_version = 0 AND onboarding_completed AND onboarding_current_step IS NULL)
    OR
    (onboarding_version = 1 AND (
        (onboarding_completed AND onboarding_current_step IS NULL)
        OR
        (NOT onboarding_completed AND onboarding_current_step IS NOT NULL
            AND onboarding_current_step IN ('goal', 'destination', 'role', 'recap'))
    ))
);

CREATE OR REPLACE FUNCTION private.first_onboarding_next(p_goal TEXT, p_role TEXT, p_destination TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_goal IS NULL THEN 'goal'
        WHEN p_destination IS NULL THEN 'destination'
        WHEN p_role IS NULL THEN 'role'
        WHEN p_goal = 'skipped' THEN NULL
        ELSE 'recap'
    END
$$;
REVOKE ALL ON FUNCTION private.first_onboarding_next(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

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
        RETURN jsonb_build_object(
            'ok', true, 'goal', NULL, 'role', NULL, 'destination', NULL,
            'version', 1, 'current_step', 'goal', 'completed', false);
    END IF;
    RETURN jsonb_build_object(
        'ok', true, 'goal', v_row.goal, 'role', v_row.role, 'destination', v_row.destination,
        'version', v_row.onboarding_version, 'current_step', v_row.onboarding_current_step,
        'completed', v_row.onboarding_completed);
END $$;
REVOKE ALL ON FUNCTION public.get_first_answers(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_first_answers(TEXT) TO service_role;

-- One version-1 transition. current_step is the screen the caller answered, not a client-selected next screen.
CREATE OR REPLACE FUNCTION public.set_first_onboarding(
    p_auth_id TEXT, p_version SMALLINT, p_current_step TEXT, p_completed BOOLEAN,
    p_goal TEXT, p_role TEXT, p_destination TEXT
)
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
    v_step    TEXT;
    v_done    BOOLEAN;
    v_changed BOOLEAN := false;
    v_finish  BOOLEAN := p_completed IS TRUE;
BEGIN
    IF p_version IS DISTINCT FROM 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'onboarding_version_unsupported');
    END IF;
    IF v_finish THEN
        IF p_current_step IS DISTINCT FROM 'recap'
           OR p_goal IS NOT NULL OR p_role IS NOT NULL OR p_destination IS NOT NULL THEN
            RETURN jsonb_build_object('ok', false, 'error', 'invalid_onboarding');
        END IF;
    ELSE
        IF p_completed IS DISTINCT FROM false OR p_current_step IS NULL OR p_current_step NOT IN ('goal', 'destination', 'role')
           OR (p_current_step = 'goal' AND (p_goal IS NULL OR p_role IS NOT NULL OR p_destination IS NOT NULL))
           OR (p_current_step = 'destination' AND (p_destination IS NULL OR p_goal IS NOT NULL OR p_role IS NOT NULL))
           OR (p_current_step = 'role' AND (p_role IS NULL OR p_goal IS NOT NULL OR p_destination IS NOT NULL)) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'invalid_onboarding');
        END IF;
        IF (p_goal IS NOT NULL AND private.first_goal_rank(p_goal) IS NULL)
           OR (p_role IS NOT NULL AND p_role NOT IN ('creator', 'business', 'pro', 'hobbyist', 'beginner', 'skipped'))
           OR (p_destination IS NOT NULL AND p_destination NOT IN ('tiktok', 'reels', 'youtube', 'private', 'skipped')) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'invalid_onboarding');
        END IF;
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    SELECT * INTO v_row FROM public.first_goals WHERE user_id = v_user_id FOR UPDATE;

    IF NOT FOUND THEN
        IF v_finish THEN
            RETURN jsonb_build_object(
                'ok', false, 'error', 'onboarding_incomplete', 'goal', NULL, 'role', NULL, 'destination', NULL,
                'version', 1, 'current_step', 'goal', 'completed', false);
        END IF;
        v_goal := p_goal; v_role := p_role; v_dest := p_destination;
        v_step := private.first_onboarding_next(v_goal, v_role, v_dest);
        v_done := v_step IS NULL;
        INSERT INTO public.first_goals (
            user_id, goal, role, destination, onboarding_version, onboarding_current_step, onboarding_completed)
        VALUES (v_user_id, v_goal, v_role, v_dest, 1, v_step, v_done);
        RETURN jsonb_build_object(
            'ok', true, 'changed', true, 'goal', v_goal, 'role', v_role, 'destination', v_dest,
            'version', 1, 'current_step', v_step, 'completed', v_done);
    END IF;

    v_goal := v_row.goal; v_role := v_row.role; v_dest := v_row.destination;
    IF v_finish THEN
        IF v_row.onboarding_completed THEN
            RETURN jsonb_build_object(
                'ok', true, 'changed', false, 'goal', v_goal, 'role', v_role, 'destination', v_dest,
                'version', v_row.onboarding_version, 'current_step', v_row.onboarding_current_step,
                'completed', v_row.onboarding_completed);
        END IF;
        IF v_goal IS NULL OR v_role IS NULL OR v_dest IS NULL OR v_goal = 'skipped' THEN
            RETURN jsonb_build_object(
                'ok', false, 'error', 'onboarding_incomplete', 'goal', v_goal, 'role', v_role, 'destination', v_dest,
                'version', v_row.onboarding_version,
                'current_step', private.first_onboarding_next(v_goal, v_role, v_dest), 'completed', false);
        END IF;
        UPDATE public.first_goals
           SET onboarding_version = 1, onboarding_current_step = NULL, onboarding_completed = true, updated_at = now()
         WHERE user_id = v_user_id;
        RETURN jsonb_build_object(
            'ok', true, 'changed', true, 'goal', v_goal, 'role', v_role, 'destination', v_dest,
            'version', 1, 'current_step', NULL, 'completed', true);
    END IF;

    IF p_goal IS NOT NULL AND (v_goal IS NULL OR (p_goal <> v_goal AND private.first_goal_rank(p_goal) >= private.first_goal_rank(v_goal))) THEN
        v_goal := p_goal;
    END IF;
    IF p_role IS NOT NULL AND (v_role IS NULL OR (p_role <> v_role AND private.first_answer_rank(p_role) >= private.first_answer_rank(v_role))) THEN
        v_role := p_role;
    END IF;
    IF p_destination IS NOT NULL AND (v_dest IS NULL OR (p_destination <> v_dest AND private.first_answer_rank(p_destination) >= private.first_answer_rank(v_dest))) THEN
        v_dest := p_destination;
    END IF;

    IF v_row.onboarding_completed THEN
        v_step := v_row.onboarding_current_step;
        v_done := true;
    ELSE
        v_step := private.first_onboarding_next(v_goal, v_role, v_dest);
        v_done := v_step IS NULL;
    END IF;
    v_changed := v_goal IS DISTINCT FROM v_row.goal OR v_role IS DISTINCT FROM v_row.role
        OR v_dest IS DISTINCT FROM v_row.destination OR v_step IS DISTINCT FROM v_row.onboarding_current_step
        OR v_done IS DISTINCT FROM v_row.onboarding_completed OR v_row.onboarding_version <> 1;
    IF v_changed THEN
        UPDATE public.first_goals
           SET goal = v_goal, role = v_role, destination = v_dest, onboarding_version = 1,
               onboarding_current_step = v_step, onboarding_completed = v_done, updated_at = now()
         WHERE user_id = v_user_id;
    END IF;
    RETURN jsonb_build_object(
        'ok', true, 'changed', v_changed, 'goal', v_goal, 'role', v_role, 'destination', v_dest,
        'version', 1, 'current_step', v_step, 'completed', v_done);
END $$;
REVOKE ALL ON FUNCTION public.set_first_onboarding(TEXT, SMALLINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_onboarding(TEXT, SMALLINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT)
    TO service_role;

-- Old goal-only clients stay compatible. On an existing V1 row their answer also advances its derived state.
CREATE OR REPLACE FUNCTION public.set_first_goal(p_auth_id TEXT, p_goal TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.first_goals%ROWTYPE;
    v_step    TEXT;
    v_done    BOOLEAN;
BEGIN
    IF p_goal IS NULL OR private.first_goal_rank(p_goal) IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_goal');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    SELECT * INTO v_row FROM public.first_goals WHERE user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.first_goals (user_id, goal) VALUES (v_user_id, p_goal);
        RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', p_goal);
    END IF;
    IF v_row.goal = p_goal OR private.first_goal_rank(p_goal) < private.first_goal_rank(v_row.goal) THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'goal', v_row.goal);
    END IF;
    v_step := v_row.onboarding_current_step; v_done := v_row.onboarding_completed;
    IF v_row.onboarding_version = 1 AND NOT v_done THEN
        v_step := private.first_onboarding_next(p_goal, v_row.role, v_row.destination);
        v_done := v_step IS NULL;
    END IF;
    UPDATE public.first_goals
       SET goal = p_goal, onboarding_current_step = v_step, onboarding_completed = v_done, updated_at = now()
     WHERE user_id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', p_goal);
END $$;
REVOKE ALL ON FUNCTION public.set_first_goal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_goal(TEXT, TEXT) TO service_role;

-- Old multi-answer clients likewise preserve their wire contract while advancing an existing V1 journey.
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
    v_step    TEXT;
    v_done    BOOLEAN;
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
    IF p_goal IS NOT NULL AND (v_goal IS NULL OR (p_goal <> v_goal AND private.first_goal_rank(p_goal) >= private.first_goal_rank(v_goal))) THEN v_goal := p_goal; END IF;
    IF p_role IS NOT NULL AND (v_role IS NULL OR (p_role <> v_role AND private.first_answer_rank(p_role) >= private.first_answer_rank(v_role))) THEN v_role := p_role; END IF;
    IF p_destination IS NOT NULL AND (v_dest IS NULL OR (p_destination <> v_dest AND private.first_answer_rank(p_destination) >= private.first_answer_rank(v_dest))) THEN v_dest := p_destination; END IF;
    v_step := v_row.onboarding_current_step; v_done := v_row.onboarding_completed;
    IF v_row.onboarding_version = 1 AND NOT v_done THEN
        v_step := private.first_onboarding_next(v_goal, v_role, v_dest);
        v_done := v_step IS NULL;
    END IF;
    IF v_goal IS NOT DISTINCT FROM v_row.goal AND v_role IS NOT DISTINCT FROM v_row.role
       AND v_dest IS NOT DISTINCT FROM v_row.destination AND v_step IS NOT DISTINCT FROM v_row.onboarding_current_step
       AND v_done IS NOT DISTINCT FROM v_row.onboarding_completed THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'goal', v_goal, 'role', v_role, 'destination', v_dest);
    END IF;
    UPDATE public.first_goals
       SET goal = v_goal, role = v_role, destination = v_dest,
           onboarding_current_step = v_step, onboarding_completed = v_done, updated_at = now()
     WHERE user_id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'changed', true, 'goal', v_goal, 'role', v_role, 'destination', v_dest);
END $$;
REVOKE ALL ON FUNCTION public.set_first_answers(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_answers(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Preserve the complete export wrapper chain (library favourites, drafts and later profile additions), then replace only
-- the first_goal projection with the same answers plus the three progress fields.
DO $$
BEGIN
    IF to_regprocedure('private.read_privacy_export_page_without_first_run_progress(text,text,uuid,text,uuid,text,text,integer)') IS NULL THEN
        ALTER FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            SET SCHEMA private;
        ALTER FUNCTION private.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            RENAME TO read_privacy_export_page_without_first_run_progress;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.read_privacy_export_page_without_first_run_progress(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
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
    result := private.read_privacy_export_page_without_first_run_progress(
        p_auth_id, p_aal, p_export_id, p_section, p_thread_id, p_after, p_key, p_page_size);
    IF p_section = 'profile' AND result->>'ok' = 'true' THEN
        SELECT jsonb_build_object(
                   'goal', g.goal, 'role', g.role, 'destination', g.destination,
                   'version', g.onboarding_version, 'current_step', g.onboarding_current_step,
                   'completed', g.onboarding_completed,
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
