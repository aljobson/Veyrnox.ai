# Backend Schema — Face Filters & Media Authenticity

**Status:** Draft · 2026-09-18
**Reads with:** [TRD.md](TRD.md), `packages/db/schema/0001_initial.sql`, [../../CLAUDE.md](../../CLAUDE.md)

Track A adds **no tables and no columns**. This document records the existing
shape an agent must work within, then the one new table Track B would need.

## 1. Authentication flow

Supabase Auth is the only identity source. Providers: email/password, Apple,
Google.

```
Browser                    Supabase Auth              Worker                 Postgres
   │                            │                       │                       │
   ├─ sign in ─────────────────►│                       │                       │
   │◄─ ES256 JWT + refresh ─────┤                       │                       │
   │   stored in localStorage   │                       │                       │
   │   ['veyrnox_supabase_session']                     │                       │
   │                            │                       │                       │
   ├─ Bearer JWT ──────────────────────────────────────►│                       │
   │                            │   middleware.js:      │                       │
   │                            │   verify ES256 via    │                       │
   │                            │   JWKS + Web Crypto;  │                       │
   │                            │   check iss, aud,     │                       │
   │                            │   exp (5s skew), sub  │                       │
   │                            │                       │                       │
   │                            │   sets, overwriting   │                       │
   │                            │   any inbound value:  │                       │
   │                            │   x-veyrnox-auth-id   │                       │
   │                            │   x-veyrnox-auth-email│                       │
   │                            │   x-veyrnox-auth-role │                       │
   │                            │                       ├─ service-role ───────►│
   │◄──────────────────────────────────────────────────┤                       │
```

The browser never talks to Postgres. The Worker uses the service-role key, which
bypasses RLS by design — RLS is the second line, not the first.

Provisioning is trigger-only. `auth.users → public.users + credit_balances` via
migrations `0010` and `0071`. The `grant:signup` credit follows
`email_confirmed_at` being set, not row creation. No code path may insert a
`public.users` row directly.

## 2. Existing tables — what filters touch

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | internal identity; every FK points here |
| `auth_id` | TEXT UNIQUE | `auth.users.id::text`; no cross-schema FK |
| `email` | TEXT | |
| `plan` | TEXT | default `free` |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Not modified. Supplies the `user_id` that prefixes every upload key.

### `credit_balances`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID PK → `users.id` | |
| `balance` | INTEGER | `CHECK (balance >= 0)`; equals `SUM(ledger_entries.delta)` |
| `free_balance` | INTEGER | added later; `0 <= free_balance <= balance` |
| `updated_at` | TIMESTAMPTZ | |

Not modified. Moved only by RPC.

### `ledger_entries` — append-only
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID → `users.id` ON DELETE RESTRICT | |
| `delta` | INTEGER | negative debit, positive grant or refund |
| `free_delta` | INTEGER | the part of `delta` that moved Free Credits |
| `reason` | TEXT | |
| `job_id` | UUID NULL | links a debit to its job |
| `created_at` | TIMESTAMPTZ | |

UPDATE and DELETE raise via trigger `ledger_entries_append_only`. A filter debit
is an ordinary row — same reason format, same refund path. No new reason vocabulary.

### `jobs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID → `users.id` ON DELETE RESTRICT | |
| `idempotency_key` | TEXT | `UNIQUE (user_id, idempotency_key)` |
| `model_id` | TEXT | the catalog row |
| `credits` | INTEGER | `CHECK (credits > 0)` |
| `state` | `job_state` enum | PRICED · DEBITED · SUBMITTED · SUCCEEDED · FAILOVER · FAILED · REFUNDED · STORED |
| `provider`, `provider_job_id` | TEXT NULL | |
| `error_code` | TEXT NULL | |
| `inputs` | JSONB | validated against `ALLOWED_INPUTS` before write |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

**A filter job stores the R2 key of its source in `inputs`, never the presigned
URL.** A signed URL in a durable column is a credential that outlives its use.
The enum is unchanged — a filter moves through exactly the same states.

