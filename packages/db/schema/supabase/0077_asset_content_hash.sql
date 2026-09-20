-- Record the SHA-256 of every stored asset (ADR-0025 option E).
--
-- The provenance endpoint added in #187 says what it cannot do, in its own
-- comment: it "proves that this account generated an asset under this job
-- id. It does NOT bind a file the caller is holding to that record — that
-- needs a content hash stored at ingest, which `assets` has no column for
-- today." This is that column.
--
-- With it, someone holding a file can hash it and compare. The delivery path
-- is byte-preserving end to end (no sharp, no next/image, no Cloudflare
-- Images transform; copyUrlToR2 streams provider bytes verbatim and assets
-- are served by presigned GET straight from R2), so the digest taken at
-- ingest stays true of the file a user downloads. That turns the record into
-- a check anyone can run, without a classifier, a vendor, or a confidence
-- score.
--
-- Nullable, and NULL for every existing row. The bytes of past assets are
-- still in R2 and could be hashed by a backfill, but that is a separate job
-- with its own cost, and a wrong value here would be worse than none.
--
-- The argument list of job_stored changes, which makes a NEW function rather
-- than replacing the old one. Per CLAUDE.md the old signature is dropped and
-- the new one gets its own explicit REVOKE/GRANT — a changed argument list
-- inherits nothing from the previous ACL.

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS sha256 TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assets_sha256_format'
    ) THEN
        ALTER TABLE public.assets
            ADD CONSTRAINT assets_sha256_format
            CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.job_stored(
    p_provider_job_id TEXT,
    p_provider TEXT,
    p_r2_key TEXT,
    p_mime_type TEXT,
    p_size_bytes BIGINT,
    p_sha256 TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job_id UUID;
    v_asset_id UUID;
BEGIN
    UPDATE public.jobs
    SET state = 'STORED', updated_at = now()
    WHERE provider = p_provider
      AND provider_job_id = p_provider_job_id
      AND state IN ('SUBMITTED', 'FAILOVER', 'SUCCEEDED')
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;

    INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, sha256)
    VALUES (v_job_id, p_r2_key, p_mime_type, p_size_bytes, p_sha256)
    ON CONFLICT (r2_key) DO NOTHING
    RETURNING id INTO v_asset_id;

    -- ON CONFLICT DO NOTHING returns NULL when a row with the same
    -- r2_key already exists. Recover the existing row so idempotent
    -- replays return a stable asset id. A replay may also carry a hash
    -- the first write did not have, so fill it in — but never overwrite
    -- one, because two different values for one key means the bytes
    -- changed under a key that is supposed to be immutable.
    IF v_asset_id IS NULL THEN
        UPDATE public.assets
        SET sha256 = p_sha256
        WHERE r2_key = p_r2_key AND sha256 IS NULL AND p_sha256 IS NOT NULL;

        SELECT id INTO v_asset_id FROM public.assets WHERE r2_key = p_r2_key;
    END IF;

    RETURN jsonb_build_object('ok', true, 'job_id', v_job_id, 'asset_id', v_asset_id);
END $$;

-- The five-argument version is unreachable once every caller passes a hash,
-- and leaving it would let a caller silently write an asset row with no
-- digest.
DROP FUNCTION IF EXISTS public.job_stored(TEXT, TEXT, TEXT, TEXT, BIGINT);

DO $$
DECLARE fn text := 'public.job_stored(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT)';
BEGIN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
END $$;
