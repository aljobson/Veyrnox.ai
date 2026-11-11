-- 0492: row-level immutable evidence must also refuse statement-level TRUNCATE.
-- UPDATE/DELETE triggers do not run for TRUNCATE, so protect the three Music
-- append-only tables with the repository's shared guard.

DROP TRIGGER IF EXISTS music_download_claims_no_truncate ON public.music_download_claims;
CREATE TRIGGER music_download_claims_no_truncate
BEFORE TRUNCATE ON public.music_download_claims
FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

DROP TRIGGER IF EXISTS music_publication_attestations_no_truncate ON public.music_publication_attestations;
CREATE TRIGGER music_publication_attestations_no_truncate
BEFORE TRUNCATE ON public.music_publication_attestations
FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

DROP TRIGGER IF EXISTS music_rights_attestations_no_truncate ON public.music_rights_attestations;
CREATE TRIGGER music_rights_attestations_no_truncate
BEFORE TRUNCATE ON public.music_rights_attestations
FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();
