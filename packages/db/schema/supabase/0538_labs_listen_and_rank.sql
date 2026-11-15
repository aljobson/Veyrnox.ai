-- 0538: Labs listen-and-rank WITHOUT rewards (proposal #2273, decisions L2 and L4).
--
-- A signed-in listener hears two published tracks and picks the one they like
-- more. No credits move: there is no ledger write anywhere here (decision L3,
-- paid ranking, waits for an ADR).
--
-- Only tracks whose creator opted in can be ranked: music_publications gains
-- allow_ranking, false by default, set only by the creator through
-- music_set_publication_ranking (music_publish_song is unchanged).
--
-- labs_rank_pairs holds each pair issued to a listener and, once answered, the
-- vote. One vote per pair: answering again with the same choice is a no-op,
-- another choice is refused. A vote counts only 10 seconds to 1 hour after the
-- pair was issued, and a listener gets at most 200 pairs a day. The listener's
-- own tracks and creators they blocked are never paired. Rows are erased with
-- the account. Ranking data stays inside Veyrnox (decision L5).
-- Off until MUSIC_RUNTIME_FLAGS ranking is true.

ALTER TABLE public.music_publications ADD COLUMN IF NOT EXISTS allow_ranking BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS music_publications_rankable_idx
    ON public.music_publications(published_at DESC) WHERE status = 'published' AND allow_ranking;

CREATE TABLE IF NOT EXISTS public.labs_rank_pairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    a_publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    b_publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    winner TEXT NULL CHECK (winner IS NULL OR winner IN ('a', 'b')),
    voted_at TIMESTAMPTZ NULL,
    CHECK (a_publication_id <> b_publication_id),
    CHECK ((winner IS NULL) = (voted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS labs_rank_pairs_user_idx ON public.labs_rank_pairs(user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS labs_rank_pairs_a_idx ON public.labs_rank_pairs(a_publication_id);
CREATE INDEX IF NOT EXISTS labs_rank_pairs_b_idx ON public.labs_rank_pairs(b_publication_id);
ALTER TABLE public.labs_rank_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labs_rank_pairs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.labs_rank_pairs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.labs_rank_pairs TO service_role;
DROP POLICY IF EXISTS labs_rank_pairs_service_all ON public.labs_rank_pairs;
CREATE POLICY labs_rank_pairs_service_all ON public.labs_rank_pairs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The creator's switch for one of their own live publications.
CREATE OR REPLACE FUNCTION public.music_set_publication_ranking(p_auth_id TEXT, p_song_id UUID, p_allow BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_count INTEGER;
BEGIN
    IF p_song_id IS NULL OR p_allow IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    UPDATE public.music_publications SET allow_ranking = p_allow, updated_at = now()
     WHERE song_id = p_song_id AND user_id = v_user AND status = 'published';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'allow_ranking', p_allow);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_publication_ranking(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce((SELECT jsonb_build_object('ok', true, 'allow_ranking', p.allow_ranking)
        FROM public.music_publications p JOIN public.users u ON u.id = p.user_id
        WHERE u.auth_id = p_auth_id AND u.deleted_at IS NULL AND p.song_id = p_song_id AND p.status = 'published'),
        jsonb_build_object('ok', false, 'code', 'NOT_FOUND'));
$$;

-- A new pair of two other creators' opted-in tracks, from the 200 newest.
CREATE OR REPLACE FUNCTION public.labs_rank_next_pair(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_ids UUID[]; v_a public.music_publications%ROWTYPE; v_b public.music_publications%ROWTYPE; v_id UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF (SELECT count(*) FROM public.labs_rank_pairs WHERE user_id = v_user AND issued_at > now() - interval '24 hours') >= 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 3600);
    END IF;
    SELECT array_agg(x.id) INTO v_ids FROM (
        SELECT p.id FROM (
            SELECT * FROM public.music_publications
             WHERE status = 'published' AND allow_ranking AND user_id <> v_user
             ORDER BY published_at DESC LIMIT 200) p
        JOIN public.music_songs s ON s.id = p.song_id AND s.user_id = p.user_id AND s.status = 'active'
        WHERE NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = v_user AND b.blocked_id = p.user_id)
        ORDER BY random() LIMIT 2) x;
    IF coalesce(cardinality(v_ids), 0) < 2 THEN RETURN jsonb_build_object('ok', true, 'pair', NULL); END IF;
    SELECT * INTO v_a FROM public.music_publications WHERE id = v_ids[1];
    SELECT * INTO v_b FROM public.music_publications WHERE id = v_ids[2];
    IF v_a.id IS NULL OR v_b.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'pair', NULL); END IF;
    INSERT INTO public.labs_rank_pairs(user_id, a_publication_id, b_publication_id) VALUES (v_user, v_a.id, v_b.id) RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'pair', jsonb_build_object('id', v_id,
        'a', (SELECT jsonb_build_object('slug', v_a.slug, 'title', s.title) FROM public.music_songs s WHERE s.id = v_a.song_id),
        'b', (SELECT jsonb_build_object('slug', v_b.slug, 'title', s.title) FROM public.music_songs s WHERE s.id = v_b.song_id)));
END $$;

CREATE OR REPLACE FUNCTION public.labs_rank_vote(p_auth_id TEXT, p_pair_id UUID, p_winner TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_pair public.labs_rank_pairs%ROWTYPE;
BEGIN
    IF p_pair_id IS NULL OR p_winner IS NULL OR p_winner NOT IN ('a', 'b') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_pair FROM public.labs_rank_pairs WHERE id = p_pair_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_pair.winner IS NOT NULL THEN
        IF v_pair.winner = p_winner THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REVIEWED');
    END IF;
    IF now() < v_pair.issued_at + interval '10 seconds' THEN RETURN jsonb_build_object('ok', false, 'code', 'TOO_SOON'); END IF;
    IF now() > v_pair.issued_at + interval '1 hour' THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED'); END IF;
    UPDATE public.labs_rank_pairs SET winner = p_winner, voted_at = now() WHERE id = v_pair.id;
    RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION private.labs_rank_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.labs_rank_pairs WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.labs_rank_forget_erased_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_labs_rank_forget_erased ON public.users;
CREATE TRIGGER users_labs_rank_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.labs_rank_forget_erased_user();

DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0538(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0538;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/labs-rank')
        OR public.telemetry_path_allowed_pre_0538(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.music_set_publication_ranking(TEXT,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_get_publication_ranking(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_publication_ranking(TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.labs_rank_next_pair(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.labs_rank_vote(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_set_publication_ranking(TEXT,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.labs_rank_next_pair(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.labs_rank_vote(TEXT,UUID,TEXT) TO service_role;
