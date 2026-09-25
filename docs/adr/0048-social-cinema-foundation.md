# ADR-0048 — Additive Social Cinema identity foundation

Status: Proposed for the foundation PR, 25 September 2026. Tracks #320.

## Decision

Keep the existing Next/Workers application and Supabase identity. The existing
Auth triggers remain the only way to provision public.users and balances.
Social Cinema profiles are opt-in, not created on signup. Creating one cannot
change signup credits, balances, existing admin membership or login behavior.
Use the repository's numbered migration location, not the source pack's new
supabase/migrations layout. No mobile repository or application move is needed
for this database-only foundation.

The source pack proposes direct RLS CRUD. Retain the current server API
boundary instead: browser roles receive no table/function access. New tables
have forced RLS and no client policies (deny by default); narrowly granted
security-definer RPCs implement approved reads and creation. Direct service-role
table writes are revoked too. Service-role-only functions necessarily trust the
server to supply the verified JWT subject, never a client-provided user id.
Future routes must use the existing middleware and overwrite identity headers.
No new HTTP endpoint is exposed by this slice.

A profile has its own random public id, unique lowercase username, display
name and bio. Its internal user mapping and creation key are never part of a
public response. A separate membership stores the private role and account
status. Public reads expose only explicit profile fields for active accounts.
Owner reads accept the verified auth subject only, not a second target id;
they return the caller's role/status but no email or billing data.

Creation always starts at viewer/active. Creator/moderator/administrator are
reserved server-managed roles; there is no self-promotion, metadata-derived
role or role-assignment API. An audited, MFA-protected role management operation
must precede enabling privileged capabilities in a later slice. Existing
users.is_admin is not automatically a Social Cinema administrator. This
foundation intentionally provides no moderation/admin action to misuse.

Creation locks the existing user row, enforcing one profile per identity.
Repeating the same key and normalized payload returns the same profile id;
changing that payload returns idempotency_conflict without mutation. A new key
cannot overwrite an existing profile. Usernames are unique across concurrent
accounts. The private create key is sufficient because this slice has one
create-only mutation; update/history semantics belong to the next slice.

## Scope and rollout

No avatar URL, upload, series/episode, publication, feed or mobile UI is shipped.
Those need their own ownership, provider-host and moderation decisions. Account
status is separate from billing Frozen state; no change weakens billing rules.
The existing user deletion cascade removes Social Cinema rows. No existing user
is backfilled or made publicly discoverable without profile creation.

The public projection is defined here but reachable only by the trusted server;
it does not make Supabase anonymously readable. A future feature-gated HTTP
surface needs auth, rate limits and browser tests before release.

Apply 0132 only on main through the owner-approved apply-migrations workflow
(ADR-0023), after review and checking main/open-PR migration numbers again.
This task performs no deployment or production migration. Rollback before any
public surface is simply to leave the additive schema unused; do not delete
user data or rewrite an applied migration.

## Verification

Use isolated Postgres 16: replay every migration, apply 0132 twice, exercise
real browser-role denials (including TRUNCATE/function execution), forced RLS
under a deliberately granted non-bypass client role, projection/privacy,
owner isolation, username races and concurrent mutation replay. Verify signup
confirmation grants remain exactly once and profile creation changes no ledger
or balance. Existing JWT and session regression tests must pass unchanged.
