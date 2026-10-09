-- Chat Personas (ADR-0072, accepted 2026-10-05): a saved, named set of instructions plus a default model and options, that can start any chat.
-- A persona is that and nothing else: no files, no tools, no memory, and it never changes a chat that already exists (starting a chat from a
-- persona copies its instructions onto the new chat). Nothing about a persona is priced: a reply costs what it costs today. A person can have
-- twenty, with names unique ignoring case. Like the chat and folder tables, this one is reachable only through the definer functions below,
-- keyed by the verified auth id, and it goes with the account (ON DELETE CASCADE). Behind PERSONAS_ENABLED in the Worker.
--
-- default_model_id is optional: when the model is later retired the persona keeps working with the person's own pick (SET NULL).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming each full signature.

CREATE TABLE IF NOT EXISTS public.chat_personas (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    instructions     TEXT        NOT NULL CHECK (length(instructions) BETWEEN 1 AND 4000),
    default_model_id TEXT        REFERENCES public.model_catalog(id) ON DELETE SET NULL,
    thinking         BOOLEAN     NOT NULL DEFAULT false,
    web              BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_personas_user_name_idx ON public.chat_personas(user_id, lower(name));
CREATE INDEX IF NOT EXISTS chat_personas_model_idx ON public.chat_personas(default_model_id) WHERE default_model_id IS NOT NULL;

ALTER TABLE public.chat_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_personas FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_personas FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_list_personas(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'personas', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'instructions', p.instructions,
        'model_id', p.default_model_id, 'thinking', p.thinking, 'web', p.web) ORDER BY lower(p.name), p.id), '[]'::jsonb)
    INTO v_rows FROM public.chat_personas p WHERE p.user_id = v_user;
    RETURN jsonb_build_object('ok', true, 'personas', v_rows);
END $$;

-- p_persona_id NULL makes a new persona, otherwise it changes that one (the caller's own only).
CREATE OR REPLACE FUNCTION public.chat_save_persona(p_auth_id TEXT, p_persona_id UUID, p_name TEXT, p_instructions TEXT,
                                                    p_model_id TEXT, p_thinking BOOLEAN, p_web BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_name TEXT := btrim(p_name); v_text TEXT := btrim(p_instructions); v_row public.chat_personas%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF p_persona_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_personas WHERE id = p_persona_id AND user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PERSONA_NOT_FOUND');
    END IF;
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 60 OR v_text IS NULL OR length(v_text) NOT BETWEEN 1 AND 4000
       OR p_thinking IS NULL OR p_web IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;
    IF p_model_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.model_catalog WHERE id = p_model_id AND active AND modality = 'text') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_NOT_FOUND');
    END IF;
    IF p_persona_id IS NULL AND (SELECT count(*) FROM public.chat_personas WHERE user_id = v_user) >= 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PERSONA_LIMIT');
    END IF;
    BEGIN
        IF p_persona_id IS NULL THEN
            INSERT INTO public.chat_personas (user_id, name, instructions, default_model_id, thinking, web)
            VALUES (v_user, v_name, v_text, p_model_id, p_thinking, p_web) RETURNING * INTO v_row;
        ELSE
            UPDATE public.chat_personas SET name = v_name, instructions = v_text, default_model_id = p_model_id,
                   thinking = p_thinking, web = p_web, updated_at = now()
             WHERE id = p_persona_id AND user_id = v_user RETURNING * INTO v_row;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PERSONA_EXISTS');
    END;
    RETURN jsonb_build_object('ok', true, 'persona', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'instructions', v_row.instructions,
        'model_id', v_row.default_model_id, 'thinking', v_row.thinking, 'web', v_row.web));
END $$;

CREATE OR REPLACE FUNCTION public.chat_delete_persona(p_auth_id TEXT, p_persona_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_n INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    DELETE FROM public.chat_personas WHERE id = p_persona_id AND user_id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_user IS NULL OR v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'PERSONA_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.chat_list_personas(TEXT)                                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_save_persona(TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_delete_persona(TEXT, UUID)                                       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_list_personas(TEXT)                                           TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_save_persona(TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)  TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_delete_persona(TEXT, UUID)                                    TO service_role;
