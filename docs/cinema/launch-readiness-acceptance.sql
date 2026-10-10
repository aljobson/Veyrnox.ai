-- Staging-only acceptance. Run as the existing database operator.
-- Synthetic fixtures and financial entries are rolled back by the inner subtransaction.
-- Does not exercise Stream signing or the HTTP/browser authentication boundary.

DO $verification$
DECLARE
 creator uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); creator_id uuid; viewer_id uuid;
 series uuid; season uuid; free_episode uuid; paid_episode uuid; content uuid;
 ceiling integer; first_unlock jsonb; replay_unlock jsonb; entitlement jsonb; played jsonb; result jsonb;
BEGIN
 BEGIN
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
   (creator,creator::text||'@example.invalid',now()),(viewer,viewer::text||'@example.invalid',now());
  PERFORM public.create_cinema_profile(creator::text,gen_random_uuid(),jsonb_build_object('username','r_'||left(replace(creator::text,'-',''),20),'display_name','Rollout fixture'));
  SELECT id INTO creator_id FROM public.users WHERE auth_id=creator::text;
  SELECT id INTO viewer_id FROM public.users WHERE auth_id=viewer::text;
  UPDATE public.cinema_memberships SET role='creator' WHERE user_id=creator_id;
  series:=(public.save_cinema_draft(creator::text,gen_random_uuid(),null,0,
    '{"content_type":"SERIES","parent_id":null,"position":null,"title":"Rollout fixture","synopsis":"Verification","language":"en","ai_disclosures":[]}'::jsonb)->>'id')::uuid;
  season:=(public.save_cinema_draft(creator::text,gen_random_uuid(),null,0,
    jsonb_build_object('content_type','SEASON','parent_id',series,'position',1,'title','Season','synopsis','Verification','language','en','ai_disclosures','[]'::jsonb))->>'id')::uuid;
  free_episode:=(public.save_cinema_draft(creator::text,gen_random_uuid(),null,0,
    jsonb_build_object('content_type','EPISODE','parent_id',season,'position',1,'title','Free','synopsis','Verification','language','en','ai_disclosures','[]'::jsonb))->>'id')::uuid;
  paid_episode:=(public.save_cinema_draft(creator::text,gen_random_uuid(),null,0,
    jsonb_build_object('content_type','EPISODE','parent_id',season,'position',6,'title','Paid','synopsis','Verification','language','en','ai_disclosures','[]'::jsonb))->>'id')::uuid;
  IF free_episode IS NULL OR paid_episode IS NULL THEN RAISE EXCEPTION 'Fixture creation failed'; END IF;
  UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC' WHERE id=ANY(array[series,season,free_episode,paid_episode]);
  FOREACH content IN ARRAY array[free_episode,paid_episode] LOOP
   INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid)
    VALUES(content,creator_id,gen_random_uuid(),100,repeat('f',64),'ready',replace(gen_random_uuid()::text,'-',''));
  END LOOP;
  played:=public.start_cinema_playback(viewer::text,free_episode);
  IF played->>'access' IS DISTINCT FROM 'free' THEN RAISE EXCEPTION 'Free playback failed: %',played; END IF;
  SELECT value INTO ceiling FROM public.cinema_prices WHERE key='free_ceiling_minutes';
  INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source,played_at)
   SELECT viewer_id,free_episode,60,'heartbeat',now()-interval '2 minutes' FROM generate_series(1,ceiling-1);
  entitlement:=public.cinema_metered_entitlement(viewer::text,free_episode);
  IF entitlement->>'reason' IS DISTINCT FROM 'free_ceiling' THEN RAISE EXCEPTION 'Free ceiling failed: %',entitlement; END IF;
  IF public.start_cinema_playback(viewer::text,free_episode)->>'reason' IS DISTINCT FROM 'free_ceiling' THEN RAISE EXCEPTION 'Playback bypassed ceiling'; END IF;
  first_unlock:=public.unlock_cinema_content(viewer::text,paid_episode,'unlock-2026-09-26');
  replay_unlock:=public.unlock_cinema_content(viewer::text,paid_episode,'unlock-2026-09-26');
  IF first_unlock->>'access' IS DISTINCT FROM 'unlocked' OR (first_unlock->>'credits')::integer<>6
   OR replay_unlock->>'idempotent' IS DISTINCT FROM 'true'
   OR replay_unlock->>'unlock_id' IS DISTINCT FROM first_unlock->>'unlock_id' THEN
   RAISE EXCEPTION 'Unlock replay failed: %, %',first_unlock,replay_unlock;
  END IF;
  IF (SELECT count(*) FROM public.ledger_entries WHERE user_id=viewer_id AND reason='unlock:cinema:'||paid_episode::text)<>1 THEN RAISE EXCEPTION 'Unlock debit was not exactly once'; END IF;
  IF EXISTS(SELECT 1 FROM public.reconcile_balances()) OR EXISTS(SELECT 1 FROM public.reconcile_free_credits())
   OR EXISTS(SELECT 1 FROM public.reconcile_top_ups()) OR EXISTS(SELECT 1 FROM public.reconcile_failed_refunds())
   OR EXISTS(SELECT 1 FROM public.reconcile_subscription_credits()) THEN RAISE EXCEPTION 'Direct reconciliation drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.reconcile_status() r WHERE r.balance_drift<>0 OR r.free_credit_drift<>0 OR r.top_up_drift<>0 OR r.failed_refund_drift<>0 OR r.subscription_credit_drift<>0) THEN RAISE EXCEPTION 'Reconciliation drift'; END IF;
  result:=jsonb_build_object('free_play','passed','free_ceiling_minutes',ceiling,'ceiling_blocks_playback','passed','unlock_credits',6,'unlock_debits',1,'replay_idempotent',true,'reconciliation','all five zero','fixtures','rolled back');
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Rollback verification fixtures';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 PERFORM set_config('codex.cinema_rollout_result',result::text,true);
END $verification$;
SELECT current_setting('codex.cinema_rollout_result')::jsonb AS result;

