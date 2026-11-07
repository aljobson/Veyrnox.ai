-- Run on a freshly replayed disposable database. Fixtures and all audit rows roll back.
-- Lock order: advisory (clawback) -> balances by user_id -> users -> jobs ->
-- social targets -> assets by id -> scans -> evidence / reports / reap queue.
-- Existing account erasure ordering exceptions are documented in amendment 4.
\set QUIET on
BEGIN;
CREATE TEMP TABLE smoke_output(n BIGSERIAL, message TEXT);
CREATE FUNCTION pg_temp.check_ok(p_ok BOOLEAN,p_message TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'smoke assertion failed: %',coalesce(p_message,'unnamed assertion'); END IF;
 IF p_message IS NOT NULL THEN INSERT INTO smoke_output(message) VALUES(p_message); END IF;
END $$;
CREATE FUNCTION pg_temp.image(p_user UUID,p_kind TEXT DEFAULT 'image/png') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE j UUID := gen_random_uuid();
BEGIN
 INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,inputs)
 VALUES(j,p_user,j::text,'smoke-model',1,'STORED','{}');
 INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES(j,'smoke/'||j::text,p_kind,100);
 RETURN j;
END $$;
CREATE FUNCTION pg_temp.hold(p_job UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE c RECORD; r JSONB;
BEGIN
 SELECT * INTO c FROM public.claim_content_scans(5,120) WHERE id=(SELECT id FROM public.content_scans WHERE job_id=p_job);
 PERFORM pg_temp.check_ok(c.id IS NOT NULL,'fixture: lease required');
 -- Fixture helpers must not add lines to the prescribed proof output.
 DELETE FROM smoke_output WHERE message='fixture: lease required';
 r:=public.record_content_scan(c.id,c.claim_token,'hold','{"sexual":0.9,"violence":0.1,"violence/graphic":0.01,"self-harm":0,"self-harm/intent":0,"self-harm/instructions":0}','smoke');
 PERFORM pg_temp.check_ok(r->>'ok'='true');
END $$;
DO $$
#variable_conflict use_column
DECLARE
 admin_auth UUID:=gen_random_uuid(); user_auth UUID:=gen_random_uuid(); sub_auth UUID:=gen_random_uuid();
 admin_id UUID; user_id UUID; sub_id UUID; mfa BIGINT:=extract(epoch FROM clock_timestamp())::bigint;
 r JSONB; original_action UUID; original_entry UUID; j1 UUID; j2 UUID; j3 UUID; j4 UUID; jvideo UUID; jlease UUID;
 c RECORD; token UUID; old_token UUID; n INTEGER; b UUID:=gen_random_uuid(); ac UUID:=gen_random_uuid();
 post UUID:=gen_random_uuid(); target UUID:=gen_random_uuid(); claimed RECORD; counts INTEGER[];
 jscan UUID; post2 UUID:=gen_random_uuid(); target2 UUID:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(admin_auth,'scan-admin@test.invalid',NULL),(user_auth,'scan-user@test.invalid',NULL),(sub_auth,'scan-sub@test.invalid',NULL);
 -- Auth hooks may have provisioned shadow users. Never fabricate an unmatched Auth identity.
 INSERT INTO public.users(auth_id,email) VALUES(admin_auth::text,'scan-admin@test.invalid'),(user_auth::text,'scan-user@test.invalid'),(sub_auth::text,'scan-sub@test.invalid') ON CONFLICT(auth_id) DO NOTHING;
 SELECT id INTO admin_id FROM public.users WHERE auth_id=admin_auth::text;
 SELECT id INTO user_id FROM public.users WHERE auth_id=user_auth::text;
 SELECT id INTO sub_id FROM public.users WHERE auth_id=sub_auth::text;
 UPDATE public.users SET is_admin=true WHERE id=admin_id;
 INSERT INTO public.credit_balances(user_id,balance) VALUES(admin_id,0),(user_id,0),(sub_id,0) ON CONFLICT DO NOTHING;
 -- Use ledger RPCs for every fixture balance, preserving all three reconciliations.
 r:=public.ledger_grant(user_id,100,'grant:smoke','clawback-seed');
 PERFORM pg_temp.check_ok(r->>'ok'='true');
 UPDATE public.credit_balances SET updated_at=now()-interval '1 day' WHERE public.credit_balances.user_id=(SELECT id FROM public.users WHERE auth_id=user_auth::text);
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,40,'correction','clawback-first');
 PERFORM pg_temp.check_ok((SELECT updated_at=now() FROM public.credit_balances WHERE public.credit_balances.user_id=(SELECT id FROM public.users WHERE auth_id=user_auth::text)));
 original_action:=(r->>'action_id')::uuid; original_entry:=(r->>'entry_id')::uuid;
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND (r->>'balance_after')::integer=60 AND (r->>'credits_delta')::integer=-40
  AND EXISTS(SELECT 1 FROM public.ledger_entries WHERE id=original_entry AND delta=-40 AND free_delta=0 AND subscription_delta=0)
  AND EXISTS(SELECT 1 FROM public.account_actions WHERE id=original_action AND action='credit_clawback' AND balance_after=60 AND actor_user_id=admin_id),'clawback: ok');
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,61,'over cap','clawback-cap');
 PERFORM pg_temp.check_ok(r->>'code'='INSUFFICIENT_PACK_CREDITS' AND (r->>'pack_credits')::integer=60,'clawback cap: INSUFFICIENT_PACK_CREDITS');
 PERFORM public.ledger_grant(sub_id,20,'grant:smoke','clawback-sub-pack');
 PERFORM public.subscription_grant(sub_id,80,now()+interval '1 day','smoke_subscription');
 UPDATE public.credit_balances SET subscription_expires_at=now()-interval '1 day' WHERE user_id=sub_id;
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,sub_id,21,'over cap','clawback-expired');
 PERFORM pg_temp.check_ok(r->>'code'='INSUFFICIENT_PACK_CREDITS' AND (r->>'pack_credits')::integer=20,'clawback expired sub cap: INSUFFICIENT_PACK_CREDITS');
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,sub_id,20,'at cap','clawback-sub-allowed');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.credit_balances WHERE user_id=sub_id AND balance=80 AND subscription_balance=80));
 PERFORM public.admin_credit_grant_guarded(admin_auth::text,'aal2',mfa,user_id,20,'intervening grant','clawback-between');
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,40,'correction','clawback-first');
 PERFORM pg_temp.check_ok(r->>'replayed'='true' AND (r->>'balance_after')::integer=60 AND (r->>'action_id')::uuid=original_action,'clawback replay: 60');
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,41,'correction','clawback-first');
 PERFORM pg_temp.check_ok(r->>'code'='IDEMPOTENCY_KEY_REUSED','clawback reused: IDEMPOTENCY_KEY_REUSED');
 -- Bind reason, user, actor and action as well as amount.
 PERFORM pg_temp.check_ok(public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,40,'different','clawback-first')->>'code'='IDEMPOTENCY_KEY_REUSED');
 PERFORM pg_temp.check_ok(public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,sub_id,40,'correction','clawback-first')->>'code'='IDEMPOTENCY_KEY_REUSED');
 PERFORM pg_temp.check_ok(public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,user_id,20,'intervening grant','clawback-between')->>'code'='IDEMPOTENCY_KEY_REUSED');
 UPDATE public.users SET is_admin=true WHERE id=sub_id;
 PERFORM pg_temp.check_ok(public.admin_credit_clawback_guarded(sub_auth::text,'aal2',mfa,user_id,40,'correction','clawback-first')->>'code'='IDEMPOTENCY_KEY_REUSED');
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa-301,user_id,1,'stale','clawback-stale');
 PERFORM pg_temp.check_ok(r->>'code'='MFA_REQUIRED','mfa stale: MFA_REQUIRED');
 counts:=ARRAY[(SELECT count(*)::integer FROM public.reconcile_balances()),(SELECT count(*)::integer FROM public.reconcile_free_credits()),(SELECT count(*)::integer FROM public.reconcile_subscription_credits())];
 PERFORM pg_temp.check_ok(counts=ARRAY[0,0,0],'reconcile: 0/0/0');
 j1:=pg_temp.image(user_id);
 PERFORM pg_temp.check_ok((SELECT count(*)=1 FROM public.content_scans WHERE job_id=j1 AND status='queued'),'scan queued: 1');
 jvideo:=pg_temp.image(user_id,'video/mp4');
 PERFORM pg_temp.check_ok((SELECT count(*)=0 FROM public.content_scans WHERE job_id=jvideo),'scan queued video: 0');
 SELECT * INTO c FROM public.claim_content_scans(5,120);
 PERFORM pg_temp.check_ok(c.claim_token IS NOT NULL AND c.attempts=1,'claim: token');
 r:=public.record_content_scan(c.id,gen_random_uuid(),'hold','{}','smoke');
 PERFORM pg_temp.check_ok(r->>'code'='STALE_CLAIM' AND EXISTS(SELECT 1 FROM public.content_scans WHERE id=c.id AND status='scanning'),'stale record: STALE_CLAIM');
 r:=public.record_content_scan(c.id,c.claim_token,'clean','{}','smoke');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND public.get_user_asset(user_auth::text,j1)->>'ok'='true','scan clean: served');
 j2:=pg_temp.image(user_id); PERFORM pg_temp.hold(j2);
 PERFORM pg_temp.check_ok(public.get_user_asset(user_auth::text,j2)->>'code'='HELD'
  AND (SELECT count(*)=1 FROM public.content_reports WHERE source='scanner' AND subject_id=j2 AND status='open'),'scan hold: HELD');
 INSERT INTO public.social_brands(id,owner_user_id,label) VALUES(b,user_id,'smoke');
 INSERT INTO public.social_accounts(id,brand_id,network,external_account_id,access_token_enc) VALUES(ac,b,'threads','123','\x01');
 r:=public.create_social_post(user_auth::text,b,now(),'smoke','held-post-key',ARRAY[ac],jsonb_build_array(jsonb_build_object('job_id',j2,'media_type','image')));
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD','social refuses held: MEDIA_HELD');
 INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES(post,b,user_id,now()-interval '1 minute','smoke-post');
 INSERT INTO public.social_post_media(post_id,"position",media_type,source_job_id) VALUES(post,0,'image',j2);
 INSERT INTO public.social_post_targets(id,post_id,account_id,network) VALUES(target,post,ac,'threads');
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=0 AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND publish_status='pending' AND attempts=0),'social claim skips held: 0');
 UPDATE public.social_post_targets SET publish_status='submitted',next_attempt_at=now(),attempts=1 WHERE id=target;
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=1 AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND attempts=1),'social submitted still polls: 1');
 SELECT claim_key INTO token FROM public.social_post_targets WHERE id=target;
 r:=public.authorize_social_target_dispatch(target,token);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target
  AND publish_status='submitted' AND attempts=1 AND next_attempt_at=now()+interval '5 minutes' AND claim_key IS NULL),'social held continuation backoff: later');
 -- Clean at claim, held immediately afterwards: the decisive authorization catches it.
 UPDATE public.social_post_targets SET publish_status='pending',next_attempt_at=now(),attempts=0,provider_state='{}',claim_key=NULL WHERE id=target;
 UPDATE public.assets SET held_at=NULL WHERE job_id=j2;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 PERFORM public.mark_social_provider_submission(target,claimed.claim_key,'threads');
 UPDATE public.assets SET held_at=now() WHERE job_id=j2;
 r:=public.authorize_social_target_dispatch(target,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND publish_status='pending' AND attempts=0 AND claim_key IS NULL AND provider_state ? 'submission_started'),'social dispatch deferred: MEDIA_HELD');
 r:=public.authorize_social_target_dispatch(target,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='CLAIM_LOST','social deferred repeat: CLAIM_LOST');
 UPDATE public.assets SET held_at=NULL WHERE job_id=j2;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 r:=public.authorize_social_target_dispatch(target,gen_random_uuid());
 PERFORM pg_temp.check_ok(r->>'code'='CLAIM_LOST' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND claim_key=claimed.claim_key),'social stale claim: CLAIM_LOST');
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(target,NULL)->>'code'='CLAIM_KEY_REQUIRED','social null key: CLAIM_KEY_REQUIRED');
 UPDATE public.assets SET held_at=now() WHERE job_id=j2;
 PERFORM public.authorize_social_target_dispatch(target,claimed.claim_key);
 PERFORM public.release_content_hold(admin_auth::text,j2,'reviewed');
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=1,'social release makes due: 1');
 -- Reclaim a crashed publishing target, then hold: release must not wait another 15 minutes.
 UPDATE public.social_post_targets SET claimed_at=now()-interval '16 minutes' WHERE id=target;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 UPDATE public.assets SET held_at=now() WHERE job_id=j2;
 r:=public.authorize_social_target_dispatch(target,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target
  AND publish_status='pending' AND next_attempt_at=now() AND attempts=claimed.attempts-1 AND claim_key IS NULL),'social stale publishing deferral: pending');
 PERFORM public.release_content_hold(admin_auth::text,j2,'reviewed stale claim');
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(claimed.target_id=target);
 -- Model a claim made before 0289 introduced the snapshot columns.
 UPDATE public.social_post_targets SET claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL,provider_state='{"legacy":true}' WHERE id=target;
 UPDATE public.assets SET held_at=now() WHERE job_id=j2;
 r:=public.authorize_social_target_dispatch(target,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND publish_status='pending'
  AND attempts=GREATEST(claimed.attempts-1,0) AND provider_state='{"legacy":true}' AND claim_key IS NULL),'social deferral null snapshot: pending');
 PERFORM public.release_content_hold(admin_auth::text,j2,'reviewed legacy claim');
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 r:=public.report_social_post_progress(target,'{}',now(),claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND publish_status='submitted'
  AND claim_key IS NULL AND claimed_from_status IS NULL AND claimed_attempts IS NULL AND claimed_provider_state IS NULL));
 -- All completion branches clear snapshots; attempts 1 retries, 3 fails, 4 succeeds.
 FOR n IN 1..4 LOOP
  token:=gen_random_uuid();
  UPDATE public.social_post_targets SET publish_status='publishing',attempts=n,claim_key=token,
   claimed_from_status='pending',claimed_attempts=n-1,claimed_provider_state='{}' WHERE id=target;
  r:=public.complete_social_post_target(target,n=4,NULL,NULL,'smoke failure',false,token);
  PERFORM pg_temp.check_ok(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target
   AND claim_key IS NULL AND claimed_from_status IS NULL AND claimed_attempts IS NULL AND claimed_provider_state IS NULL));
 END LOOP;
 -- An image whose scan is still undecided is not posted while the scanner is armed (review of #886).
 jscan:=pg_temp.image(user_id);
 INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES(post2,b,user_id,now()-interval '1 minute','smoke-post-scan');
 INSERT INTO public.social_post_media(post_id,"position",media_type,source_job_id) VALUES(post2,0,'image',jscan);
 INSERT INTO public.social_post_targets(id,post_id,account_id,network) VALUES(target2,post2,ac,'threads');
 UPDATE public.content_scan_monitor SET armed=false,armed_at=NULL WHERE id=1;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(claimed.target_id=target2 AND public.social_post_media_unscanned(post2) IS NOT TRUE,'unscanned, scanner disarmed: claimed');
 UPDATE public.content_scan_monitor SET armed=true,armed_at=now() WHERE id=1;
 r:=public.authorize_social_target_dispatch(target2,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_SCANNING' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target2
  AND publish_status='pending' AND attempts=0 AND claim_key IS NULL),'unscanned, armed: dispatch MEDIA_SCANNING');
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=0,'unscanned, armed: claim skips');
 UPDATE public.content_scans SET status='scanning' WHERE job_id=jscan;
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=0,'scanning, armed: claim skips');
 UPDATE public.content_scans SET queued_at=now()-interval '61 minutes' WHERE job_id=jscan;
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=1,'undecided over an hour, armed: fails open');
 UPDATE public.social_post_targets SET publish_status='pending',claim_key=NULL,claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL,attempts=0 WHERE id=target2;
 UPDATE public.content_scans SET status='clean',decided_at=now(),queued_at=now() WHERE job_id=jscan;
 SELECT count(*) INTO n FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(n=1,'clean scan, armed: claimed');
 UPDATE public.content_scan_monitor SET armed=false,armed_at=NULL WHERE id=1;
 -- Low findings of the #886 review (0350).
 -- A held image is not deleted at its expiry (an unheld one is: asset-expiry.acceptance.test.ts).
 j4:=pg_temp.image(user_id); PERFORM pg_temp.hold(j4);
 UPDATE public.assets SET expires_at=now()-interval '1 day' WHERE job_id=j4;
 PERFORM public.expire_assets(500);
 PERFORM pg_temp.check_ok(EXISTS(SELECT 1 FROM public.assets WHERE job_id=j4),'expiry keeps a held image');
 UPDATE public.assets SET expires_at=now()+interval '90 days' WHERE job_id=j4;
 -- A finished Threads container is reset when its image is held, not polled until Meta expires it.
 UPDATE public.social_post_targets SET publish_status='submitted',attempts=1,next_attempt_at=now(),claim_key=NULL,
  provider_state='{"container_id":"c1","started_at":"2026-01-01T00:00:00Z"}' WHERE id=target2;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 PERFORM pg_temp.check_ok(claimed.target_id=target2,'threads container: claimed');
 UPDATE public.assets SET held_at=now() WHERE job_id=jscan;
 r:=public.authorize_social_target_dispatch(target2,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target2
  AND publish_status='pending' AND attempts=1 AND provider_state='{}' AND claim_key IS NULL),'threads held container: reset to pending');
 UPDATE public.assets SET held_at=NULL WHERE job_id=jscan;
 -- Other networks and a Threads post that may already be sent keep their state.
 UPDATE public.social_post_targets SET publish_status='submitted',attempts=1,next_attempt_at=now(),claim_key=NULL,
  provider_state='{"container_id":"c1","post_id":"p1"}' WHERE id=target2;
 SELECT * INTO claimed FROM public.claim_due_social_post_targets(5);
 UPDATE public.assets SET held_at=now() WHERE job_id=jscan;
 r:=public.authorize_social_target_dispatch(target2,claimed.claim_key);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target2
  AND publish_status='submitted' AND provider_state->>'post_id'='p1'),'threads with a post id: state kept');
 UPDATE public.assets SET held_at=NULL WHERE job_id=jscan;
 -- A deleted account takes no clawback.
 UPDATE public.users SET deleted_at=now() WHERE id=sub_id;
 r:=public.admin_credit_clawback_guarded(admin_auth::text,'aal2',mfa,sub_id,1,'deleted account','deleted-clawback');
 PERFORM pg_temp.check_ok(r->>'code'='ACCOUNT_DELETED','clawback on deleted account: ACCOUNT_DELETED');
 UPDATE public.users SET deleted_at=NULL WHERE id=sub_id;
 jlease:=pg_temp.image(user_id); SELECT * INTO c FROM public.claim_content_scans(5,120); old_token:=c.claim_token;
 UPDATE public.content_scans SET lease_until=now()-interval '1 second' WHERE id=c.id;
 SELECT * INTO c FROM public.claim_content_scans(5,120);
 PERFORM pg_temp.check_ok(c.claim_token<>old_token AND c.attempts=2,'lease expiry: reclaimed');
 UPDATE public.content_scans SET attempts=4,lease_until=now()-interval '1 second' WHERE id=c.id;
 SELECT * INTO c FROM public.claim_content_scans(5,120);
 PERFORM pg_temp.check_ok(c.attempts=5,'attempts cap: fifth lease');
 UPDATE public.content_scans SET lease_until=now()-interval '1 second' WHERE id=c.id;
 SELECT count(*) INTO n FROM public.claim_content_scans(5,120);
 PERFORM pg_temp.check_ok(n=0 AND EXISTS(SELECT 1 FROM public.content_scans WHERE id=c.id AND status='unavailable' AND decided_at IS NOT NULL),'attempts cap: unavailable');
 j3:=pg_temp.image(user_id); PERFORM pg_temp.hold(j3);
 r:=public.admin_held_asset(admin_auth::text,j3);
 PERFORM pg_temp.check_ok(r->>'r2_key'='smoke/'||j3::text AND (SELECT count(*)=1 FROM public.account_actions WHERE job_id=j3 AND action='held_asset_viewed' AND actor_user_id=admin_id),'admin view: logged');
 r:=public.release_content_hold(admin_auth::text,j3,'reviewed clean');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND public.get_user_asset(user_auth::text,j3)->>'ok'='true'
  AND EXISTS(SELECT 1 FROM public.content_reports WHERE subject_id=j3 AND status='resolved'),'release: served');
 r:=public.record_content_scan((SELECT id FROM public.content_scans WHERE job_id=j3),gen_random_uuid(),'hold','{}','late');
 PERFORM pg_temp.check_ok(r->>'replayed'='true' AND public.get_user_asset(user_auth::text,j3)->>'ok'='true','scan replay: true');
 j4:=pg_temp.image(user_id); PERFORM pg_temp.hold(j4);
 r:=public.record_content_violation(admin_auth::text,user_id,j4,'takedown','reviewed violation','smoke-takedown');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.content_scans WHERE job_id=j4 AND asset_id IS NULL)
  AND EXISTS(SELECT 1 FROM public.content_reports WHERE subject_id=j4),'scan hold then takedown: report kept');
 r:=public.release_content_hold(admin_auth::text,j4,'removed by takedown');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND public.get_user_asset(user_auth::text,j4)->>'code'='NOT_FOUND'
  AND EXISTS(SELECT 1 FROM public.content_reports WHERE subject_id=j4 AND status='resolved'),'release after takedown: not served');
 -- Deleted queued assets consume a claim slot without leaving the database.
 jlease:=pg_temp.image(user_id); DELETE FROM public.assets WHERE job_id=jlease;
 SELECT count(*) INTO n FROM public.claim_content_scans(5,120);
 PERFORM pg_temp.check_ok(n=0 AND EXISTS(SELECT 1 FROM public.content_scans WHERE job_id=jlease AND asset_id IS NULL
  AND status='unavailable' AND scores='{"reason":"asset_gone"}' AND decided_at IS NOT NULL AND attempts=0),'scan asset gone: unavailable');
 r:=public.list_content_reports(admin_auth::text,'open',50);
 PERFORM pg_temp.check_ok((r->>'unavailable_scans_24h')::integer=1 AND (r->>'asset_gone_scans_24h')::integer=1);
 -- Deletion after claim is also safe: a late hold records the decision without a report.
 jlease:=pg_temp.image(user_id); SELECT * INTO c FROM public.claim_content_scans(5,120);
 DELETE FROM public.assets WHERE job_id=jlease;
 r:=public.record_content_scan(c.id,c.claim_token,'hold','{"sexual":0.99}','smoke');
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.content_scans WHERE id=c.id AND status='hold' AND asset_id IS NULL)
  AND NOT EXISTS(SELECT 1 FROM public.content_reports WHERE subject_id=jlease),'scan asset gone hold: no report');
 -- Job deletion removes its scans; deleting just an asset above retained them.
 jlease:=pg_temp.image(user_id); DELETE FROM public.assets WHERE job_id=jlease;
 DELETE FROM public.jobs WHERE id=jlease;
 PERFORM pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM public.content_scans WHERE job_id=jlease));
 PERFORM public.arm_content_scan_monitor();
 PERFORM pg_temp.check_ok((SELECT armed FROM public.content_scan_monitor WHERE id=1),'monitor armed: true');
 DELETE FROM public.worker_task_health WHERE task='content_scan';
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=0 AND NOT (summary->'unhealthy_tasks' ? 'content_scan')
  FROM public.recovery_health_snapshot),'monitor first arm: grace');
 UPDATE public.content_scan_monitor SET armed_at=now()-interval '21 minutes' WHERE id=1;
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=1 AND summary->'unhealthy_tasks' ? 'content_scan' FROM public.recovery_health_snapshot),'monitor no heartbeat: overdue');
 PERFORM public.record_worker_task_health('content_scan',true); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=0 AND NOT (summary->'unhealthy_tasks' ? 'content_scan') FROM public.recovery_health_snapshot),'monitor fresh heartbeat: ok');
 UPDATE public.worker_task_health SET last_attempt=now()-interval '21 minutes',last_success=now()-interval '21 minutes' WHERE task='content_scan';
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=1 FROM public.recovery_health_snapshot));
 UPDATE public.worker_task_health SET last_attempt=now(),last_ok=false WHERE task='content_scan';
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=1 AND summary->'unhealthy_tasks' ? 'content_scan'
  FROM public.recovery_health_snapshot),'monitor failing heartbeat: overdue');
 PERFORM public.disarm_content_scan_monitor(admin_auth::text,'flag disabled'); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=0 FROM public.recovery_health_snapshot)
  AND (SELECT NOT (summary->'unhealthy_tasks' ? 'content_scan') FROM public.recovery_health_snapshot)
  AND EXISTS(SELECT 1 FROM public.account_actions WHERE action='scanner_disarmed' AND actor_user_id=admin_id),'monitor disarmed: logged');
 -- Keep a failed, stale heartbeat from the previous armed period.
 UPDATE public.worker_task_health SET last_attempt=now()-interval '21 minutes' WHERE task='content_scan';
 PERFORM public.arm_content_scan_monitor(); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT armed AND armed_at>now()-interval '1 minute' FROM public.content_scan_monitor)
  AND (SELECT (summary->>'content_scan_overdue')::integer=0 AND NOT (summary->'unhealthy_tasks' ? 'content_scan')
   FROM public.recovery_health_snapshot),'monitor rearmed: ok');
 -- Model a heartbeat after re-arming within this transaction's fixed clock.
 UPDATE public.content_scan_monitor SET armed_at=now()-interval '1 second' WHERE id=1;
 PERFORM public.record_worker_task_health('content_scan',false); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=0 AND summary->'unhealthy_tasks' ? 'content_scan'
  FROM public.recovery_health_snapshot),'monitor failed after rearm: unhealthy');
 PERFORM public.record_worker_task_health('content_scan',true); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT NOT (summary->'unhealthy_tasks' ? 'content_scan') FROM public.recovery_health_snapshot));
 -- Additional snapshot assertions: independent of heartbeat freshness, and hidden while disarmed.
 jlease:=pg_temp.image(user_id);
 UPDATE public.content_scans SET queued_at=now()-interval '31 minutes' WHERE job_id=jlease;
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_backlogged')::integer=1 FROM public.recovery_health_snapshot));
 UPDATE public.content_scans SET status='scanning',lease_until=now()-interval '1 second' WHERE job_id=jlease;
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_backlogged')::integer=1 FROM public.recovery_health_snapshot));
 UPDATE public.content_scans SET status='clean',decided_at=now() WHERE job_id=jlease;
 FOR n IN 1..19 LOOP
  jlease:=pg_temp.image(user_id);
  UPDATE public.content_scans SET status='unavailable',decided_at=now() WHERE job_id=jlease;
 END LOOP;
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_exhausted')::integer=0 FROM public.recovery_health_snapshot));
 jlease:=pg_temp.image(user_id);
 UPDATE public.content_scans SET status='unavailable',decided_at=now() WHERE job_id=jlease;
 PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_exhausted')::integer=21 FROM public.recovery_health_snapshot));
 PERFORM public.disarm_content_scan_monitor(admin_auth::text,'test complete'); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_overdue')::integer=0
  AND (summary->>'content_scan_backlogged')::integer=0 AND (summary->>'content_scan_exhausted')::integer=0 FROM public.recovery_health_snapshot));

