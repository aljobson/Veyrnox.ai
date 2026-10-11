-- Run on a freshly replayed vx_loop. Fixtures and all audit rows roll back.
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
 PERFORM pg_temp.check_ok(r->>'code'='MEDIA_HELD' AND EXISTS(SELECT 1 FROM public.social_post_targets WHERE id=target AND publish_status='pending' AND attempts=0 AND claim_key IS NULL AND provider_state='{}'),'social dispatch deferred: MEDIA_HELD');
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
 -- Model a claim made before 0286 introduced the snapshot columns.
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
SELECT message FROM smoke_output ORDER BY n;
ROLLBACK;
