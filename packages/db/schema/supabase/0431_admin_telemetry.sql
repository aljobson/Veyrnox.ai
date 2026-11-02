-- ADR-0321. Aggregate only; all dimensions are constrained to finite values.
CREATE TABLE IF NOT EXISTS public.traffic_hourly (
 hour TIMESTAMPTZ NOT NULL, path_pattern TEXT NOT NULL, country TEXT NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 device TEXT NOT NULL CHECK(device IN ('desktop','mobile','tablet','bot','other')), referrer_host TEXT NOT NULL,
 views INT NOT NULL CHECK(views>=0), PRIMARY KEY(hour,path_pattern,country,device,referrer_host)
);
CREATE TABLE IF NOT EXISTS public.route_usage_hourly (
 hour TIMESTAMPTZ NOT NULL, route_pattern TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','OTHER')),
 status_class TEXT NOT NULL CHECK(status_class IN ('1xx','2xx','3xx','4xx','5xx','other')), calls INT NOT NULL CHECK(calls>=0),
 latency_ms_sum BIGINT NOT NULL CHECK(latency_ms_sum>=0), latency_ms_max INT NOT NULL CHECK(latency_ms_max BETWEEN 0 AND 60000),
 PRIMARY KEY(hour,route_pattern,method,status_class)
);
ALTER TABLE public.traffic_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_hourly FORCE ROW LEVEL SECURITY;
ALTER TABLE public.route_usage_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_usage_hourly FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.traffic_hourly,public.route_usage_hourly FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path = ANY (ARRAY['/','/.well-known/apple-app-site-association','/.well-known/assetlinks.json','/.well-known/oauth-protected-resource/api/v1/developer','/.well-known/oauth-protected-resource/api/v1/mcp','/about','/api/admin/reap-assets','/api/admin/top-up-backfill','/api/auth/session','/api/catalog','/api/cinema-pass-plans','/api/cinema/comments','/api/cinema/discovery','/api/cinema/posters/:id','/api/cinema/story-polls','/api/cinema/titles','/api/cinema/titles/:id','/api/cinema/voting','/api/cinema/winners','/api/credit-packs','/api/credit-subscription-plans','/api/developer/openapi','/api/popular-templates','/api/presets','/api/publish/v1/accounts','/api/publish/v1/posts','/api/social/approvals/:id','/api/social/team/:id','/api/status','/api/templates','/api/templates/:id','/api/turnstile-failure','/api/v1/account','/api/v1/account/age-confirmation','/api/v1/account/deletion','/api/v1/account/export','/api/v1/account/export/:id','/api/v1/account/language','/api/v1/admin/affiliates','/api/v1/admin/appeals','/api/v1/admin/changes','/api/v1/admin/cinema/comments','/api/v1/admin/cinema/creators','/api/v1/admin/cinema/earnings','/api/v1/admin/cinema/pass/refund','/api/v1/admin/cinema/rankings','/api/v1/admin/cinema/story-polls','/api/v1/admin/cinema/submissions','/api/v1/admin/cinema/suspend','/api/v1/admin/cinema/unlocks/reverse','/api/v1/admin/cinema/voting','/api/v1/admin/endpoints','/api/v1/admin/metrics','/api/v1/admin/permissions','/api/v1/admin/plans','/api/v1/admin/reports','/api/v1/admin/reports/asset','/api/v1/admin/revenue','/api/v1/admin/roles','/api/v1/admin/security','/api/v1/admin/support','/api/v1/admin/switches','/api/v1/admin/traffic','/api/v1/admin/users/ledger','/api/v1/admin/users/lookup','/api/v1/admin/violations','/api/v1/admin/webhooks','/api/v1/appeals','/api/v1/balance','/api/v1/chat/folders','/api/v1/chat/folders/:id','/api/v1/chat/models','/api/v1/chat/personas','/api/v1/chat/personas/:id','/api/v1/chat/sends/close','/api/v1/chat/threads','/api/v1/chat/threads/:id','/api/v1/chat/threads/:id/messages','/api/v1/checkin','/api/v1/cinema/audience','/api/v1/cinema/blocks','/api/v1/cinema/blocks/:id','/api/v1/cinema/comments','/api/v1/cinema/content','/api/v1/cinema/content/submit','/api/v1/cinema/content/withdraw','/api/v1/cinema/creator-analytics','/api/v1/cinema/entitlement','/api/v1/cinema/pass','/api/v1/cinema/pass/cancel','/api/v1/cinema/pass/plans','/api/v1/cinema/pass/portal','/api/v1/cinema/pass/return','/api/v1/cinema/play','/api/v1/cinema/play/heartbeat','/api/v1/cinema/posters/:id','/api/v1/cinema/progress','/api/v1/cinema/retention','/api/v1/cinema/story-choices','/api/v1/cinema/story-polls','/api/v1/cinema/titles/:id','/api/v1/cinema/unlocks','/api/v1/cinema/uploads','/api/v1/cinema/uploads/:id/transfer','/api/v1/cinema/uploads/from-library','/api/v1/cinema/uploads/refresh','/api/v1/cinema/uploads/remove','/api/v1/cinema/votes','/api/v1/cinema/voting','/api/v1/creator-profile','/api/v1/creator-profile/skip','/api/v1/creators/apply','/api/v1/credit-packs','/api/v1/developer/:id*','/api/v1/devices','/api/v1/editor/server-render','/api/v1/editor/server-render/quote','/api/v1/film-studio','/api/v1/film-studio/:id','/api/v1/free-allowance','/api/v1/generations','/api/v1/health','/api/v1/help','/api/v1/jobs','/api/v1/jobs/:id','/api/v1/jobs/:id/asset','/api/v1/jobs/:id/cancel','/api/v1/jobs/:id/media-info','/api/v1/jobs/:id/provenance','/api/v1/ledger','/api/v1/ledger/usage','/api/v1/library/editor-renders','/api/v1/library/editor-renders/:id/asset','/api/v1/library/editor-renders/:id/inspect','/api/v1/library/masters','/api/v1/library/masters/:id/asset','/api/v1/library/masters/upload','/api/v1/mcp','/api/v1/mfa/recovery','/api/v1/mfa/recovery/codes','/api/v1/montage/plan','/api/v1/projects','/api/v1/projects/:id','/api/v1/projects/:id/assets','/api/v1/projects/:id/assets/:id/download','/api/v1/projects/:id/assets/:id/inspect','/api/v1/projects/:id/document','/api/v1/projects/:id/history','/api/v1/projects/:id/review','/api/v1/referrals','/api/v1/referrals/attach','/api/v1/reports','/api/v1/session/me','/api/v1/social-cinema/profile','/api/v1/social/access','/api/v1/social/accounts','/api/v1/social/accounts/:id','/api/v1/social/accounts/bluesky/connect','/api/v1/social/accounts/facebook/callback','/api/v1/social/accounts/facebook/connect','/api/v1/social/accounts/gmb/callback','/api/v1/social/accounts/gmb/connect','/api/v1/social/accounts/instagram/callback','/api/v1/social/accounts/instagram/connect','/api/v1/social/accounts/linkedin/callback','/api/v1/social/accounts/linkedin/connect','/api/v1/social/accounts/pinterest/callback','/api/v1/social/accounts/pinterest/connect','/api/v1/social/accounts/threads/callback','/api/v1/social/accounts/threads/connect','/api/v1/social/accounts/tiktok/callback','/api/v1/social/accounts/tiktok/connect','/api/v1/social/accounts/twitch/callback','/api/v1/social/accounts/twitch/connect','/api/v1/social/accounts/twitter/callback','/api/v1/social/accounts/twitter/connect','/api/v1/social/accounts/youtube/callback','/api/v1/social/accounts/youtube/connect','/api/v1/social/activity','/api/v1/social/ads','/api/v1/social/analytics','/api/v1/social/approvals','/api/v1/social/autolists','/api/v1/social/best-time','/api/v1/social/brands','/api/v1/social/calendar','/api/v1/social/commerce/products','/api/v1/social/contacts','/api/v1/social/developer/keys','/api/v1/social/developer/logs','/api/v1/social/developer/webhooks','/api/v1/social/drafts','/api/v1/social/inbox','/api/v1/social/inbox/:id','/api/v1/social/inbox/:id/reply','/api/v1/social/inbox/:id/suggestions','/api/v1/social/inbox/analytics','/api/v1/social/plan','/api/v1/social/plan/cancel','/api/v1/social/plan/portal','/api/v1/social/plan/return','/api/v1/social/posts','/api/v1/social/posts/:id','/api/v1/social/posts/:id/schedule','/api/v1/social/presets','/api/v1/social/queues','/api/v1/social/queues/reserve','/api/v1/social/reports','/api/v1/social/reports/:id/export','/api/v1/social/smartlink','/api/v1/social/team','/api/v1/social/team/accept','/api/v1/social/uploads','/api/v1/social/workflows','/api/v1/store-purchases/customer','/api/v1/subscriptions','/api/v1/subscriptions/cancel','/api/v1/subscriptions/checkout','/api/v1/subscriptions/plans','/api/v1/subscriptions/return','/api/v1/support/tickets','/api/v1/top-ups','/api/v1/top-ups/:id','/api/v1/top-ups/:id/return','/api/v1/uploads','/api/v1/voice-profiles','/api/v1/voice-profiles/:id','/api/v1/voice-profiles/:id/captcha','/api/v1/voice-profiles/:id/samples','/api/v1/voice-profiles/:id/speech','/api/v1/wins','/api/v1/workspaces','/api/v1/workspaces/:id/brand-assets','/api/v1/workspaces/:id/brand-kit','/api/webhook/cinema-stream','/api/webhook/editor-render','/api/webhook/fal','/api/webhook/kie','/api/webhook/montage','/api/webhook/openrouter','/api/webhook/revenuecat','/api/webhook/social/meta','/api/webhook/stripe','/app','/app/account','/app/account/appeals','/app/account/report','/app/account/wins','/app/admin','/app/admin/affiliates','/app/admin/appeals','/app/admin/changes','/app/admin/cinema','/app/admin/cinema/comments','/app/admin/cinema/rankings','/app/admin/cinema/story-polls','/app/admin/cinema/submissions','/app/admin/cinema/voting','/app/admin/endpoints','/app/admin/payments','/app/admin/plans','/app/admin/reports','/app/admin/roles','/app/admin/security','/app/admin/support','/app/admin/switches','/app/admin/traffic','/app/admin/users','/app/admin/violations','/app/admin/webhooks','/app/chat','/app/create','/app/credits','/app/editor','/app/editor/review','/app/enhance','/app/faceless-reel','/app/features','/app/features/:id','/app/film-studio','/app/library','/app/oddlings','/app/projects','/app/projects/:id','/app/publish','/app/publish/activity','/app/publish/ads','/app/publish/analytics','/app/publish/autolists','/app/publish/calendar','/app/publish/commerce','/app/publish/contacts','/app/publish/developer','/app/publish/inbox','/app/publish/plan','/app/publish/queues','/app/publish/reports','/app/publish/smartlink','/app/publish/team','/app/publish/workflows','/app/skills','/app/vibe','/app/video-agent','/auth/callback','/auth/mobile','/auth/mobile/start','/compare/:id','/design-system','/developers','/guides','/guides/:id','/legal/aup','/legal/cinema-content','/legal/gdpr','/legal/privacy','/legal/refund','/legal/terms','/m','/m/create','/m/credits','/m/explore','/m/job','/m/library','/mcp','/media/social/:id','/models','/models/:id','/oauth/consent','/oddlings','/oddlings/:id','/presets','/presets/:id','/pricing','/publish','/s/:id','/s/:id/go/:id','/social-cinema','/social-cinema/creator','/social-cinema/pass','/social-cinema/series/:id','/social-cinema/title/:id','/social-cinema/watch/:id','/social/connect/callback/:id','/social/connect/mobile/:id','/social/review/:id','/social/team/invite/:id','/tools','other']::text[]);
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.telemetry_ingest(p_batch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r JSONB; h TIMESTAMPTZ; n BIGINT; total BIGINT; maximum INT; v_enabled BOOLEAN; v_pattern TEXT;
BEGIN
 IF jsonb_typeof(p_batch) IS DISTINCT FROM 'array' OR jsonb_array_length(p_batch)>500 THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.runtime_switches WHERE key='telemetry' AND state='on') INTO v_enabled;
 FOR r IN SELECT value FROM jsonb_array_elements(p_batch) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->>'kind' IS NULL OR r->>'kind' NOT IN ('traffic','route') THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
  IF (r->>'hour') IS NULL OR (r->>'hour') !~ '^\d{4}-\d\d-\d\dT\d\d:00:00(\.000)?Z$' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
  h:=(r->>'hour')::timestamptz;
  IF h < now()-interval '90 days' OR h>now()+interval '1 hour' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
  IF r->>'kind'='traffic' THEN
   IF NOT r ?& ARRAY['kind','hour','path_pattern','country','device','referrer_host','views'] OR r-ARRAY['kind','hour','path_pattern','country','device','referrer_host','views']<>'{}'::jsonb
    OR jsonb_typeof(r->'views')<>'number' OR (r->>'views') !~ '^[0-9]{1,10}$' OR jsonb_typeof(r->'path_pattern') IS DISTINCT FROM 'string' OR length(r->>'path_pattern') NOT BETWEEN 1 AND 512
    OR (r->>'country') IS NULL OR (r->>'country') !~ '^[A-Z]{2}$' OR NOT coalesce(r->>'device' IN ('desktop','mobile','tablet','bot','other'),false)
    OR NOT coalesce(r->>'referrer_host' IN ('direct','other','google.com','www.google.com','bing.com','www.bing.com','t.co','facebook.com','www.facebook.com','instagram.com','www.instagram.com','youtube.com','www.youtube.com','veyrnox.ai','www.veyrnox.ai'),false)
   THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
   n:=(r->>'views')::bigint; IF n NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
   IF v_enabled THEN
   v_pattern:=CASE WHEN public.telemetry_path_allowed(r->>'path_pattern') THEN r->>'path_pattern' ELSE 'other' END;
   INSERT INTO public.traffic_hourly VALUES(h,v_pattern,r->>'country',r->>'device',r->>'referrer_host',n)
    ON CONFLICT(hour,path_pattern,country,device,referrer_host) DO UPDATE SET views=public.traffic_hourly.views+excluded.views;
   END IF;
  ELSE
   IF NOT r ?& ARRAY['kind','hour','route_pattern','method','status_class','calls','latency_ms_sum','latency_ms_max'] OR r-ARRAY['kind','hour','route_pattern','method','status_class','calls','latency_ms_sum','latency_ms_max']<>'{}'::jsonb
    OR jsonb_typeof(r->'route_pattern') IS DISTINCT FROM 'string' OR length(r->>'route_pattern') NOT BETWEEN 1 AND 512
    OR NOT coalesce(r->>'method' IN ('GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','OTHER'),false)
    OR NOT coalesce(r->>'status_class' IN ('1xx','2xx','3xx','4xx','5xx','other'),false)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['calls','latency_ms_sum','latency_ms_max']) k WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'number' OR (r->>k) !~ '^[0-9]{1,10}$')
   THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
   n:=(r->>'calls')::bigint;total:=(r->>'latency_ms_sum')::bigint;maximum:=(r->>'latency_ms_max')::int;
   IF n NOT BETWEEN 1 AND 1000000000 OR total NOT BETWEEN 0 AND 1000000000 OR maximum NOT BETWEEN 0 AND 60000 OR total>n*60000 OR total<maximum THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
   IF v_enabled THEN
   v_pattern:=CASE WHEN public.telemetry_path_allowed(r->>'route_pattern') THEN r->>'route_pattern' ELSE 'other' END;
   INSERT INTO public.route_usage_hourly VALUES(h,v_pattern,r->>'method',r->>'status_class',n,total,maximum)
    ON CONFLICT(hour,route_pattern,method,status_class) DO UPDATE SET calls=public.route_usage_hourly.calls+excluded.calls,
     latency_ms_sum=public.route_usage_hourly.latency_ms_sum+excluded.latency_ms_sum,latency_ms_max=greatest(public.route_usage_hourly.latency_ms_max,excluded.latency_ms_max);
   END IF;
  END IF;
 END LOOP;
 DELETE FROM public.traffic_hourly WHERE hour<now()-interval '90 days';
 DELETE FROM public.route_usage_hourly WHERE hour<now()-interval '90 days';
 RETURN jsonb_build_object('ok',true,'accepted',CASE WHEN v_enabled THEN jsonb_array_length(p_batch) ELSE 0 END);