END $$;
-- Amendment 4: R1-R6 ordering and edge-case assertions.
CREATE FUNCTION pg_temp.person(p_admin BOOLEAN DEFAULT false) RETURNS public.users LANGUAGE plpgsql AS $$
DECLARE a UUID := gen_random_uuid(); u public.users;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(a,a::text||'@test.invalid',now());
 UPDATE public.users SET is_admin=p_admin WHERE auth_id=a::text RETURNING * INTO u;
 RETURN u;
END $$;
CREATE FUNCTION pg_temp.target(p_user UUID,p_job UUID,p_network TEXT DEFAULT 'threads') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE b UUID:=gen_random_uuid(); ac UUID:=gen_random_uuid(); p UUID:=gen_random_uuid(); t UUID:=gen_random_uuid();
BEGIN
 INSERT INTO public.social_brands(id,owner_user_id,label) VALUES(b,p_user,'hardening');
 INSERT INTO public.social_accounts(id,brand_id,network,external_account_id,access_token_enc) VALUES(ac,b,p_network,ac::text,'\x01');
 INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES(p,b,p_user,now()-interval '1 minute',p::text);
 INSERT INTO public.social_post_media(post_id,position,media_type,source_job_id) VALUES(p,0,'image',p_job);
 INSERT INTO public.social_post_targets(id,post_id,account_id,network) VALUES(t,p,ac,p_network);
 RETURN t;
