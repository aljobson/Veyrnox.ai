# ADR-0257: Daily UTC check-in rewards

Status: Accepted implementation; flag off pending host proof and owner rollout.

A signed-in, eligible account may claim once per UTC date. Consecutive days earn
1, 1, 2, 2, 2, then 3 credits each day. Missing a UTC day resets the next claim to
day 1. Rewards are ordinary non-expiring Pack credits. A fourth expiring bucket
was rejected: it would change roughly fifteen money functions for no approved
product benefit. Maximum provider cost is about $0.045 per user-day at the
planning estimate of $0.15 per ten credits.

`daily_checkin(uuid)` and `read_checkin_status(uuid)` accept the verified Auth
UUID, resolve `users.auth_id` (text) to the internal user UUID, and are callable
only by service_role. The streak table forces RLS with no browser policies.
Grants exclusively call `ledger_grant` with `grant:checkin#YYYY-MM-DD`; Free and
Subscription deltas remain zero. The ledger key is the durable replay guard;
a missing streak row is reconstructed from consecutive daily ledger grants.
Before granting, daily_checkin requires a matching auth.users row with a
non-null email_confirmed_at. Unconfirmed or missing Auth rows return
ACCOUNT_UNAVAILABLE. As in 0071, the Auth lookup is guarded when auth.users
does not exist in bare-Postgres replay environments.

Erasure locks users then balances; disputes lock balances then users. Check-in
locks users first, then balances NOWAIT. Contention unwinds the function's
exception block, releases its locks, and returns CHECKIN_BUSY (HTTP 409).
There is no retry loop. Eligibility is checked after both locks: tombstones,
frozen accounts and evidence/asset holds are refused. A content-strike
`hold_until` does not block check-in: strike holds leave credits unaffected.
The host acceptance script verifies both lock orders with two connections,
bounded waits, and an isolated disposable database. It never leaves committed
fixtures in the shared replay database. Each run needs CREATE DATABASE and
permission to replay migrations in the disposable database (CHECKIN-R3-006).

Streak state is erased by a users.deleted_at trigger, following creator_profiles.
The immutable credit history remains. The privacy export profile includes the
current streak, last UTC claim date and update timestamp. Like cinema_membership,
this mutable profile state is not bounded by the export's as_of: a check-in
after export start must not make the streak disappear from the export.
No additional export section or unbounded user data is introduced.

Both UIs use server status, six reward tiles, and a per-viewer UTC dismissal
preference. The web uses the app template shell and the existing balance event.
Mobile publishes a user-scoped balance change to mounted useBalance consumers
including HeaderChips CreditsChip and updates the existing cache; navigation
is not required. Credit statements classify keyed and unkeyed check-in grants
as checkin_reward, with translated web labels and a mobile history label. No native build or
server is needed. All eleven catalogs share translated check-in keys and use
the existing locale plural selection for credit amounts and earned copy.
Vey's account answers label check-in credits as a daily check-in reward.

Status reads stop for the viewer/UTC day after 403 account_unavailable or 404,
and after other client refusals. Only network/5xx failures retry, at 1, 2 and
4 minutes, with three retries maximum per UTC day. Focus changes, remounts and
manual opens cannot bypass this budget. A new UTC day starts a new read budget.
The web credits entry subscribes to host status events; it sends no second GET.

CHECKIN_ENABLED must equal the string "true". Absent means off and both routes
answer 404. Both production and staging omit the CHECKIN_ENABLED text binding;
absent means off. At rollout the owner makes binding room as needed, applies
the migration via the approved workflow, observes reconciliation clean for
24 hours, and only then adds CHECKIN_ENABLED="true" in the deployed environment.
Repository production vars remain off; tests allow optional boolean-string
bindings and retain the production binding headroom guard. The development mock also
defaults off and requires this explicit flag.

Known accepted risk: multi-account farming. Email confirmation and Turnstile
remain the existing signup controls (ADR-0026 and ADR-0071); this feature adds
no new anti-farming measure. No freezes/repair purchase, push reminder, new
bucket, expiry cron or production flag flip is included.

Implementation constraints: local origin/main is f785c4ed. The supplied plan
file was unavailable initially; on the R3 revision it was present and matched
the owner-supplied SHA-256. GitHub was unreachable initially, so migration
0367 and ADR 0256 require a collision check against live main/open PRs before a
PR is created. Existing locale catalogs and the development mock entrypoint
already exceed 500 lines; those receive only additive keys/routing. All new
files stay below 500 lines. This records the limited exception to the file-size
rule without restructuring unrelated code. The existing ADR index is generated
on demand; its frozen baseline/README are not edited.
