# ADR-0311: One-time codes recover an account by removing its bound authenticator

Status: proposed implementation; enforcement flag remains OFF.

## Context and decision

GoTrue alone mints an `aal2` JWT after a TOTP challenge and verification. An app-owned
code cannot mint one. GoTrue's self-service factor deletion also requires aal2, so
someone who loses their authenticator cannot remove it using their password alone.
The account gate checks for a verified TOTP factor, not a passkey. Passkeys use the
separate passwordless sign-in surface and cannot satisfy this gate.

Issue ten Crockford base32 recovery codes (`XXXXX-XXXXX`, 50 random bits each) at web
TOTP enrollment, with a fresh-verify regeneration/backfill action on the account and
admin MFA panels. Show plaintext only in that response and component memory, with
copy, text download and an explicit saved acknowledgement. A reload or dismissal of
the page loses the display; generate a replacement set if necessary. Store only
HMAC-SHA256 keyed by the pepper over `userId:normalizedCode`, encoded as hex.
This binds each hash to the authenticated user and separates the user and code.
Never put codes or secrets in logs or browser storage.
Normalization folds case and Crockford I/L→1 and O→0; U is invalid.

`POST /api/v1/mfa/recovery` works with a verified aal1 identity and a valid recovery
code. It atomically consumes the code, then deletes only its authorised TOTP factors
through the GoTrue service-role admin API using plain fetch. The response does not
mint or adopt an aal2 token. Once no verified factor remains, ordinary aal1 access
is sufficient and the person must set up a new authenticator. The sign-in UI
explicitly re-lists factors, bypassing its same-account aal1 observer short circuit,
and closes when none remain. If the read fails after confirmed recovery, retry it
once; if both reads fail, treat recovery as completed and offer a refresh/account-page
notice rather than another code attempt. Same-account token refreshes preserve the
completion notice. Server enforcement remains authoritative. Challenge/account
ownership guards cover both the
consume response and the factor lookup, including cancel and account switching.
Abandoning the prompt still signs out; recovery never reloads the workspace.

## Binding, concurrency and freshness

- **REC-04:** every batch stores the server-read verified TOTP factor IDs. Consumption
  intersects those IDs with currently verified factors in the database. Older codes
  can never delete a newly enrolled authenticator. Empty intersection burns the code
  and returns `stale:true, recovered:false`; the prompt stays open with instructions
  to use the current authenticator. Partial deletion cannot close a prompt that still
  has any verified factor.
- **REC-02:** replace, consume and attempt checks acquire the same per-user transaction
  advisory lock before touching rows. Concurrent replacements leave exactly one batch;
  an atomic update of `used_at IS NULL` makes consumption one-time. Regeneration does
  not reset rate limits. Factor enrollment/deletion in GoTrue does not participate in
  this lock: binding prevents a race from authorising a different factor, and status
  plus the completion lookup detect incomplete coverage/removal.
- **REC-03:** generation requires aal2 and the trusted middleware `mfa-at` header within
  300 seconds, with the existing admin-ledger check's five-second future clock skew.
  The browser always challenges again for regeneration. Client freshness is only
  presentation. Factor IDs are read server-side, never accepted from a request body.
- **REC-06:** status returns total/unused/usable, batch/time, enrollment and
  `needs_regeneration`. Usable means an unused code intersects current verified TOTP
  factors. Any current factor not covered by an unused code also requires regeneration.
  The prominent web backfill prompt uses that result, not raw unused rows.

Consume-first prevents double redemption. A subsequent timeout or admin deletion
failure may burn one of the ten codes, including when some factors were already
removed. Return `502 recovery_incomplete` and ask for another saved code. A deleted
factor's 404 counts as success. Remaining factors are rechecked by the browser.

## Security and operations

The consume route is the only added `AAL1_ALLOWED` exception. Generation and status
remain inside `/api/v1`, require aal2, and GET does not mutate. Identity comes only
from middleware-verified headers. Errors use the existing named underscore codes
(the work order calls these “kebab_case” but gives underscore identifiers).

A dedicated database RPC permits at most five attempts per account per rolling 15
minutes across all Worker isolates. Malformed and invalid codes consume attempts;
there is no caller-supplied account lookup or account-enumeration response. The
bounded timestamp-array row avoids unbounded per-attempt storage. Both new tables
force RLS, revoke browser/PUBLIC rights including TRUNCATE, and expose only
SECURITY DEFINER RPCs with an empty search path and full-signature service-role grants.
Both reference `auth.users ON DELETE CASCADE` and are classified as erased with the
auth account in `scripts/test-account-deletion.mjs`. No ledger/balance writers change.

