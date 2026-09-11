-- ADR-0008: uniform 90-day asset retention + pg_cron sweep.

CREATE OR REPLACE FUNCTION public.assets_set_expires_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.expires_at IS NULL THEN
        NEW.expires_at := now() + interval '90 days';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assets_set_expires_at_trg ON public.assets;
CREATE TRIGGER assets_set_expires_at_trg
    BEFORE INSERT ON public.assets
    FOR EACH ROW EXECUTE FUNCTION public.assets_set_expires_at();

CREATE TABLE IF NOT EXISTS public.asset_reap_queue (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    r2_key       TEXT        NOT NULL UNIQUE,
    queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts     INTEGER     NOT NULL DEFAULT 0,
    last_error   TEXT        NULL
);
CREATE INDEX IF NOT EXISTS asset_reap_queue_queued_idx ON public.asset_reap_queue (queued_at);

ALTER TABLE public.asset_reap_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_reap_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_reap_queue_service_all ON public.asset_reap_queue;
CREATE POLICY asset_reap_queue_service_all ON public.asset_reap_queue
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.expire_assets(p_batch_size INT DEFAULT 500)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_moved INT;
BEGIN
    WITH doomed AS (
        SELECT id, r2_key FROM public.assets
         WHERE expires_at IS NOT NULL AND expires_at <= now()
         ORDER BY expires_at LIMIT p_batch_size
    ),
    queued AS (
        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT r2_key FROM doomed
        ON CONFLICT (r2_key) DO NOTHING
        RETURNING 1
    ),
    dropped AS (
        DELETE FROM public.assets
         WHERE id IN (SELECT id FROM doomed)
        RETURNING 1
    )
    SELECT count(*) INTO v_moved FROM dropped;
    RETURN v_moved;
END $$;

REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM anon;
REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_assets(INT) TO service_role;

SELECT cron.schedule(
    'veyrnox-expire-assets',
    '*/15 * * * *',
    $$ SELECT public.expire_assets(500); $$
);
