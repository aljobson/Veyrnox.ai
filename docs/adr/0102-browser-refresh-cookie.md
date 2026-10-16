# ADR-0102 — HttpOnly browser refresh credentials

- Status: Accepted; implemented 2026-10-16
- Owners: Veyrnox platform
- Related: ADR-0100, ADR-0101

## Context

Production QA identified persisted access and refresh tokens in localStorage.
An injected script could copy those credentials for reuse after the page closed.
The application, MFA/passkeys, developer API and MCP connector already use Bearer
authentication. Converting every product API to cookie authentication would add
an ambient credential and require a separate CSRF rollout on every mutation.

## Decision

Keep short-lived access tokens only in tab memory. Keep the rotating refresh
credential in a host-only `__Host-veyrnox_refresh` cookie with `Secure`, `HttpOnly`,
`SameSite=Strict`, `Path=/`, no Domain attribute, and a rolling 30-day maximum age.
Supabase remains authoritative for expiry, session revocation and MFA assurance.

`POST /api/auth/session` is the only endpoint accepting that cookie. The endpoint
requires exact Origin, JSON and `X-Session-Request: 1`; cross-site and sibling-site
Fetch Metadata is refused and no CORS permission is emitted. Request bodies are
limited to 4 KiB and five seconds. Upstream Auth requests have a ten-second
deadline and 128 KiB response limit. Responses are private/no-store, never include
refresh tokens, and expose only generic upstream errors.

Password, PKCE, implicit callback and passkey sign-in, plus MFA token replacement,
await refresh-cookie establishment before adopting the session. A refresh grant
validates the credential and rotates it server-side. Browser-readable persistence
contains only user/display metadata and a cross-tab revision, never new tokens.
Existing localStorage credentials migrate once on the next session hydration;
successful migration overwrites them with metadata. A transient outage preserves
an existing legacy session until migration can succeed; definitive revocation
clears it. No database migration or new secret is required.

Same-tab requests are serialized. Web Locks serialize cookie rotation across
tabs where supported. Without Web Locks, Supabase's refresh-token reuse grace
and definitive-rejection handling remain authoritative. Session epochs discard
late responses after sign-out/account changes, and one shared storage listener
rehydrates other tabs without broadcasting refresh loops. Sign-out expires the
cookie and revokes the Supabase device session whenever a live access token is
available. Session metadata and private caches are cleared even during outages.
A token-free local sign-out tombstone suppresses cookie restoration across reloads
if deletion could not reach the server; deletion is retried and explicit new
sign-in removes the tombstone.

## Consequences

Product, administrator, developer and MCP routes continue accepting verified
Bearer access tokens only. Their existing authorization/MFA checks remain intact.
The cookie cannot directly authorize any of those APIs. Access tokens remain
readable to scripts in an active tab, so CSP and input/output safety remain
necessary; this design removes persisted long-lived browser credentials rather
than claiming to make a successful XSS harmless.

The analytics external rewrite explicitly blanks Cookie, Authorization and
identity headers. OpenNext merges middleware-set values onto inbound headers
even for external rewrites, so merely omitting those headers would forward the
refresh cookie to the analytics provider. A regression test simulates that
production merge before checking the outbound credential values.

The root browser bootstrap restores the memory session on page load, retaining
token-free account labels while restoration completes. Auth callback pages own
their establishment flow and skip bootstrap. Staging E2E sessions seed an HttpOnly
cookie and metadata, then exercise the same browser restore endpoint as users.

## Verification

Tests cover CSRF rejection, cookie flags and rotation, response credential
redaction, bounds, transient versus definitive failures, awaited password
persistence, legacy migration, cookie-only reload, concurrent refresh,
multi-subscriber cross-tab account change, sign-out races, PKCE/magic callbacks,
MFA display freshness and real logout scope/Bearer behavior. Production acceptance
must include sign-in, reload, cross-tab sign-out and checking that localStorage
contains neither token field.