### Known limitation

The per-user five-attempts-per-15-minutes recovery budget is counted before the code
is checked. A party holding only the password and an aal1 session can exhaust it
and delay the real user’s recovery for up to 15 minutes, repeatably. This only delays
recovery; it does not defeat recovery or weaken code confidentiality. A possible
follow-up is to count only failed attempts, or add a per-IP key alongside the per-user
key. Neither change is part of this revision.

Provision `MFA_RECOVERY_PEPPER` as a Worker secret using the owner's deployment
process (`wrangler secret put MFA_RECOVERY_PEPPER`), never a `wrangler.jsonc` var.
Missing pepper returns 503 `recovery_not_configured`. Rotation invalidates every
existing code and requires coordinated regeneration/backfill. No secret was set by
this implementation. Service-role credentials stay on the server. Neither Supabase
JS nor another auth SDK enters the SSR graph.

The enrollment cache lasts 60 seconds per isolate. After recovery, other isolates
may still refuse aal1 calls for up to a minute. The consume endpoint itself remains
reachable. `REQUIRE_AAL2_WHEN_ENROLLED` is **still off**; this work does not change it
or implement ADR-0308's separate read-recovery refetch.

Admin-assisted recovery is the ultimate fallback: after the owner's independent
identity checks, remove the lost factor through the service-role/dashboard. It is
not the primary mechanism for a near-solo operator. Passkey-as-backup was rejected
because it is neither a GoTrue MFA factor nor universally available; SMS/email OTP
are out of scope.

## Required follow-ups before enabling enforcement

1. Complete ADR-0308 MFA-02 read-recovery (still open and separate).
2. **REC-05/REC-07 mobile:** `apps/mobile` enrolls TOTP in `MfaCard.tsx` and already
   has a sign-in `MfaGate.tsx` mounted by `app/(app)/_layout.tsx`. That gate checks
   verified factors, challenges TOTP and adopts the verified session. What it lacks
   is recovery-code provisioning and redemption. These Bearer endpoints are platform
   agnostic. Before enabling the flag, ship provisioning and a recovery entry in the
   mobile gate, **or ensure every mobile-enrolled person generated usable codes via
   the web account page**. Mobile UI is a separate follow-up; no mobile file changes
   here and no native environment is installed.
3. **REC-06 backfill:** verify every enrolled account has `needs_regeneration=false`
   and `usable>0` for its *current* factors. Existing unused rows alone are insufficient,
   especially after factors are replaced on mobile. Use the service-role status RPC
   for an authorised owner audit; do not expose account lists to browsers.
4. Recheck migration `0419` and ADR `0311` against current main and open PRs before
   integration. Local numbering was free, but GitHub was unreachable in this sandbox.
   Apply the migration and provision the pepper through the normal owner workflow.
5. **RV-01 recovery notification/audit (security monitoring, OWASP A09):** a successful
   recovery strips the TOTP factor with no signal to the account owner and no audit
   record. Before enabling enforcement, add a security notification (e.g. the Resend
   violation-notice path) and/or an `account_actions`-style audit entry on successful
   recovery — never logging the code — so a password-plus-leaked-code takeover is
   observable. This PR does not add it (scope); it is a prerequisite for the flag.
6. **RV-03 multi-factor message (known low-severity UX limitation):** if an account has
   more than one verified TOTP factor and a code is bound to only a subset, consume
   removes the bound factor(s) and the step-up then reports "codes are for a previous
   authenticator" even though the code worked and a factor was removed; the prompt stays
   open and no lockout or security issue results. A later refinement can have the route
   return `remaining` so the message says the code worked but another authenticator is
   still enrolled. Reaching this state requires two verified TOTP factors.

## Validation

The focused Node suites cover code generation/normalization/hashing, route failures,
server freshness, bound-factor deletion, the aal1 exception, and prompt race guards.
`scripts/test-mfa-recovery.mjs` is wired into the existing ledger replay workflow. It
covers migration idempotence, real two-connection replacement/consumption races,
stale/partial factor coverage, rolling rate limits, ACL/RLS and auth-user cascade.
The bare replay DB lacks `auth.mfa_factors`: function bodies resolve it at call time,
as in 0404, and the SQL test creates and removes only its local fixture table.
The account-deletion classifier runs separately in that same replay workflow.
