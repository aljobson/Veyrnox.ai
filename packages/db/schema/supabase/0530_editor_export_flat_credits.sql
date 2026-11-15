-- ADR-0261 amendment 2: a phone/server editor export costs a flat 3 credits at any length
-- and either resolution (owner decision 2026-11-15; editing stays free). The one price
-- stays in the catalog: model_catalog.editor_render_rates->>'flat_credits' on the
-- 'editor-server-render' row. Absent or invalid, the per-second rates from 0396 apply, so
-- removing the key is the rollback. quote_server_render (0398) and admit_server_render
-- (0401) already call private.editor_render_credits and keep their signatures, so the
-- quote, the PRICE_CHANGED consent check, the single ledger_debit and every refund path
-- are untouched. The render stays off: the row's flags and the Fly runner are unchanged.
BEGIN;
-- STABLE (it reads the catalog) instead of IMMUTABLE; same signature, so callers need no change.
CREATE OR REPLACE FUNCTION private.editor_render_credits(p_credits INTEGER,p_seconds NUMERIC,p_billing NUMERIC)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE flat INTEGER;
BEGIN
 SELECT CASE WHEN editor_render_rates->>'flat_credits' ~ '^[1-9][0-9]{0,3}$' THEN (editor_render_rates->>'flat_credits')::integer END
 INTO flat FROM public.model_catalog WHERE id='editor-server-render' AND provider='concat-render';
 IF flat IS NOT NULL THEN RETURN flat; END IF;
 RETURN greatest(1,ceil(p_credits*p_seconds/p_billing)::integer);
END $$;
REVOKE ALL ON FUNCTION private.editor_render_credits(INTEGER,NUMERIC,NUMERIC) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE affected BIGINT; BEGIN
 UPDATE public.model_catalog SET editor_render_rates=coalesce(editor_render_rates,'{}'::jsonb)||'{"flat_credits":3}'::jsonb,updated_at=now()
 WHERE id='editor-server-render' AND provider='concat-render';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one editor-server-render row, updated %',affected; END IF;
END $$;
COMMIT;
