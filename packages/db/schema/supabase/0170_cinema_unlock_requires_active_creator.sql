-- 0170: a suspended creator's titles cannot be unlocked or played
-- (docs/product/ISSUES.md S7).
--
-- The public catalogue hides a title whose creator's cinema_memberships
-- row is not 'active' (read_public_cinema_title and the list functions,
-- 0149/0163). cinema_unlock_price (0142) only checked that the title was
-- PUBLISHED and PUBLIC, so a restricted, suspended or banned creator's
-- title could still be unlocked by id, charging Credits, and played.
--
-- cinema_unlock_price now returns NULL for such a title. Every caller —
-- unlock_cinema_content, both cinema_entitlement versions,
-- read_cinema_playback through the entitlement, and record_cinema_pass_play
-- — already treats NULL as content_not_found: no debit, no entitlement, no
-- Pass play. Reinstating the creator restores access to existing unlocks;
-- an operator can refund them with reverse_cinema_unlocks meanwhile.
--
-- 0142 body plus the creator check; grants unchanged (internal).

CREATE OR REPLACE FUNCTION public.cinema_unlock_price(p_content_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row    public.cinema_content%ROWTYPE;
    v_season public.cinema_content%ROWTYPE;
    v_value  INTEGER;
BEGIN
    SELECT * INTO v_row FROM public.cinema_content WHERE id = p_content_id;
    IF NOT FOUND OR v_row.lifecycle_status <> 'PUBLISHED' OR v_row.visibility <> 'PUBLIC' THEN
        RETURN NULL;
    END IF;
    -- Same rule as the public catalogue (read_public_cinema_title, 0149): a
    -- title whose creator is not active is not for sale, free or paid.
    IF NOT EXISTS (SELECT 1 FROM public.cinema_memberships m
                   WHERE m.user_id = v_row.creator_id AND m.account_status = 'active') THEN
        RETURN NULL;
    END IF;
    IF v_row.content_type IN ('SHORT', 'TRAILER') THEN
        RETURN 0;
    END IF;
    IF v_row.content_type = 'FILM' THEN
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'film_unlock';
        RETURN v_value;
    END IF;
    IF v_row.content_type = 'EPISODE' THEN
        SELECT * INTO v_season FROM public.cinema_content WHERE id = v_row.parent_id;
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'free_episodes';
        IF v_season.position = 1 AND v_row.position <= v_value THEN
            RETURN 0;
        END IF;
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'episode_unlock';
        RETURN v_value;
    END IF;
    RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.cinema_unlock_price(UUID) FROM PUBLIC, anon, authenticated, service_role;