END $$;
REVOKE ALL ON FUNCTION public.telemetry_ingest(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.telemetry_ingest(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_traffic_summary(p_auth_id UUID,p_days INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_days JSONB; v_paths JSONB; v_countries JSONB; v_devices JSONB; v_referrers JSONB;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'traffic');
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.day),'[]') INTO v_days FROM (SELECT (hour AT TIME ZONE 'UTC')::date AS day,sum(views) AS views FROM public.traffic_hourly WHERE views>=5 AND hour>=now()-make_interval(days=>p_days) GROUP BY 1) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.views DESC,t.path_pattern),'[]') INTO v_paths FROM (SELECT path_pattern,sum(views) AS views FROM public.traffic_hourly WHERE views>=5 AND hour>=now()-make_interval(days=>p_days) GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 100) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.views DESC,t.country),'[]') INTO v_countries FROM (SELECT country,sum(views) AS views FROM public.traffic_hourly WHERE views>=5 AND hour>=now()-make_interval(days=>p_days) GROUP BY 1) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.views DESC,t.device),'[]') INTO v_devices FROM (SELECT device,sum(views) AS views FROM public.traffic_hourly WHERE views>=5 AND hour>=now()-make_interval(days=>p_days) GROUP BY 1) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.views DESC,t.referrer_host),'[]') INTO v_referrers FROM (SELECT referrer_host,sum(views) AS views FROM public.traffic_hourly WHERE views>=5 AND hour>=now()-make_interval(days=>p_days) GROUP BY 1) t;
 RETURN jsonb_build_object('ok',true,'telemetry',EXISTS(SELECT 1 FROM public.runtime_switches WHERE key='telemetry' AND state='on'),'days',v_days,'paths',v_paths,'countries',v_countries,'devices',v_devices,'referrers',v_referrers);
END $$;
REVOKE ALL ON FUNCTION public.admin_traffic_summary(UUID,INT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_traffic_summary(UUID,INT) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_endpoint_usage(p_auth_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows JSONB;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'endpoints');
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.route_pattern,t.method),'[]') INTO v_rows FROM (
  SELECT route_pattern,method,sum(calls) AS calls,sum(latency_ms_sum) AS latency_ms_sum,max(latency_ms_max) AS latency_ms_max
  FROM public.route_usage_hourly WHERE calls>=5 AND hour>=date_trunc('hour',now())-interval '23 hours' GROUP BY 1,2
 ) t;
 RETURN jsonb_build_object('ok',true,'telemetry',EXISTS(SELECT 1 FROM public.runtime_switches WHERE key='telemetry' AND state='on'),'usage',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.admin_endpoint_usage(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_endpoint_usage(UUID) TO service_role;
