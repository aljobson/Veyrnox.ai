BEGIN;

-- The switch is intentionally installed off. Enabling it is a separate
-- operational action after the Anthropic secret and child-safety provider exist.
CREATE TABLE IF NOT EXISTS public.cinema_moderation_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  upload_content_required BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.cinema_moderation_config(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;
ALTER TABLE public.cinema_moderation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_moderation_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_moderation_config FROM PUBLIC,anon,authenticated,service_role;

-- One immutable classification for the exact quarantined bytes. A retry must
-- reproduce the same result rather than rewriting prior evidence.
CREATE TABLE IF NOT EXISTS public.cinema_upload_content_checks (
  upload_id       UUID PRIMARY KEY REFERENCES public.cinema_uploads(id) ON DELETE RESTRICT,
  verdict         TEXT NOT NULL CHECK (verdict IN ('passed','flagged','unavailable')),
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  provider        TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  model           TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 120),
  details         JSONB NOT NULL CHECK (jsonb_typeof(details)='object' AND octet_length(details::TEXT)<=8192),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_upload_content_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_upload_content_checks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_upload_content_checks FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cinema_upload_content_checks_append_only ON public.cinema_upload_content_checks;
CREATE TRIGGER cinema_upload_content_checks_append_only BEFORE UPDATE OR DELETE ON public.cinema_upload_content_checks
  FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();
DROP TRIGGER IF EXISTS cinema_upload_content_checks_no_truncate ON public.cinema_upload_content_checks;
CREATE TRIGGER cinema_upload_content_checks_no_truncate BEFORE TRUNCATE ON public.cinema_upload_content_checks
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

CREATE OR REPLACE FUNCTION public.set_cinema_content_moderation_required(p_required BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_required IS NULL THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SETTING'); END IF;
  UPDATE public.cinema_moderation_config SET upload_content_required=p_required,updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('ok',true,'required',p_required);
END $$;

CREATE OR REPLACE FUNCTION public.record_cinema_upload_content_check(
  p_upload_id UUID,p_claim_token UUID,p_verdict TEXT,p_sha256 TEXT,p_provider TEXT,p_model TEXT,p_details JSONB,
  p_sniffed_mime TEXT,p_scanner_version TEXT,p_malware_details JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cinema_malware_scans%ROWTYPE; old public.cinema_upload_content_checks%ROWTYPE;
BEGIN
  IF p_verdict NOT IN ('passed','flagged','unavailable') OR p_sha256 !~ '^[a-f0-9]{64}$'
    OR p_provider IS NULL OR length(btrim(p_provider)) NOT BETWEEN 1 AND 80
    OR p_model IS NULL OR length(btrim(p_model)) NOT BETWEEN 1 AND 120
    OR p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::TEXT)>8192
    OR p_sniffed_mime NOT IN ('video/mp4','video/webm','video/quicktime')
    OR p_scanner_version IS NULL OR length(p_scanner_version) NOT BETWEEN 1 AND 160
    OR p_malware_details IS NULL OR jsonb_typeof(p_malware_details)<>'object' OR octet_length(p_malware_details::TEXT)>8192
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT'); END IF;
  SELECT * INTO v FROM public.cinema_malware_scans WHERE upload_id=p_upload_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SCAN_NOT_FOUND'); END IF;
  SELECT * INTO old FROM public.cinema_upload_content_checks WHERE upload_id=p_upload_id;
  IF FOUND THEN
    IF old.verdict=p_verdict AND old.evidence_sha256=p_sha256 AND old.provider=btrim(p_provider) AND old.model=btrim(p_model)
    THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
    RETURN jsonb_build_object('ok',false,'code','RESULT_CONFLICT');
  END IF;
  IF v.status<>'scanning' OR p_claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_claim_token OR v.lease_until<=clock_timestamp()
    OR v.sha256 IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.cinema_uploads u WHERE u.id=p_upload_id AND u.state='provisioning')
  THEN RETURN jsonb_build_object('ok',false,'code','STALE_CLAIM'); END IF;
  INSERT INTO public.cinema_upload_content_checks(upload_id,verdict,evidence_sha256,provider,model,details)
    VALUES(p_upload_id,p_verdict,p_sha256,btrim(p_provider),btrim(p_model),p_details);
  IF p_verdict<>'passed' THEN
    INSERT INTO public.cinema_malware_scan_events(upload_id,verdict,sha256,sniffed_mime,scanner_version,details)
      VALUES(p_upload_id,'passed',p_sha256,p_sniffed_mime,p_scanner_version,p_malware_details);
    UPDATE public.cinema_malware_scans SET status='passed',sha256=p_sha256,sniffed_mime=p_sniffed_mime,
      scanner_version=p_scanner_version,details=p_malware_details,claim_token=NULL,lease_until=NULL,decided_at=now() WHERE upload_id=p_upload_id;
    UPDATE public.cinema_uploads SET state='error',upload_url=NULL WHERE id=p_upload_id AND state='provisioning';
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;

-- Preserve the existing exact-byte transaction and add the content-evidence
-- predicate when the operational switch is on.
CREATE OR REPLACE FUNCTION public.prepare_cinema_scanned_upload(
  p_upload_id UUID,p_claim_token UUID,p_sha256 TEXT,p_sniffed_mime TEXT,p_scanner_version TEXT,p_details JSONB,p_uid TEXT,p_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cinema_malware_scans%ROWTYPE; u public.cinema_uploads%ROWTYPE; required BOOLEAN;
BEGIN
  IF p_sha256 !~ '^[a-f0-9]{64}$' OR p_sniffed_mime NOT IN ('video/mp4','video/webm','video/quicktime')
    OR p_scanner_version IS NULL OR length(p_scanner_version) NOT BETWEEN 1 AND 160 OR p_details IS NULL OR jsonb_typeof(p_details)<>'object'
    OR octet_length(p_details::TEXT)>8192 OR p_uid !~ '^[A-Za-z0-9]{32}$' OR length(p_url)>2048 OR p_url !~ '^https://(upload[.]videodelivery[.]net|upload[.]cloudflarestream[.]com)/'
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT'); END IF;
  SELECT upload_content_required INTO required FROM public.cinema_moderation_config WHERE singleton;
  SELECT * INTO v FROM public.cinema_malware_scans WHERE upload_id=p_upload_id FOR UPDATE;
  SELECT * INTO u FROM public.cinema_uploads WHERE id=p_upload_id FOR UPDATE;
  IF v.upload_id IS NULL OR u.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SCAN_NOT_FOUND'); END IF;
  IF v.status='passed' AND u.stream_uid=p_uid THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
  IF coalesce(required,false) AND NOT EXISTS(SELECT 1 FROM public.cinema_upload_content_checks c
      WHERE c.upload_id=p_upload_id AND c.verdict='passed' AND c.evidence_sha256=p_sha256)
  THEN RETURN jsonb_build_object('ok',false,'code','CONTENT_CHECK_REQUIRED'); END IF;
  IF v.status<>'scanning' OR p_claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_claim_token OR v.lease_until<=clock_timestamp()
    OR u.state<>'provisioning' OR u.stream_uid IS NOT NULL OR u.file_size<>v.expected_size
  THEN RETURN jsonb_build_object('ok',false,'code','STALE_CLAIM'); END IF;
  INSERT INTO public.cinema_malware_scan_events(upload_id,verdict,sha256,sniffed_mime,scanner_version,details)
    VALUES(p_upload_id,'passed',p_sha256,p_sniffed_mime,p_scanner_version,p_details);
  UPDATE public.cinema_malware_scans SET status='passed',sha256=p_sha256,sniffed_mime=p_sniffed_mime,
    scanner_version=p_scanner_version,details=p_details,claim_token=NULL,lease_until=NULL,decided_at=now() WHERE upload_id=p_upload_id;
  UPDATE public.cinema_uploads SET stream_uid=p_uid,upload_url=p_url,state='uploading' WHERE id=p_upload_id;
  RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;

CREATE TABLE IF NOT EXISTS public.cinema_submission_moderation_jobs (
  submission_id UUID PRIMARY KEY REFERENCES public.cinema_submissions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scanning','passed','flagged','unavailable')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  claim_token UUID NULL,
  lease_until TIMESTAMPTZ NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS cinema_submission_moderation_queue_idx ON public.cinema_submission_moderation_jobs(status,queued_at,submission_id);
ALTER TABLE public.cinema_submission_moderation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_submission_moderation_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_submission_moderation_jobs FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.queue_cinema_submission_moderation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN INSERT INTO public.cinema_submission_moderation_jobs(submission_id) VALUES(NEW.submission_id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cinema_queue_submission_moderation ON public.cinema_safety_checks;
CREATE TRIGGER cinema_queue_submission_moderation AFTER INSERT ON public.cinema_safety_checks
  FOR EACH ROW EXECUTE FUNCTION public.queue_cinema_submission_moderation();
INSERT INTO public.cinema_submission_moderation_jobs(submission_id)
  SELECT s.id FROM public.cinema_submissions s JOIN public.cinema_safety_checks c ON c.submission_id=s.id
  WHERE s.status='pending' AND c.content_status='pending' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_cinema_submission_moderation(p_lease_seconds INTEGER)
RETURNS TABLE(submission_id UUID,claim_token UUID,title TEXT,synopsis TEXT,language TEXT,ai_disclosures TEXT[],
  audience_rating TEXT,content_warnings TEXT[],evidence_sha256 TEXT,evidence JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cinema_submission_moderation_jobs%ROWTYPE; s public.cinema_submissions%ROWTYPE; c public.cinema_content%ROWTYPE;
  all_malware BOOLEAN; all_content BOOLEAN; any_content_flagged BOOLEAN; digest TEXT; proof JSONB;
BEGIN
  SELECT x.* INTO j FROM public.cinema_submission_moderation_jobs x JOIN public.cinema_submissions sub ON sub.id=x.submission_id
    WHERE sub.status='pending' AND (x.status='queued' OR (x.status='scanning' AND x.lease_until<now()))
    ORDER BY x.queued_at,x.submission_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO s FROM public.cinema_submissions WHERE id=j.submission_id FOR UPDATE;
  SELECT * INTO c FROM public.cinema_content WHERE id=s.content_id;
  SELECT coalesce(bool_and(ms.status='passed' AND ms.sha256 IS NOT NULL),false),
    coalesce(bool_and(uc.verdict='passed' AND uc.evidence_sha256=ms.sha256),false),
    coalesce(bool_or(uc.verdict='flagged'),false),
    encode(pg_catalog.sha256(convert_to(coalesce(string_agg(ms.sha256,',' ORDER BY u.id::TEXT),''),'UTF8')),'hex'),
    coalesce(jsonb_agg(jsonb_build_object('upload_id',u.id,'sha256',ms.sha256,'classification',uc.details) ORDER BY u.id),'[]'::JSONB)
  INTO all_malware,all_content,any_content_flagged,digest,proof
  FROM public.cinema_uploads u LEFT JOIN public.cinema_malware_scans ms ON ms.upload_id=u.id
    LEFT JOIN public.cinema_upload_content_checks uc ON uc.upload_id=u.id
  WHERE u.state='ready' AND u.content_id IN (SELECT public.cinema_title_rows(s.content_id));
  IF NOT all_malware OR NOT all_content THEN
    INSERT INTO public.cinema_safety_check_events(submission_id,check_kind,verdict,provider,evidence_sha256,details)
      VALUES(s.id,'malware',CASE WHEN all_malware THEN 'passed' ELSE 'unavailable' END,'veyrnox-upload-gate',digest,jsonb_build_object('reason','upload_evidence')),
        (s.id,'content',CASE WHEN any_content_flagged THEN 'flagged' ELSE 'unavailable' END,'veyrnox-upload-gate',digest,jsonb_build_object('reason','upload_evidence'));
    UPDATE public.cinema_safety_checks SET malware_status=CASE WHEN all_malware THEN 'passed' ELSE 'unavailable' END,
      content_status=CASE WHEN any_content_flagged THEN 'flagged' ELSE 'unavailable' END,updated_at=now() WHERE public.cinema_safety_checks.submission_id=s.id;
    UPDATE public.cinema_submission_moderation_jobs SET status=CASE WHEN any_content_flagged THEN 'flagged' ELSE 'unavailable' END,decided_at=now() WHERE public.cinema_submission_moderation_jobs.submission_id=s.id;
    RETURN;
  END IF;
  INSERT INTO public.cinema_safety_check_events(submission_id,check_kind,verdict,provider,evidence_sha256,details)
    VALUES(s.id,'malware','passed','veyrnox-upload-gate',digest,jsonb_build_object('reason','all_title_uploads_passed'));
  UPDATE public.cinema_safety_checks SET malware_status='passed',updated_at=now() WHERE public.cinema_safety_checks.submission_id=s.id;
  IF j.attempts>=3 THEN
    INSERT INTO public.cinema_safety_check_events(submission_id,check_kind,verdict,provider,evidence_sha256,details)
      VALUES(s.id,'content','unavailable','anthropic',digest,'{"reason":"attempts_exhausted"}'::JSONB);
    UPDATE public.cinema_safety_checks SET content_status='unavailable',updated_at=now() WHERE public.cinema_safety_checks.submission_id=s.id;
    UPDATE public.cinema_submission_moderation_jobs SET status='unavailable',claim_token=NULL,lease_until=NULL,decided_at=now() WHERE public.cinema_submission_moderation_jobs.submission_id=s.id;
    RETURN;
  END IF;
  RETURN QUERY UPDATE public.cinema_submission_moderation_jobs x SET status='scanning',attempts=x.attempts+1,
    claim_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,900),1800)))
    WHERE x.submission_id=s.id RETURNING x.submission_id,x.claim_token,c.title,c.synopsis,c.language,c.ai_disclosures,
      s.audience_rating,s.content_warnings,digest,proof;
END $$;

CREATE OR REPLACE FUNCTION public.record_cinema_submission_content_moderation(
  p_submission_id UUID,p_claim_token UUID,p_verdict TEXT,p_model TEXT,p_evidence_sha256 TEXT,p_details JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cinema_submission_moderation_jobs%ROWTYPE;
BEGIN
  IF p_verdict NOT IN ('passed','flagged','unavailable') OR p_model IS NULL OR length(btrim(p_model)) NOT BETWEEN 1 AND 120
    OR p_evidence_sha256 !~ '^[a-f0-9]{64}$' OR p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::TEXT)>8192
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT'); END IF;
  SELECT * INTO j FROM public.cinema_submission_moderation_jobs WHERE submission_id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); END IF;
  IF j.status IN ('passed','flagged','unavailable') THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
  IF j.status<>'scanning' OR p_claim_token IS NULL OR j.claim_token IS DISTINCT FROM p_claim_token OR j.lease_until<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.cinema_submissions s WHERE s.id=p_submission_id AND s.status='pending')
  THEN RETURN jsonb_build_object('ok',false,'code','STALE_CLAIM'); END IF;
  INSERT INTO public.cinema_safety_check_events(submission_id,check_kind,verdict,provider,model,evidence_sha256,details)
    VALUES(p_submission_id,'content',p_verdict,'anthropic',btrim(p_model),p_evidence_sha256,p_details);
  UPDATE public.cinema_safety_checks SET content_status=p_verdict,updated_at=now() WHERE submission_id=p_submission_id;
  UPDATE public.cinema_submission_moderation_jobs SET status=p_verdict,claim_token=NULL,lease_until=NULL,decided_at=now() WHERE submission_id=p_submission_id;
  RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.set_cinema_content_moderation_required(BOOLEAN),
  public.record_cinema_upload_content_check(UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,JSONB),
  public.queue_cinema_submission_moderation(),
  public.claim_cinema_submission_moderation(INTEGER),public.record_cinema_submission_content_moderation(UUID,UUID,TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_cinema_content_moderation_required(BOOLEAN),
  public.record_cinema_upload_content_check(UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,JSONB),
  public.claim_cinema_submission_moderation(INTEGER),public.record_cinema_submission_content_moderation(UUID,UUID,TEXT,TEXT,TEXT,JSONB)
  TO service_role;

COMMIT;
