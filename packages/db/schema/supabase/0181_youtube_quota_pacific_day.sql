-- 0181: count YouTube uploads per YouTube quota day (docs/product/ISSUES.md S16).
--
-- YouTube Data API quotas reset at midnight Pacific Time. 0161 keyed the
-- daily counter on current_date, the database's day (UTC on Supabase), so
-- the 80-upload cap rolled over 7–8 hours before YouTube's did: uploads
-- after 00:00 UTC drew on a fresh local count while YouTube's own quota was
-- still the previous day's. 0161 body, keyed on the Pacific date instead.

CREATE OR REPLACE FUNCTION public.consume_youtube_upload_quota()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.youtube_upload_daily_quota AS q (quota_date, upload_count)
    VALUES ((now() AT TIME ZONE 'America/Los_Angeles')::date, 1)
    ON CONFLICT (quota_date) DO UPDATE SET upload_count = q.upload_count + 1
    RETURNING upload_count INTO v_count;
    IF v_count > 80 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTA_EXHAUSTED');
    END IF;
    RETURN jsonb_build_object('ok', true, 'used', v_count, 'limit', 80);
END $$;

REVOKE ALL ON FUNCTION public.consume_youtube_upload_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_youtube_upload_quota() TO service_role;
