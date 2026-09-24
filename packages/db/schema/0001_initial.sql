-- Phase 1 initial migration.
-- Target: Postgres 15+. (Production is Supabase Postgres in Frankfurt,
-- per ADR-0006; this file only builds a local/test database.)
-- Tables: users, credit_balances, ledger_entries, jobs, model_catalog,
-- assets, webhook_events. Outbox is intentionally absent: the provider webhook plus
-- webhook_events dedupe replaced it. (An earlier header credited Inngest,
-- which this system has never used.)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------
-- users — shadow row per Supabase-issued identity. Supabase Auth holds the auth
-- record; we hold everything else keyed on this UUID.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- auth_id: Supabase auth.users.id::text. We keep a shadow row for
    -- FK targets (jobs, ledger_entries, etc.). No cross-schema FK — the
    -- users.created webhook is the sync point.
    auth_id         TEXT        NOT NULL UNIQUE,
    email           TEXT        NOT NULL,
    plan            TEXT        NOT NULL DEFAULT 'free',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_auth_id_idx  ON users (auth_id);
CREATE INDEX IF NOT EXISTS users_email_idx    ON users (email);

-- --------------------------------------------------------------------
-- credit_balances — materialised view of SUM(ledger_entries.delta).
-- Kept in the same transaction as every ledger append so `balance`
-- and `SUM(delta)` never diverge. Reconciled nightly.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_balances (
    user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance     INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------
-- ledger_entries — append-only. delta can be positive (grant, refund)
-- or negative (debit). No UPDATE or DELETE — enforced by trigger.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    delta       INTEGER     NOT NULL,
    reason      TEXT        NOT NULL,
    job_id      UUID        NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_user_id_idx    ON ledger_entries (user_id, created_at);
CREATE INDEX IF NOT EXISTS ledger_entries_job_id_idx     ON ledger_entries (job_id) WHERE job_id IS NOT NULL;

-- Enforce append-only at the DB layer — application code cannot bypass.
CREATE OR REPLACE FUNCTION ledger_entries_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

-- --------------------------------------------------------------------
-- jobs — one row per generation request. Created in the same txn as
-- the debit ledger entry. State machine per §25.7.
-- --------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE job_state AS ENUM (
    'PRICED',         -- Priced, awaiting debit
    'DEBITED',        -- Credits debited, ready to submit
    'SUBMITTED',      -- Sent to primary provider
    'SUCCEEDED',      -- Provider returned success
    'FAILOVER',       -- Primary failed, retry on fallback
    'FAILED',         -- Both providers failed
    'REFUNDED',       -- Auto-refunded after FAILED
    'STORED'          -- Result copied to R2 (terminal success)
);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS jobs (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key   TEXT        NOT NULL,
    model_id          TEXT        NOT NULL,
    credits           INTEGER     NOT NULL CHECK (credits > 0),
    state             job_state   NOT NULL DEFAULT 'PRICED',
    provider          TEXT        NULL,
    provider_job_id   TEXT        NULL,
    error_code        TEXT        NULL,
    inputs            JSONB       NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_state_idx    ON jobs (state) WHERE state NOT IN ('STORED', 'REFUNDED', 'FAILED');
CREATE INDEX IF NOT EXISTS jobs_user_id_idx  ON jobs (user_id, created_at DESC);

-- --------------------------------------------------------------------
-- model_catalog — normative for pricing (§25.2). Read-mostly.
-- Seeded from platform_model_v2.xlsx via scripts/seed-catalog.mjs
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_catalog (
    id                        TEXT        PRIMARY KEY,
    name                      TEXT        NOT NULL,
    provider                  TEXT        NOT NULL,
    provider_endpoint         TEXT        NOT NULL,
    modality                  TEXT        NOT NULL,
    credits_5s                INTEGER     NOT NULL CHECK (credits_5s > 0),
    provider_cost_per_unit    NUMERIC(10, 4) NOT NULL,
    gated_flag                BOOLEAN     NOT NULL DEFAULT false,
    active                    BOOLEAN     NOT NULL DEFAULT true,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_catalog_provider_idx ON model_catalog (provider, active);

-- --------------------------------------------------------------------
-- assets — R2 objects tied to a job. Retention swept per plan.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    r2_key         TEXT        NOT NULL UNIQUE,
    mime_type      TEXT        NOT NULL,
    size_bytes     BIGINT      NOT NULL,
    expires_at     TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_job_id_idx  ON assets (job_id);
CREATE INDEX IF NOT EXISTS assets_expires_idx ON assets (expires_at) WHERE expires_at IS NOT NULL;

-- --------------------------------------------------------------------
-- webhook_events — idempotency table for provider + billing webhooks.
-- Every incoming webhook writes here first; duplicates bail early.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source         TEXT        NOT NULL,
    external_id    TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    processed_at   TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx ON webhook_events (source, created_at)
    WHERE processed_at IS NULL;

COMMIT;
