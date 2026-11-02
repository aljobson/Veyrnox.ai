-- ADR-0322: stored support only. No email delivery or agent invocation.
CREATE TABLE IF NOT EXISTS public.support_tickets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
 email TEXT NOT NULL CHECK(length(email)<=320), subject TEXT NOT NULL CHECK(length(btrim(subject)) BETWEEN 1 AND 200),
 category TEXT NOT NULL CHECK(category IN ('billing','account','generation','other')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','solved')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
 assignee UUID REFERENCES public.users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_created ON public.support_tickets(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_created ON public.support_tickets(status,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.support_intake_receipts (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 idem_key TEXT NOT NULL CHECK(idem_key ~ '^[A-Za-z0-9._-]{8,128}$'),
 request JSONB NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,idem_key)
);
ALTER TABLE public.support_intake_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_intake_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_intake_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.support_messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('user','admin','agent')), author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
 author_label TEXT NOT NULL CHECK(length(author_label)<=320), body TEXT NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 5000), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_created ON public.support_messages(ticket_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.support_agent_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
 agent_name TEXT NOT NULL CHECK(agent_name ~ '^[a-z0-9_-]{1,64}$'),
 action TEXT NOT NULL CHECK(action IN ('classify','draft','reply','escalate','resolve')),
 summary TEXT NOT NULL CHECK(length(summary)<=200 AND (summary='[erased]' OR summary ~ '^ticket=[0-9a-f-]{36};status=(open|pending|solved);action=(classify|draft|reply|escalate|resolve)$')),
 outcome TEXT NOT NULL CHECK(outcome IN ('completed','refused','failed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 idem_key TEXT NOT NULL UNIQUE CHECK(idem_key ~ '^[A-Za-z0-9._-]{8,128}$')
);
CREATE INDEX IF NOT EXISTS support_tickets_assignee_idx ON public.support_tickets(assignee);
CREATE INDEX IF NOT EXISTS support_messages_author_idx ON public.support_messages(author_user_id);
CREATE INDEX IF NOT EXISTS support_agent_runs_ticket_idx ON public.support_agent_runs(ticket_id);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_agent_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets,public.support_messages,public.support_agent_runs FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.support_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_user TEXT:=current_setting('veyrnox.support_erasing',true); v_allowed BOOLEAN:=false;
BEGIN
 -- A parent hard-delete may only null the author FK; it cannot edit the reply.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='support_messages' THEN
  IF OLD.author_user_id IS NOT NULL AND NEW.author_user_id IS NULL
   AND to_jsonb(NEW)-'author_user_id'=to_jsonb(OLD)-'author_user_id'
   AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.author_user_id) THEN
   NEW.author_label:='[erased]';
   RETURN NEW;
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND v_user IS NOT NULL AND v_user<>'' THEN
  IF TG_TABLE_NAME='support_messages' THEN
   v_allowed := (EXISTS(SELECT 1 FROM public.support_tickets WHERE id=OLD.ticket_id AND user_id::text=v_user)
     AND NEW.body='[erased]' AND NEW.author_label='[erased]' AND to_jsonb(NEW)-ARRAY['body','author_label']=to_jsonb(OLD)-ARRAY['body','author_label'])
    OR (OLD.author_user_id::text=v_user AND NEW.author_user_id IS NULL AND NEW.author_label='[erased]'
     AND NEW.body=CASE WHEN OLD.author_kind='admin' THEN OLD.body ELSE '[erased]' END
     AND to_jsonb(NEW)-ARRAY['body','author_label','author_user_id']=to_jsonb(OLD)-ARRAY['body','author_label','author_user_id']);
  ELSE
   v_allowed := EXISTS(SELECT 1 FROM public.support_tickets WHERE id=OLD.ticket_id AND user_id::text=v_user)
     AND NEW.summary='[erased]' AND to_jsonb(NEW)-'summary'=to_jsonb(OLD)-'summary';
  END IF;
 END IF;
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION '% is append-only (attempted TRUNCATE)', TG_TABLE_NAME USING ERRCODE='42501'; END IF;
 IF NOT coalesce(v_allowed,false) THEN RAISE EXCEPTION 'append_only' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.support_append_only() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS support_messages_append_only ON public.support_messages;
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON public.support_messages FOR EACH ROW EXECUTE FUNCTION private.support_append_only();
DROP TRIGGER IF EXISTS support_messages_no_truncate ON public.support_messages;
CREATE TRIGGER support_messages_no_truncate BEFORE TRUNCATE ON public.support_messages FOR EACH STATEMENT EXECUTE FUNCTION private.support_append_only();
DROP TRIGGER IF EXISTS support_agent_runs_append_only ON public.support_agent_runs;
CREATE TRIGGER support_agent_runs_append_only BEFORE UPDATE OR DELETE ON public.support_agent_runs FOR EACH ROW EXECUTE FUNCTION private.support_append_only();
DROP TRIGGER IF EXISTS support_agent_runs_no_truncate ON public.support_agent_runs;
CREATE TRIGGER support_agent_runs_no_truncate BEFORE TRUNCATE ON public.support_agent_runs FOR EACH STATEMENT EXECUTE FUNCTION private.support_append_only();
CREATE OR REPLACE FUNCTION private.erase_support_for_user(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_previous TEXT:=current_setting('veyrnox.support_erasing',true);
BEGIN
 PERFORM set_config('veyrnox.support_erasing',p_user::text,true);
 DELETE FROM public.support_intake_receipts WHERE user_id=p_user;
 UPDATE public.support_messages SET body='[erased]',author_label='[erased]'
  WHERE ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id=p_user);
 -- Replies in someone else's thread belong to that support history. Remove the
 -- departing admin's identity, keeping the reply; user-authored text is erased.
 UPDATE public.support_messages SET author_user_id=NULL,author_label='[erased]',
  body=CASE WHEN author_kind='admin' THEN body ELSE '[erased]' END WHERE author_user_id=p_user;
 UPDATE public.support_agent_runs SET summary='[erased]' WHERE ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id=p_user);
 UPDATE public.support_tickets SET email='[erased]',subject='[erased]',user_id=NULL WHERE user_id=p_user;
 PERFORM set_config('veyrnox.support_erasing',coalesce(v_previous,''),true);