END $$;
CREATE FUNCTION pg_temp.claim(p_target UUID,p_state JSONB DEFAULT '{}',p_network TEXT DEFAULT 'threads',p_current JSONB DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE k UUID:=gen_random_uuid();
BEGIN
 UPDATE public.social_post_targets SET network=p_network,publish_status='publishing',claimed_from_status='submitted',
  claimed_attempts=2,attempts=3,provider_state=coalesce(p_current,p_state),claimed_provider_state=p_state,
  claim_key=k,claimed_at=now(),next_attempt_at=now()+interval '5 minutes' WHERE id=p_target;
 RETURN k;
END $$;
DO $$
DECLARE
 a public.users; u public.users; e public.users; gone_user public.users;
 j UUID; j2 UUID; t UUID; t2 UUID; k UUID; report UUID; upload UUID:=gen_random_uuid();
 r JSONB; saved JSONB; state JSONB; marker TEXT; network TEXT; c RECORD; i INTEGER; n INTEGER;
 signature TEXT; ledger_count BIGINT; action_count BIGINT; balance_before INTEGER; first_key TEXT:=gen_random_uuid()::text;
BEGIN
 a:=pg_temp.person(true); u:=pg_temp.person(); e:=pg_temp.person(); gone_user:=pg_temp.person();
 UPDATE public.content_scan_monitor SET armed=false,armed_at=NULL WHERE id=1;
 -- R1: evidence takes precedence over removed, then released evidence becomes removed.
 j:=pg_temp.image(e.id); t:=pg_temp.target(e.id,j); k:=pg_temp.claim(t,'{}');
 UPDATE public.social_post_targets SET claimed_from_status='pending' WHERE id=t;
 r:=public.record_csam_escalation(a.auth_id,e.id,j,'test preservation',gen_random_uuid()::text);
 PERFORM pg_temp.check_ok(r->>'ok'='true'); saved:=r;
 r:=public.authorize_social_target_dispatch(t,k);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_EVIDENCE_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=t AND publish_status='pending' AND attempts=2 AND claim_key IS NULL),'R1: evidence defers and restores');
 PERFORM public.release_evidence_hold(a.auth_id,(saved->>'action_id')::uuid,'test release');
 k:=pg_temp.claim(t); r:=public.authorize_social_target_dispatch(t,k);
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_REMOVED','R1: released evidence has no usable source');
 j:=pg_temp.image(u.id); t:=pg_temp.target(u.id,j); k:=pg_temp.claim(t);
 DELETE FROM public.assets WHERE job_id=j;
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t,k)->>'code'='MEDIA_REMOVED','R1: removed source defers');
 j2:=pg_temp.image(u.id);
 INSERT INTO public.social_post_media(post_id,position,media_type,source_job_id) SELECT post_id,1,'image',j2 FROM public.social_post_targets WHERE id=t;
 k:=pg_temp.claim(t);
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t,k)->>'code'='MEDIA_REMOVED','R1: one removed carousel source defers');
 t2:=pg_temp.target(u.id,j2); k:=pg_temp.claim(t2);
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t2,k)->>'ok'='true','R1: intact source allowed');
 -- The usable-source predicate also checks ownership and job tombstones.
 UPDATE public.jobs SET user_id=e.id WHERE id=j2; k:=pg_temp.claim(t2);
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t2,k)->>'code'='MEDIA_REMOVED');
 UPDATE public.jobs SET user_id=u.id,deleted_at=now() WHERE id=j2; k:=pg_temp.claim(t2);
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t2,k)->>'code'='MEDIA_REMOVED');
 INSERT INTO public.social_uploads(id,user_id,r2_key,filename,mime_type,size_bytes,status) VALUES(upload,u.id,'smoke/upload/'||upload,'image.png','image/png',100,'ready');
 UPDATE public.social_post_media SET source_job_id=NULL,source_upload_id=upload WHERE post_id=(SELECT post_id FROM public.social_post_targets WHERE id=t2);
 k:=pg_temp.claim(t2);
 PERFORM pg_temp.check_ok(public.authorize_social_target_dispatch(t2,k)->>'ok'='true','R1: upload source allowed');

 -- R2: exact delete count, queue only removed rows, held job refusal and replay.
 j:=pg_temp.image(u.id); j2:=pg_temp.image(u.id);
 UPDATE public.assets SET expires_at=now()-interval '1 day',held_at=CASE WHEN job_id=j2 THEN now() END WHERE job_id IN(j,j2);
 n:=public.expire_assets(500);
 PERFORM pg_temp.check_ok(n=1 AND NOT EXISTS(SELECT 1 FROM public.assets WHERE job_id=j)
  AND EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key='smoke/'||j)
  AND EXISTS(SELECT 1 FROM public.assets WHERE job_id=j2) AND NOT EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key='smoke/'||j2),'R2: expiry deletes and queues only unheld rows');
 PERFORM pg_temp.check_ok(public.expire_assets(500)=0,'R2: expiry replay deletes zero');
 PERFORM pg_temp.check_ok(public.delete_user_job(u.auth_id,j2)->>'code'='ON_HOLD','R2: held job retained');
 PERFORM public.release_content_hold(a.auth_id,j2,'test release');
 r:=public.delete_user_job(u.auth_id,j2);
 PERFORM pg_temp.check_ok(r->>'ok'='true' AND NOT EXISTS(SELECT 1 FROM public.assets WHERE job_id=j2)
  AND (SELECT count(*)=1 FROM public.asset_reap_queue WHERE r2_key='smoke/'||j2),'R2: deleted job queues only deleted asset');
 PERFORM pg_temp.check_ok(public.delete_user_job(u.auth_id,j2)->>'replayed'='true');

 -- R3: frozen refusal changes neither ledger nor balance nor action log; replay precedes it.
 PERFORM public.ledger_grant(u.id,100,'grant:smoke',gen_random_uuid()::text);
 r:=public.admin_credit_clawback_guarded(a.auth_id,'aal2',extract(epoch FROM clock_timestamp())::bigint,u.id,5,'test correction',first_key);
 PERFORM pg_temp.check_ok(r->>'ok'='true');
 PERFORM 1 FROM public.credit_balances WHERE user_id=u.id FOR UPDATE;
 PERFORM public.freeze_account(u.id,'test freeze',NULL);
 SELECT count(*) INTO ledger_count FROM public.ledger_entries WHERE user_id=u.id;
 SELECT count(*) INTO action_count FROM public.account_actions WHERE user_id=u.id;
 SELECT balance INTO balance_before FROM public.credit_balances WHERE user_id=u.id;
 r:=public.admin_credit_clawback_guarded(a.auth_id,'aal2',extract(epoch FROM clock_timestamp())::bigint,u.id,5,'test correction',gen_random_uuid()::text);
 PERFORM pg_temp.check_ok(r->>'code'='ACCOUNT_FROZEN'
  AND (SELECT count(*)=ledger_count FROM public.ledger_entries WHERE user_id=u.id)
  AND (SELECT count(*)=action_count FROM public.account_actions WHERE user_id=u.id)
  AND (SELECT balance=balance_before FROM public.credit_balances WHERE user_id=u.id),'R3: frozen target refused without writes');
 r:=public.admin_credit_clawback_guarded(a.auth_id,'aal2',extract(epoch FROM clock_timestamp())::bigint,u.id,5,'test correction',first_key);
 PERFORM pg_temp.check_ok(r->>'replayed'='true','R3: frozen target applied-key replay preserved');
 r:=public.prepare_account_deletion(gone_user.auth_id);
 PERFORM pg_temp.check_ok(r->>'eligible'='true');
 PERFORM public.erase_account(gone_user.auth_id,r->>'confirmation_token');
 PERFORM pg_temp.check_ok(public.admin_credit_clawback_guarded(a.auth_id,'aal2',extract(epoch FROM clock_timestamp())::bigint,gone_user.id,1,'test correction',gen_random_uuid()::text)->>'code'='ACCOUNT_DELETED','R3: deleted target refused');

 -- R4: all unpublished Meta progress shapes reset on first hold, regardless of snapshot location.
 j:=pg_temp.image(u.id); UPDATE public.assets SET held_at=now() WHERE job_id=j;
 t:=pg_temp.target(u.id,j);
 FOREACH network IN ARRAY ARRAY['threads','instagram'] LOOP
  FOREACH state IN ARRAY ARRAY[jsonb_build_object('container_id','123456','started_at',now()-interval '3 hours'),'{"children":[{"id":"child"}]}'::jsonb,'{"creating":true}'::jsonb] LOOP
   FOR i IN 1..2 LOOP
    k:=pg_temp.claim(t,CASE WHEN i=1 THEN state ELSE '{}'::jsonb END,network,state);
    r:=public.authorize_social_target_dispatch(t,k);
    PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=t
     AND publish_status='pending' AND provider_state='{}' AND attempts=2 AND next_attempt_at<=now() AND claim_key IS NULL));
   END LOOP;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.check_ok(true,'R4: Threads and Instagram containers, children and creating reset');
 FOREACH marker IN ARRAY ARRAY['post_id','submission_started'] LOOP
  state:=jsonb_build_object('container_id','123456',marker,'protected');
  -- Markers present only in the claimed snapshot survive restoration.
  k:=pg_temp.claim(t,state,'instagram','{"container_id":"123456"}');
  PERFORM public.authorize_social_target_dispatch(t,k);
  PERFORM pg_temp.check_ok((SELECT provider_state ? marker AND publish_status='submitted' AND attempts=2 FROM public.social_post_targets WHERE id=t));
  -- Markers written after claiming survive the older snapshot.
  k:=pg_temp.claim(t,'{"container_id":"123456"}','instagram',state);
  PERFORM public.authorize_social_target_dispatch(t,k);
  PERFORM pg_temp.check_ok((SELECT provider_state=state AND publish_status='submitted' AND attempts=2 FROM public.social_post_targets WHERE id=t));
 END LOOP;
 k:=pg_temp.claim(t,'{"container_id":"123456"}','instagram');
 PERFORM public.mark_social_provider_submission(t,k,'instagram');
 PERFORM public.authorize_social_target_dispatch(t,k);
 PERFORM pg_temp.check_ok((SELECT provider_state ? 'submission_started' AND publish_status='submitted' FROM public.social_post_targets WHERE id=t),'R4: current and claimed submission markers preserved');

 -- R5: scanner holds require release; user reports and removed assets still resolve.
 j:=pg_temp.image(a.id);
 -- Drain fixture scans first so the hold helper always finds this job.
 UPDATE public.content_scans SET status='clean',lease_until=NULL,claim_token=NULL WHERE status IN ('queued','scanning') AND job_id<>j;
 PERFORM pg_temp.hold(j);
 SELECT id INTO report FROM public.content_reports WHERE subject_id=j AND source='scanner';
 r:=public.resolve_content_report(a.auth_id,report,'test resolution');
 PERFORM pg_temp.check_ok(r->>'code'='HOLD_ACTIVE' AND EXISTS(SELECT 1 FROM public.content_reports WHERE id=report AND status='open')
  AND EXISTS(SELECT 1 FROM public.assets WHERE job_id=j AND held_at IS NOT NULL),'R5: held scanner report stays open');
 INSERT INTO public.content_reports(reporter_id,subject_kind,subject_id,category,details) VALUES(a.id,'job',j,'other','test report') RETURNING id INTO report;
 PERFORM pg_temp.check_ok(public.resolve_content_report(a.auth_id,report,'test resolution')->>'ok'='true','R5: user report on held job resolves');
 PERFORM public.release_content_hold(a.auth_id,j,'test release');
 SELECT id INTO report FROM public.content_reports WHERE subject_id=j AND source='scanner';
 PERFORM pg_temp.check_ok(public.resolve_content_report(a.auth_id,report,'test resolution')->>'replayed'='true','R5: released scanner report replays');
 j:=pg_temp.image(a.id); PERFORM pg_temp.hold(j);
 SELECT id INTO report FROM public.content_reports WHERE subject_id=j AND source='scanner';
 DELETE FROM public.assets WHERE job_id=j;
 PERFORM pg_temp.check_ok(public.resolve_content_report(a.auth_id,report,'test resolution')->>'ok'='true','R5: removed scanner asset resolves');

 -- R6: deferral returns each attempt once, backoff clamps, stale writers cannot decide.
 UPDATE public.content_scans SET decided_at=now()-interval '2 days' WHERE status='unavailable';
 j:=pg_temp.image(a.id);
 FOR i IN 1..6 LOOP
  SELECT * INTO c FROM public.claim_content_scans(500,120) WHERE id=(SELECT id FROM public.content_scans WHERE job_id=j);
  PERFORM pg_temp.check_ok(c.attempts=1 AND c.claim_token IS NOT NULL);
  SELECT to_jsonb(s) INTO saved FROM public.content_scans s WHERE id=c.id;
  PERFORM pg_temp.check_ok(public.defer_content_scan(c.id,gen_random_uuid(),300)->>'code'='STALE_CLAIM'
   AND (SELECT to_jsonb(s)=saved FROM public.content_scans s WHERE id=c.id));
  r:=public.defer_content_scan(c.id,c.claim_token,CASE i WHEN 1 THEN 1 WHEN 2 THEN 9999 WHEN 3 THEN NULL ELSE 300 END);
  PERFORM pg_temp.check_ok(r->>'ok'='true' AND (r->>'backoff_seconds')::integer=CASE i WHEN 1 THEN 30 WHEN 2 THEN 1800 ELSE 300 END
   AND EXISTS(SELECT 1 FROM public.content_scans WHERE id=c.id AND status='scanning' AND attempts=0 AND claim_token IS NULL AND lease_until>clock_timestamp()));
  SELECT to_jsonb(s) INTO saved FROM public.content_scans s WHERE id=c.id;
  PERFORM pg_temp.check_ok(public.defer_content_scan(c.id,c.claim_token,300)->>'code'='STALE_CLAIM');
  PERFORM pg_temp.check_ok(public.defer_content_scan(c.id,NULL,300)->>'code'='STALE_CLAIM');
  PERFORM pg_temp.check_ok(public.record_content_scan(c.id,c.claim_token,'clean','{}','test')->>'code'='STALE_CLAIM');
  PERFORM pg_temp.check_ok((SELECT to_jsonb(s)=saved FROM public.content_scans s WHERE id=c.id));
  PERFORM pg_temp.check_ok((SELECT count(*)=0 FROM public.claim_content_scans(500,120)));
  IF i=1 THEN
   PERFORM public.arm_content_scan_monitor();
   PERFORM public.record_worker_task_health('content_scan',false);
   PERFORM public.refresh_recovery_health();
   PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_backlogged')::integer>=1 FROM public.recovery_health_snapshot),'R6: deferred scan visible during backoff');
  END IF;
  UPDATE public.content_scans SET lease_until=now()-interval '1 second' WHERE id=c.id;
 END LOOP;
 SELECT * INTO c FROM public.claim_content_scans(500,120) WHERE id=(SELECT id FROM public.content_scans WHERE job_id=j);
 PERFORM pg_temp.check_ok(c.attempts=1 AND public.record_content_scan(c.id,c.claim_token,'clean','{}','test')->>'ok'='true','R6: six deferrals retain the per-image budget');
 PERFORM pg_temp.check_ok(public.defer_content_scan(c.id,c.claim_token,300)->>'code'='STALE_CLAIM');
 PERFORM pg_temp.check_ok(public.defer_content_scan(gen_random_uuid(),gen_random_uuid(),300)->>'code'='STALE_CLAIM');
 PERFORM public.record_worker_task_health('content_scan',true); PERFORM public.refresh_recovery_health();
 PERFORM pg_temp.check_ok((SELECT (summary->>'content_scan_claimable')::integer=0 AND (summary->>'content_scan_backlogged')::integer=0 AND NOT (summary->'unhealthy_tasks' ? 'content_scan') FROM public.recovery_health_snapshot),'R6: successful recovery clears scan health');
 FOREACH signature IN ARRAY ARRAY['expire_assets(integer)','authorize_social_target_dispatch(uuid,uuid)','admin_credit_clawback_guarded(text,text,bigint,uuid,integer,text,text)','delete_user_job(text,uuid)','resolve_content_report(text,uuid,text)','defer_content_scan(uuid,uuid,integer)','refresh_recovery_health()'] LOOP
  PERFORM pg_temp.check_ok(has_function_privilege('service_role','public.'||signature,'EXECUTE')
   AND NOT has_function_privilege('anon','public.'||signature,'EXECUTE')
   AND NOT has_function_privilege('authenticated','public.'||signature,'EXECUTE'));
 END LOOP;
 PERFORM pg_temp.check_ok(true,'amendment 4 RPC permissions: service only');
 PERFORM pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM public.reconcile_balances()) AND NOT EXISTS(SELECT 1 FROM public.reconcile_free_credits())
  AND NOT EXISTS(SELECT 1 FROM public.reconcile_subscription_credits()),'amendment 4 reconcile: 0/0/0');
END $$;

SELECT message FROM smoke_output ORDER BY n;
ROLLBACK;
