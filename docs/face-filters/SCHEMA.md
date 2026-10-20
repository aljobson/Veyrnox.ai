# Backend Schema — Face Filters & Media Authenticity

**Status:** Updated 2026-10-20 against local `origin/main` at `4ccfbd2a1d4b39c8e20db9a0c5269ddab8f908bd`; the Face Filters sources are identical in this checkout (`cf1573bf`). Activation is **merged; production application not verified from the repo**.
**Reads with:** [TRD.md](TRD.md), `packages/db/schema/0001_initial.sql`, [../../CLAUDE.md](../../CLAUDE.md)

*Status 2026-10-08: still true for Track A's own work (no filter table or column exists). Other work since has added columns to the tables below; the main ones are listed in the notes. For the full current schema see `docs/product/SCHEMA.md`.*

Track A adds **no tables and no columns**. This document records the existing
shape an agent must work within, then the one new table Track B would need.

**Current catalog state (2026-10-20, `4ccfbd2a`):** 0356 stages A1-A5;
0357 activates A1 `face-retouch`, A2 `face-enhance`, A4 `face-makeup` and A5
`face-age`, each at 3 credits / $0.0400 recorded provider cost. A3 `face-relight`
stays inactive at 7 credits / $0.1000: the unpinned probe billed 2 MP ($0.20);
a run with the pinned 1000×1000 canvas is still required. A6 is not staged;
A7/A8 are absent and blocked by PRD §6. These are migration states, not a
production read. The web uses Studio models and the per-slot `SourcePickers`
upload field; **a Transform mode does not exist**. Web and phone Tools entries
come from the active catalog. The dedicated phone flow is
[planned until the build PR merges](../mobile/spec/FACE-FILTERS.md).

**Upload admission:** `lib/uploadAdmission.js` has no enrolled matching provider.
`UPLOAD_HASH_MATCH_REQUIRED` is absent from the production vars in the checked-in
`wrangler.jsonc` (default off), while `UPLOAD_INTEGRITY_ENABLED` and
`UPLOAD_REQUEST_RATE_LIMIT_ENABLED` are `"true"`. These are repository settings,
not verified deployed values. Requiring hash matching now fails closed:
`upload_admission_unavailable` at upload issuance, `source_not_admitted` when
resolving an uploaded source for a generation. This seam is not a scanner and
catalog activation does not establish that the public-upload admission gate is met.

## 1. Authentication flow

Supabase Auth is the only identity source. Providers: email/password, Apple,
Google *(2026-10-08: plus passkey sign-in, ADR-0032)*.

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
*2026-10-08: gained `rights_attested_at` and `rights_attestation_version` (0146). `plan` was reported unused in the 2026-10-02 audit (ISSUES S14).*

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | internal identity; every FK points here |
| `auth_id` | TEXT UNIQUE | `auth.users.id::text`; no cross-schema FK |
| `email` | TEXT | |
| `plan` | TEXT | default `free` |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Not modified by the filter catalog migrations. `auth_id`, not the internal
`users.id`, prefixes upload keys.

### `credit_balances`
*2026-10-08: also carries `subscription_balance` (ADR-0064, 0183/0184); the invariant is now `free_balance + subscription_balance <= balance`.*

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
*2026-10-08: gained `consent_attested_at` (0096, set once by `job_consent_attested`) and other columns; the state list below matches `lib/jobState.js`. Public reads map only `STORED` to `succeeded`; `SUCCEEDED` still means output storage is running. `refunded: true` requires `REFUNDED`.*

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
*2026-10-08: `modality` values `image-to-image` and `video-to-video` already exist in the catalog (0086, 0088, 0089, 0090, 0221). That historical no-row status is superseded by 0356/0357: five Track A rows, four activated in migrations. The table also has `cost_unit`, `billing_seconds` and `free_allowance_per_day` (ADR-0069) among others.*

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | lowercase slug, `^[a-z0-9][a-z0-9.-]{0,63}$` |
| `name` | TEXT | display name |
| `provider` | TEXT | `fal` |
| `provider_endpoint` | TEXT | the fal endpoint id |
| `modality` | TEXT | existing values include `image-to-image`, `video-to-video`; A1-A5 use `image-to-image` |
| `credits_5s` | INTEGER | `CHECK > 0`; price per output, or per 5s of video |
| `provider_cost_per_unit` | NUMERIC(10,4) | A1/A2/A4/A5: 0.0400, billed evidence recorded in 0357; A3: 0.1000 list-price assumption, pinned run unverified |
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

*2026-10-20: `lib/uploadSweep.js` runs on the five-minute cron: 24-hour age sweep and consumed-source cleanup after terminal jobs, guarded by a 16-minute job age. Cleanup timing is best effort.* Holds **results only**. `job_stored` called by `lib/falWebhookHandler.js` inserts the result asset
(0077 adds its SHA-256), making it automatically available in Library. No extra
Library-save API call is required. A user's uploaded source is not an asset row — it has no
job, no output, and a different retention need. It lives in R2 under
`uploads/{auth_id}/{uuid}.{ext}` and is swept by prefix and age.

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
| `uploads/{auth_id}/{uuid}.{ext}` | user-supplied sources *(new)* | presigned PUT | short, swept by age |
| existing result prefix | generated outputs | `copyUrlToR2` | ADR-0008 retention |

Ownership is checkable from the key because `auth_id` is in the path. A
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

Both catalog migrations are merged under `packages/db/schema/supabase/`:

1. `0356_face_filters_staged.sql`: A1-A5 inserted inactive with
   `ON CONFLICT (id) DO NOTHING`; replay preserves later activation/repricing.
2. `0357_activate_face_filters.sql`: activates only A1/A2/A4/A5, pinning endpoint,
   provider, modality, cost unit, ungated state, previous inactive state, 3 credits
   and $0.0400. It requires exactly four updated rows and raises otherwise.
   **It is not an independently replayable no-op** after activation; the migration
   ledger controls application. A3 remains inactive at 7 credits / $0.1000.

Production application is not verified from the repo. A successful manual
apply-migrations dispatch alone does not prove the live row state. Future
migrations take the next free number after checking main and open PRs; production
application uses the owner-approved workflow (ADR-0023).
