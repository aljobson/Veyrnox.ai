-- 0509: expiry never deletes a file that Music still uses.
--
-- Every asset gets a 90-day expires_at from assets_set_expires_at, Music files
-- included. music_song_versions.audio_asset_id and music_target_stem_assets
-- (target_asset_id, residual_asset_id) reference assets ON DELETE RESTRICT.
-- expire_assets deletes its whole batch in one statement, ordered by expires_at,
-- so the first due Music file raises a foreign-key violation, the batch rolls
-- back, and the same rows head every later batch: the 15-minute
-- veyrnox-expire-assets job would stop deleting anything for anyone. On staging
-- the first Music file falls due on 2027-02-11.
--
-- The Music screens promise that earlier audio stays until the person removes it,
-- so a file a song version or target stem still points at is skipped here, not
-- deleted. Every other expired, un-held file is deleted exactly as before.
--
-- Idempotent: OR REPLACE, explicit revoke and grant. The body is otherwise 0447's.

CREATE OR REPLACE FUNCTION public.expire_assets(p_batch_size INT DEFAULT 500)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_moved INT;
BEGIN
    WITH doomed AS (
        SELECT a.id, a.r2_key FROM public.assets a
         WHERE a.expires_at IS NOT NULL AND a.expires_at <= now() AND a.held_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.music_song_versions v WHERE v.audio_asset_id = a.id)
           AND NOT EXISTS (SELECT 1 FROM public.music_target_stem_assets t
                            WHERE t.target_asset_id = a.id OR t.residual_asset_id = a.id)
         ORDER BY a.expires_at, a.id LIMIT p_batch_size FOR UPDATE OF a SKIP LOCKED
    ), gone AS (
        DELETE FROM public.assets
         WHERE id IN (SELECT id FROM doomed) AND held_at IS NULL
        RETURNING r2_key
    ), queued AS (
        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT r2_key FROM gone ON CONFLICT (r2_key) DO NOTHING
    )
    SELECT count(*) INTO v_moved FROM gone;
    RETURN v_moved;
END $$;
REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_assets(INT) TO service_role;
