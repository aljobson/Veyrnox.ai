-- 0367 — Supplier routes, phase 0 (ADR-0256): the tables only.
--
-- model_routes lists the ways to serve one catalog offer (supplier, endpoint,
-- recorded cost, priority 1 to 3, state, provenance, parity record, health).
-- job_attempts will log each dispatch attempt of a job. Nothing reads or
-- writes either table yet: dispatch still uses model_catalog.provider and
-- provider_endpoint, so this migration changes no behaviour a customer sees.
--
-- Backfill: one priority-1 `active` route per active supplier-backed offer,
-- copied from the catalog row. Chat (text) rows, Clip Editor and the composite
-- pipelines are not routed (ADR-0256, "what is not decided here").
-- Provenance below is an initial placeholder for the owner to review:
-- fal, openrouter and byteplus `official`; kie and grsai `licensed_reseller`.
--
-- Service-role only: forced RLS, no policies, explicit revokes (CLAUDE.md).
-- Idempotent: IF NOT EXISTS, ON CONFLICT DO NOTHING, REVOKE/GRANT re-run.
-- Rollback: DROP TABLE public.job_attempts, public.model_routes (both empty of
-- anything but the backfill).

BEGIN;

CREATE TABLE IF NOT EXISTS public.model_routes (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id              TEXT        NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    supplier              TEXT        NOT NULL CHECK (supplier IN ('fal', 'kie', 'grsai', 'byteplus', 'openrouter')),
    endpoint              TEXT        NOT NULL,
    cost_per_unit         NUMERIC(10, 4) NOT NULL CHECK (cost_per_unit >= 0),
    cost_unit             TEXT        NOT NULL DEFAULT 'per_generation',
    billing_seconds       NUMERIC(6, 2) NULL,
    priority              SMALLINT    NOT NULL CHECK (priority BETWEEN 1 AND 3),
    state                 TEXT        NOT NULL DEFAULT 'standby' CHECK (state IN ('active', 'standby', 'disabled')),
    provenance            TEXT        NOT NULL CHECK (provenance IN ('official', 'licensed_reseller', 'unverified')),
    parity_record         TEXT        NULL,
    margin_waiver_note    TEXT        NULL,
    daily_spend_cap_cents INTEGER     NULL CHECK (daily_spend_cap_cents IS NULL OR daily_spend_cap_cents >= 0),
    consecutive_failures  INTEGER     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    breaker_opened_at     TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id, priority),
    UNIQUE (model_id, supplier, endpoint),
    -- An active route that is not the offer's own current dispatch needs evidence.
    CHECK (state <> 'active' OR parity_record IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.job_attempts (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    attempt_no            SMALLINT    NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
    route_id              UUID        NOT NULL REFERENCES public.model_routes(id) ON DELETE RESTRICT,
    supplier_job_id       TEXT        NULL,
    outcome               TEXT        NULL CHECK (outcome IS NULL OR outcome IN ('submitted', 'completed', 'failed', 'abandoned', 'ambiguous')),
    cost_snapshot         NUMERIC(10, 4) NOT NULL CHECK (cost_snapshot >= 0),
    spend_reservation_id  UUID        NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS job_attempts_route_supplier_job_idx
    ON public.job_attempts (route_id, supplier_job_id) WHERE supplier_job_id IS NOT NULL;

ALTER TABLE public.model_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.model_routes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.job_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.model_routes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.job_attempts TO service_role;

-- One priority-1 route per active supplier-backed offer, copied from the catalog.
INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT c.id, c.provider, c.provider_endpoint, c.provider_cost_per_unit, c.cost_unit, c.billing_seconds,
       1, 'active',
       CASE c.provider WHEN 'kie' THEN 'licensed_reseller' WHEN 'grsai' THEN 'licensed_reseller' ELSE 'official' END,
       'current dispatch (0367 backfill)'
  FROM public.model_catalog c
 WHERE c.active
   AND c.provider IN ('fal', 'kie', 'grsai', 'byteplus', 'openrouter')
   AND c.modality <> 'text'
   AND c.id NOT IN ('clip-edit', 'auto-short-32s', 'video-agent')
ON CONFLICT (model_id, priority) DO NOTHING;

-- Every routed offer has exactly one route after the backfill, and it mirrors the catalog.
DO $$
DECLARE drift BIGINT;
BEGIN
    SELECT count(*) INTO drift
      FROM public.model_routes r
      JOIN public.model_catalog c ON c.id = r.model_id
     WHERE r.priority = 1 AND r.parity_record = 'current dispatch (0367 backfill)'
       AND (r.supplier <> c.provider OR r.endpoint <> c.provider_endpoint OR r.cost_per_unit <> c.provider_cost_per_unit);
    IF drift <> 0 THEN
        RAISE EXCEPTION 'supplier route backfill drifted from the catalog on % rows', drift;
    END IF;
END $$;

COMMIT;
