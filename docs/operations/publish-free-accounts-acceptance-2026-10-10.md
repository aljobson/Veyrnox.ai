# Free multi-account Publish — acceptance and rollout

The owner revised Publish on 10 October: basic scheduling is free across several
accounts, paid tiers unlock advanced features. Five free active connections per
user is the initial bounded implementation choice. Old account-based prices are
superseded in ADR-0062/0063; no new premium price or feature entitlement is active.

## Change

Migration 0265 adds `record_social_multi_account_connection`, with a fixed cap
shared across owned brands and the existing per-user advisory lock. An already
active account can refresh even if historical connections leave a user over the
cap; a revoked account needs a free slot. Tokens remain encrypted/server-only,
ownership and current Auth are checked, and audit actions remain recorded.
Generation Credits and billing are untouched.

The Worker selects that writer only for the exact server variable
`PUBLISH_MULTI_ACCOUNT_ENABLED=true`. The original one-account writer remains
valid, preserving the previous release while the migration is deployed. Account
reads expose the selected free allowance; the screen uses it to disable another
connection at the cap. OAuth, destination-selection and Bluesky errors explain
the five-account boundary without an upgrade prompt. Both environment flags
initially remain false. Existing released-network/app-review and upload gates
are still separate prerequisites.

## Evidence

- All 245 SQL migrations replayed on a fresh disposable local PostgreSQL 17.11
  database. The migration also replayed twice inside a rolled-back transaction.
- `scripts/test-social-free-multi-account.mjs` passed five free connections,
  sixth denial, cross-brand enforcement, existing/revoked/grandfathered reconnect,
  ownership/current-Auth and real role denial, security-definer search path,
  unchanged ledger/buckets and all seven zero reconciliation checks.
- Two independent database connections competed for the fifth slot: exactly
  one succeeded, the other received `ACCOUNT_LIMIT`, and five accounts remained.
  Synthetic concurrency fixtures are committed only to the disposable local DB.
- Callback route tests cover selection of the new writer and the typed limit;
  the browser client preserves that limit. Account response tests refuse a
  client-header cap override and keep the old allowance for non-exact flags.
- Reticle returned **`verified: yes`, `verifiedReason: proved`, net grade** for
  a running local Next 16.3.8 journey: five-account connection disabled, confirm
  disconnect, captured DELETE response `{ok:true}`, connection re-enabled and
  cap message removed. Saved `free-publish-disconnect-slot` has an asserted
  consequence and business intent. The auth store was visible; no console errors
  appeared during that final journey.
- Reticle also verified the five-account callback error and return to Publish.
  Browser API responses and identity were **synthetic fixtures**, not real social
  connections. SQL enforcement was independently tested against PostgreSQL.
  This does not establish real OAuth/provider acceptance or production launch.

Reticle's initial verification setup errors and unread/duplicate capture windows
were corrected before the final net-grade verdict; unknown results were not
counted as passes. Dev-only instrumentation remains outside the feature commit.

Final local unit/API suite: 2,750 tests, 2,749 passed and one skipped. Lint:
zero errors and 75 warnings. Security typecheck, client credential
boundary and migration numbering passed. CI and build results must be read
from the resulting PR; local checks do not stand in for them.

## Before activation

1. Merge after CI/review. Apply exact 0265 to staging with a migration receipt.
2. Approve the exact protected `production-database` workflow after merge
   (ADR-0023); check production receipt, function privileges and zero drift.
3. Keep the new production path off through its relevant 24-hour clean window.
   Inspect actual retained watcher runs and gaps, not merely elapsed time.
4. Repeat signed-in acceptance with designated real test accounts on already
   released platforms; verify the cap, reconnect/disconnect and scheduler.
5. Activate the reviewed server flag, deploy, and verify the actual public
   account/API behavior and existing scheduled-post completion. Rollback the
   flag to retain the original writer; do not delete connected accounts.

Advanced paid features/billing, extended provider approvals and IWF upload
coverage remain separate work. This slice alone does not complete roadmap B3
or the full production rollout.