END $$;
REVOKE ALL ON FUNCTION private.erase_support_for_user(UUID) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.support_user_erasure()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM private.erase_support_for_user(OLD.id); RETURN OLD; END IF;
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN PERFORM private.erase_support_for_user(NEW.id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.support_user_erasure() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS support_user_erasure ON public.users;
CREATE TRIGGER support_user_erasure AFTER UPDATE OF deleted_at ON public.users FOR EACH ROW EXECUTE FUNCTION private.support_user_erasure();
DROP TRIGGER IF EXISTS support_user_hard_erasure ON public.users;
CREATE TRIGGER support_user_hard_erasure BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION private.support_user_erasure();

CREATE OR REPLACE FUNCTION public.support_ticket_create(p_auth_id UUID,p_subject TEXT,p_category TEXT,p_body TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; v_request JSONB; v_seen public.support_intake_receipts%ROWTYPE; v_id UUID; v_result JSONB;
BEGIN
 IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 200 OR p_subject ~ '[[:cntrl:]]'
  OR p_category IS NULL OR p_category NOT IN ('billing','account','generation','other') OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 5000
  OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(431,0);
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id::text FOR UPDATE;
 IF u.id IS NULL OR u.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_authenticated'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.runtime_switches WHERE key='support_intake' AND state='on') THEN RETURN jsonb_build_object('ok',false,'code','support_unavailable'); END IF;
 -- Hash the private text; receipt/audit must not become an unerasable copy.
 v_request:=jsonb_build_object('area','support','action','intake','digest',encode(sha256(convert_to(jsonb_build_array(p_subject,p_category,p_body)::text,'UTF8')),'hex'));
 SELECT * INTO v_seen FROM public.support_intake_receipts WHERE user_id=u.id AND idem_key=p_idem_key;
 IF FOUND THEN
  IF v_seen.request<>v_request THEN RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused'); END IF;
  RETURN v_seen.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.support_tickets WHERE user_id=u.id AND created_at>clock_timestamp()-interval '30 seconds') THEN RETURN jsonb_build_object('ok',false,'code','rate_limited'); END IF;
 IF (SELECT count(*) FROM public.support_tickets WHERE user_id=u.id AND status<>'solved')>=5 THEN RETURN jsonb_build_object('ok',false,'code','ticket_limit'); END IF;
 INSERT INTO public.support_tickets(user_id,email,subject,category,created_at,updated_at) VALUES(u.id,u.email,btrim(p_subject),p_category,clock_timestamp(),clock_timestamp()) RETURNING id INTO v_id;
 INSERT INTO public.support_messages(ticket_id,author_kind,author_user_id,author_label,body) VALUES(v_id,'user',u.id,u.email,btrim(p_body));
 v_result:=jsonb_build_object('ok',true,'ticket_id',v_id,'status','open');
 INSERT INTO public.support_intake_receipts(idem_key,user_id,request,result) VALUES(p_idem_key,u.id,v_request,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.support_ticket_create(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_ticket_create(UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_support_list(p_auth_id UUID,p_status TEXT DEFAULT NULL,p_before JSONB DEFAULT NULL,p_limit INT DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows JSONB; v_at TIMESTAMPTZ; v_id UUID;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'support');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_status IS NOT NULL AND p_status NOT IN ('open','pending','solved')) THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 IF p_before IS NOT NULL THEN
  IF jsonb_typeof(p_before)<>'object' OR NOT p_before ?& ARRAY['created_at','id'] OR p_before-ARRAY['created_at','id']<>'{}' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
  v_at:=(p_before->>'created_at')::timestamptz;v_id:=(p_before->>'id')::uuid;
  IF v_at IS NULL OR NOT isfinite(v_at) OR v_id IS NULL THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id DESC),'[]') INTO v_rows FROM (
  SELECT * FROM public.support_tickets WHERE (p_status IS NULL OR status=p_status) AND (p_before IS NULL OR (created_at,id)<(v_at,v_id)) ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) t;
 RETURN jsonb_build_object('ok',true,'tickets',v_rows,'next',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object('created_at',v_rows->-1->'created_at','id',v_rows->-1->'id') ELSE NULL END,
  'intake',EXISTS(SELECT 1 FROM public.runtime_switches WHERE key='support_intake' AND state='on'));
END $$;
REVOKE ALL ON FUNCTION public.admin_support_list(UUID,TEXT,JSONB,INT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_list(UUID,TEXT,JSONB,INT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_support_get(p_auth_id UUID,p_ticket UUID,p_before JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.support_tickets%ROWTYPE; v_messages JSONB; v_at TIMESTAMPTZ; v_id UUID;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'support');
 IF p_ticket IS NULL THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 IF p_before IS NOT NULL THEN
  IF jsonb_typeof(p_before)<>'object' OR NOT p_before ?& ARRAY['created_at','id'] OR p_before-ARRAY['created_at','id']<>'{}' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
  v_at:=(p_before->>'created_at')::timestamptz;v_id:=(p_before->>'id')::uuid;
  IF v_at IS NULL OR NOT isfinite(v_at) OR v_id IS NULL THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket;
 IF t.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ticket_not_found'); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC,m.id DESC),'[]') INTO v_messages FROM (
  SELECT id,author_kind,author_label,body,created_at FROM public.support_messages WHERE ticket_id=p_ticket AND (p_before IS NULL OR (created_at,id)<(v_at,v_id)) ORDER BY created_at DESC,id DESC LIMIT 100
 ) m;
 RETURN jsonb_build_object('ok',true,'ticket',to_jsonb(t),'messages',v_messages,'next',CASE WHEN jsonb_array_length(v_messages)=100 THEN jsonb_build_object('created_at',v_messages->-1->'created_at','id',v_messages->-1->'id') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.admin_support_get(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_get(UUID,UUID,JSONB) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_support_agent_log(p_auth_id UUID,p_ticket UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows JSONB;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'support');
 IF p_ticket IS NULL THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id DESC),'[]') INTO v_rows FROM (
 SELECT id,agent_name,action,summary,outcome,created_at FROM public.support_agent_runs WHERE ticket_id=p_ticket ORDER BY created_at DESC,id DESC LIMIT 100
 ) t;
 RETURN jsonb_build_object('ok',true,'runs',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.admin_support_agent_log(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_agent_log(UUID,UUID) TO service_role;

-- Internal implementation; no service-role EXECUTE. Exported RPCs each check permissions.
CREATE OR REPLACE FUNCTION public.admin_support_mutate(p_auth_id UUID,p_ticket UUID,p_action TEXT,p_value TEXT,p_reason TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_user UUID; t public.support_tickets%ROWTYPE; v_seen public.admin_mutation_receipts%ROWTYPE;
 v_request JSONB; v_result JSONB; v_change UUID; v_message UUID; v_after JSONB; v_email TEXT;
BEGIN
 PERFORM public.admin_require_permission(p_auth_id::text,'support.write');
 IF p_ticket IS NULL OR p_action IS NULL OR p_action NOT IN ('reply','status','assign') OR p_reason IS DISTINCT FROM 'support-'||p_action
  OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$'
  OR (p_action='reply' AND (p_value IS NULL OR length(btrim(p_value)) NOT BETWEEN 1 AND 5000))
  OR (p_action='status' AND (p_value IS NULL OR p_value NOT IN ('open','pending','solved')))
  OR (p_action='assign' AND p_value IS NOT NULL AND p_value !~ '^[0-9a-fA-F-]{36}$') THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(431,0);
 SELECT id,email INTO v_actor,v_email FROM public.users WHERE auth_id=p_auth_id::text AND is_admin AND deleted_at IS NULL AND frozen_at IS NULL FOR SHARE;
 PERFORM 1 FROM auth.users WHERE id=p_auth_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 PERFORM public.admin_require_permission(p_auth_id::text,'support.write');
 IF v_actor IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO v_user FROM public.support_tickets WHERE id=p_ticket;
 PERFORM 1 FROM public.users WHERE id=v_user FOR SHARE; -- Serialize with erasure before locking a ticket.
 SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
 IF t.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ticket_not_found'); END IF;
 v_request:=jsonb_build_object('area','support','action',p_action,'ticket',p_ticket,'digest',encode(sha256(convert_to(coalesce(p_value,'<unassigned>'),'UTF8')),'hex'));
 SELECT * INTO v_seen FROM public.admin_mutation_receipts WHERE actor_user_id=v_actor AND idem_key=p_idem_key;
 IF FOUND THEN
  IF v_seen.actor_user_id<>v_actor OR v_seen.request<>v_request THEN RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused'); END IF;
  RETURN v_seen.result;
 END IF;
 IF t.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ticket_erased'); END IF;
 IF p_action='reply' THEN
  INSERT INTO public.support_messages(ticket_id,author_kind,author_user_id,author_label,body) VALUES(t.id,'admin',v_actor,v_email,btrim(p_value)) RETURNING id INTO v_message;
  UPDATE public.support_tickets SET updated_at=now() WHERE id=t.id;
 ELSIF p_action='status' THEN UPDATE public.support_tickets SET status=p_value,updated_at=now() WHERE id=t.id;
 ELSE
  IF p_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u JOIN public.admin_roles r ON r.user_id=u.id WHERE u.id=p_value::uuid AND u.is_admin AND u.deleted_at IS NULL AND r.role IN ('owner','support')) THEN RETURN jsonb_build_object('ok',false,'code','assignee_invalid'); END IF;
  UPDATE public.support_tickets SET assignee=p_value::uuid,updated_at=now() WHERE id=t.id;
 END IF;
 SELECT jsonb_build_object('status',status,'assignee',assignee,'message_id',v_message) INTO v_after FROM public.support_tickets WHERE id=t.id;
 INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
 VALUES(v_actor,v_email,'support',p_action,t.id::text,jsonb_build_object('status',t.status,'assignee',t.assignee),v_after,p_reason) RETURNING id INTO v_change;
 v_result:=jsonb_build_object('ok',true,'ticket_id',t.id,'change_id',v_change,'message_id',v_message);
 INSERT INTO public.admin_mutation_receipts(idem_key,actor_user_id,request,result) VALUES(p_idem_key,v_actor,v_request,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_support_mutate(UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.admin_support_reply(p_auth_id UUID,p_ticket UUID,p_body TEXT,p_reason TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.admin_require_permission(p_auth_id::text,'support.write');RETURN public.admin_support_mutate(p_auth_id,p_ticket,'reply',p_body,p_reason,p_idem_key);END $$;
REVOKE ALL ON FUNCTION public.admin_support_reply(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_reply(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_support_set_status(p_auth_id UUID,p_ticket UUID,p_status TEXT,p_reason TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.admin_require_permission(p_auth_id::text,'support.write');RETURN public.admin_support_mutate(p_auth_id,p_ticket,'status',p_status,p_reason,p_idem_key);END $$;
REVOKE ALL ON FUNCTION public.admin_support_set_status(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_set_status(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_support_assign(p_auth_id UUID,p_ticket UUID,p_assignee UUID,p_reason TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.admin_require_permission(p_auth_id::text,'support.write');RETURN public.admin_support_mutate(p_auth_id,p_ticket,'assign',p_assignee::text,p_reason,p_idem_key);END $$;
REVOKE ALL ON FUNCTION public.admin_support_assign(UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_support_assign(UUID,UUID,UUID,TEXT,TEXT) TO service_role;

-- Machine ingest, records only; neither invokes an agent nor sends a reply.
CREATE OR REPLACE FUNCTION public.support_agent_record(p_ticket UUID,p_agent TEXT,p_action TEXT,p_outcome TEXT,p_idem_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.support_tickets%ROWTYPE; v_user UUID; v_run public.support_agent_runs%ROWTYPE; v_id UUID;
BEGIN
 IF p_ticket IS NULL OR p_agent IS NULL OR p_agent !~ '^[a-z0-9_-]{1,64}$' OR p_action IS NULL OR p_action NOT IN ('classify','draft','reply','escalate','resolve')
  OR p_outcome IS NULL OR p_outcome NOT IN ('completed','refused','failed') OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(431,0);
 SELECT user_id INTO v_user FROM public.support_tickets WHERE id=p_ticket;
 PERFORM 1 FROM public.users WHERE id=v_user FOR SHARE;
 SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
 IF t.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ticket_not_found'); END IF;
 SELECT * INTO v_run FROM public.support_agent_runs WHERE idem_key=p_idem_key;
 IF FOUND THEN
  IF (v_run.ticket_id,v_run.agent_name,v_run.action,v_run.outcome) IS DISTINCT FROM (p_ticket,p_agent,p_action,p_outcome) THEN RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused'); END IF;
  RETURN jsonb_build_object('ok',true,'run_id',v_run.id);
 END IF;
 IF t.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ticket_erased'); END IF;
 INSERT INTO public.support_agent_runs(ticket_id,agent_name,action,summary,outcome,idem_key)
 VALUES(t.id,p_agent,p_action,'ticket='||t.id::text||';status='||t.status||';action='||p_action,p_outcome,p_idem_key) RETURNING id INTO v_id;
 RETURN jsonb_build_object('ok',true,'run_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.support_agent_record(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_agent_record(UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