### `model_catalog` — normative for pricing
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | lowercase slug, `^[a-z0-9][a-z0-9.-]{0,63}$` |
| `name` | TEXT | display name |
| `provider` | TEXT | `fal` |
| `provider_endpoint` | TEXT | the fal endpoint id |
| `modality` | TEXT | **new values:** `image-to-image`, `video-to-video` |
| `credits_5s` | INTEGER | `CHECK > 0`; price per output, or per 5s of video |
| `provider_cost_per_unit` | NUMERIC(10,4) | measured, not estimated |
| `gated_flag` | BOOLEAN | |
| `active` | BOOLEAN | false until the endpoint is verified live |
| `updated_at` | TIMESTAMPTZ | |

Each filter is one row. `modality` is a free-text column, so the new values need
no DDL — but `kindOf()` and `priceFor()` must be pinned by tests first (TRD §5).

### `assets`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID → `jobs.id` ON DELETE CASCADE | |
| `r2_key` | TEXT UNIQUE | random UUID path, never user-controlled |
| `mime_type` | TEXT | |
| `size_bytes` | BIGINT | |
| `expires_at` | TIMESTAMPTZ NULL | retention sweep |
| `created_at` | TIMESTAMPTZ | |

Holds **results only**. A user's uploaded source is not an asset row — it has no
job, no output, and a different retention need. It lives in R2 under
`uploads/{user_id}/{uuid}` and is swept by prefix and age.

### `webhook_events`
`UNIQUE (source, external_id)`. Filter completions arrive on the existing fal
webhook and dedupe through this table unchanged.

## 3. Relationships

```
users 1──1 credit_balances
users 1──* ledger_entries        (job_id links a debit to its job)
users 1──* jobs
jobs  1──* assets                (results only)
model_catalog 1──* jobs          (by model_id, no FK — catalog rows outlive jobs)
```

## 4. R2 key layout

| Prefix | Contents | Written by | Lifetime |
|--------|----------|-----------|----------|
| `uploads/{user_id}/{uuid}` | user-supplied sources *(new)* | presigned PUT | short, swept by age |
| existing result prefix | generated outputs | `copyUrlToR2` | ADR-0008 retention |

Ownership is checkable from the key because `user_id` is in the path. A
presigned GET on an upload is minted only when the path segment matches the
caller's `x-veyrnox-auth-id`.

## 5. Track B — the one new table

Not to be created until Track B's ADR is accepted.

A verdict cannot be an `assets` row: `assets` describes an R2 object with a MIME
type and a byte count. A verdict is a score, a label, and a model version.

```sql
-- SKETCH. Do not apply. Blocked on the Track B ADR.
CREATE TABLE IF NOT EXISTS authenticity_checks (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    verdict        TEXT        NOT NULL,   -- 'likely_synthetic' | 'likely_authentic' | 'inconclusive'
    confidence     NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    detector       TEXT        NOT NULL,   -- vendor + model version, for later re-assessment
    detail         JSONB       NOT NULL,   -- vendor payload, never rendered raw
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Whichever shape is chosen must satisfy the standing rules: RLS enabled and
forced, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE
... TO service_role` naming full signatures, `SET search_path = ''` on any
SECURITY DEFINER function, and an idempotency key on any state-changing RPC.

## 6. Migrations

Filters need at most two files, both idempotent, both
`packages/db/schema/supabase/NNNN_<snake_case>.sql`:

1. The catalog rows — `INSERT ... ON CONFLICT (id) DO UPDATE`, inserted with
   `active = false`.
2. The activation — flips `active = true` only for endpoints that returned a
   real output on a live call, with measured `provider_cost_per_unit`.

Two files, not one, because activation is evidence-gated and the Seedance cycle
(migrations 0045–0057) is what happens when it is not.

Take the next free number on `main` and check open PRs first. Production
migrations are applied only by the `apply-migrations` workflow (ADR-0023).
