# 5. Security Baseline — Veyrnox Publish

> **As of 2026-10-08 (repo `main` at `bee1ea4f`).** This baseline was written before implementation. It
> has been reconciled with the code (migrations 0154 to 0228, `app/api/v1/social/`, `lib/social/`,
> `packages/adapters/social/`, `worker.js`) and the staging acceptance records. Each row now says what
> is built; a row whose control is not built says so rather than citing the design. *Unverified* marks
> what could not be confirmed from the repo. Nothing here is a penetration test result. Controls for the six
> networks added by PR #637 are described from the code and automated tests only; none was run against a
> real provider account (see [the tester handover](INTEGRATIONS-TESTING-2026-10-08.md)).

**Purpose:** map Veyrnox Publish's design (specified in [02-technical-spec.md](02-technical-spec.md))
against the named external security frameworks — OWASP, NIST, ISO/IEC 27001, and the UK NCSC — so
engineering review can check specific, named controls rather than a vague "we thought about
security." This is the audit-facing companion to §2.7–§2.11 of the technical spec.

## How to read this document

- Every row states a **concrete Veyrnox Publish decision** and points at the exact section
  of the technical spec that specifies it. A framework reference with no matching design decision
  is a gap, not a citation — none should appear below without one.
- **Honesty on sourcing:** the control *recommendations* below (PKCE, exact-match redirect URIs,
  BOLA/BFLA defense-in-depth, SSRF-safe fetch design, encryption-at-rest, append-only audit logs,
  rate limiting, least-privilege scopes) reflect well-established, publicly documented guidance from
  these bodies. This research pass did not re-fetch and quote the live text of RFC 9700, the OWASP
  API Security Top 10 page, NIST SP 800-63B, ISO/IEC 27001:2022 Annex A, or the NCSC Cloud Security
  Principles the way `docs/adr/0058-byteplus-modelark-provider.md` quotes BytePlus's own terms
  documents it actually fetched. Treat the specific clause/control numbers below as correct to the
  author's working knowledge of stable, widely-taught reference material, not as independently
  re-verified quotations — flag this explicitly if this pack is ever used as formal audit evidence
  for a certification (e.g. an actual ISO 27001 audit), where the live control text must be checked.
- Chosen frameworks and why: **OWASP** (Top 10 + API Security Top 10) because this feature's attack
  surface is almost entirely a web app + API surface; **NIST CSF 2.0** as a framework-neutral,
  outcome-based structure for the program-level view (Govern/Identify/Protect/Detect/Respond/
  Recover); **ISO/IEC 27001 Annex A** as the internationally recognized ISMS control catalogue,
  useful even without pursuing certification, as a completeness checklist; **NCSC** because Veyrnox
  is a UK Ltd (ADR-0005) with EU/UK-resident data (ADR-0006), making NCSC the most directly
  applicable national guidance body, particularly its Cloud Security Principles (this stack is
  entirely Cloudflare Workers + Supabase, i.e. cloud-hosted) and its OAuth guidance.

## 5.1 OWASP API Security Top 10 (2023) — primary mapping

Publish is overwhelmingly an API surface (§2.3 of the technical spec) integrating multiple external
APIs, so this list is the single most relevant framework here — more specific to this feature's
actual risk than the general OWASP Top 10 below.

| # | Risk | Veyrnox Publish control | Spec reference |
|---|---|---|---|
| API1 | Broken Object Level Authorization | **Built.** Every id-scoped RPC joins to `social_brands.owner_user_id = <caller>` using `p_auth_id`, independent of RLS (no browser role has any table grant); a foreign id returns the same `*_NOT_FOUND` as a missing one, mapped to 404 | §2.9 |
| API2 | Broken Authentication | Reuses the existing repo-wide JWT gate (ES256 + JWKS via Web Crypto, §2.3) — no new authentication mechanism invented for this feature | §2.3, §2.9 |
| API3 | Broken Object Property Level Authorization | **Built.** Handlers read named body keys only and pass them to RPCs; the reschedule RPC takes two timestamps. A body cannot set a status, brand or target field. There is no general post edit endpoint | §2.9 |
| API4 | Unrestricted Resource Consumption | **Built, with one gap.** 20 write requests per user per 60 s on posts, drafts and uploads (`consume_social_post_write_request`); read limiter on reads; upload size and type caps (20 MiB images, 100 MiB MP4, ten files and 200 MiB per account); at most 20 accounts and 10 media per post; bounded retry (3 attempts, 5 to 60 minute backoff). The `/connect` routes have no limiter of their own (*unverified*); the new callback and Bluesky connect routes use the account read limiter, and at most 200 destination candidates are accepted | §2.6, §2.10 |
| API5 | Broken Function Level Authorization | **Built as owner-only.** There are no collaborator or reviewer roles; disconnect, draft approve and discard, upload removal and reschedule all require the brand or upload owner. Approver roles are design only | §2.9 |
| API6 | Unrestricted Access to Sensitive Business Flows | **Built.** The write limiter above bounds post creation; "Post now" still needs an owned asset, an active account and an idempotency key. The free tier also bounds blast radius to one connected account (0169). Per-day post volume is not capped | §2.10 |
| API7 | Server-Side Request Forgery | **Built.** No code path fetches a caller-supplied URL: the API accepts only `jobId` or `uploadId`, never a URL or storage path. Adapters call fixed platform bases (the six new adapters also use `redirect: 'error'` and a 15 s timeout; Bluesky accepts only `bsky.social` or `*.host.bsky.network`, so a handle cannot steer a credential to another host); the only URLs fetched server-side are presigned R2 URLs the server minted. Callback URLs come from `PUBLIC_HOST`. The one public endpoint, `/media/social/:token`, serves a single HMAC-named object. Drive/Dropbox import remains gated on an allowlisted fetch service | §2.8 |
| API8 | Security Misconfiguration | **Built.** Secrets via `wrangler secret put` only; RLS `FORCE`d with all roles revoked on every table; CSP unchanged; Publish gated by `PUBLISH_ENABLED` (off in production) with separate sub-switches, including `PUBLISH_EXTENDED_NETWORKS_ENABLED` for the six new networks (off in production, on in staging; gates new connections and post creation, not already queued targets). The upload bucket's CORS must name the exact origin (checked on staging) | §2.10 |
| API9 | Improper Inventory Management | **Built.** Routes are listed in §2.3 under `/api/v1/social/*` plus the one documented outside-the-gate route, `/media/social/:token` (in `CLAUDE.md` and `tests/routesOutsideGate.test.mjs`). The design routes that were never built (edit, cancel, approvals, SmartLinks) do not exist | §2.3 |
| API10 | Unsafe Consumption of APIs | **Built.** Platform responses are untrusted: metrics pass `social_analytics_numbers` (numeric, well-named keys only), captions are capped at 500 characters, permalinks must be `https://`, post types match a pattern, all enforced by CHECK constraints; the analytics fetchers check the returned identity (TikTok `open_id`, YouTube channel) against the stored connection and ignore foreign records; React escapes at render | §2.11 risk 6 |

## 5.2 OWASP Top 10 (2021) — general web-app mapping

Most of this is already covered by the repo-wide mapping in `CLAUDE.md`'s own "OWASP Top 10" section;
this table only calls out what's *specific* to Publish on top of that baseline.

| # | Risk | Publish-specific control |
|---|---|---|
| A01 Broken Access Control | §5.1 API1/API3/API5 above — this is the dominant risk category for a feature that's mostly CRUD + third-party token access |
| A02 Cryptographic Failures | **Built.** OAuth access/refresh tokens encrypted at rest via `crypto.subtle` AES-GCM (random 12-byte IV) under the dedicated `SOCIAL_TOKEN_ENCRYPTION_KEY` secret. Both tokens are cleared on disconnect. No key rotation path (§2.11 risk 4) |
| A03 Injection | No new SQL construction pattern introduced — same parameterized-query / RPC discipline as the rest of the repo |
| A04 Insecure Design | The SSRF-avoidance decision in §2.8 is exactly this: a design choice that removes a risk class rather than a filter that mitigates it after the fact |
| A05 Security Misconfiguration | CSP explicitly designed to require **no change** (§2.10) — every platform call is server-side |
| A06 Vulnerable and Outdated Components | Adapters are hand-written `fetch` clients, not vendor SDKs, specifically to avoid an unaudited dependency landing on the SSR bundle (§2.1, §2.10) — this also minimizes the transitive-dependency surface this risk category targets |
| A07 Identification and Authentication Failures | **Partly built** (§2.7): PKCE forwarded by X and Google Business Profile only (the other providers' adapters do not forward it); exact `PUBLIC_HOST` redirect; stateless HMAC `state` with ten-minute expiry, not single-use; TikTok rotation atomic, and since 0228 Pinterest, Threads, Bluesky, Twitch and Business Profile rotation compares both old ciphertexts; destination selections (Facebook, Pinterest, Business Profile) are encrypted, user- and network-bound, ten-minute and single-use; Bluesky uses a dedicated app password that is never stored; **reuse detection not built** |
| A08 Software and Data Integrity Failures | **Built.** `create_social_post` idempotent on `(brand_id, idempotency_key)`; claim key stops a worker that lost its claim overwriting a result (0168, `CLAIM_LOST`); append-only audit log with a truncate guard. Platform calls are not idempotent for the original five (§2.6); for Facebook, Threads, Pinterest, Bluesky and Business Profile a committed pre-submission marker stops a second public submission and surfaces `provider_result_unknown_reconcile_before_retry` |
| A09 Security Logging and Monitoring Failures | **Partly built.** `social_account_actions` (append-only) records connect, reconnect, disconnect, draft approve/discard and reschedule. Analytics failures live on `social_analytics_sync.last_error` (not the audit log); publish and token-refresh failures live on the target's `last_error`; the sweep logs claim, report and heartbeat failures with `console.error`, and `publish_sweep` feeds the worker heartbeat (0157). The analytics sweep has no heartbeat. There are no user notifications |
| A10 Server-Side Request Forgery | Same as API7 above (§2.8) — listed twice deliberately since OWASP itself lists it in both the general Top 10 and the API Top 10 |

## 5.3 NIST Cybersecurity Framework 2.0 — program-level mapping

NIST CSF 2.0's six functions give a framework-neutral way to check that security isn't just
"controls in code" but a full lifecycle. Mapped at the level Publish's spec pack can actually claim:

| Function | Publish's design coverage |
|---|---|
| **Govern** | This ADR (0061) itself is the governance artifact — a named decider, a documented recommendation, explicit open questions, and a requirement that credit/billing implications get their own ADR before code lands |
| **Identify** | §2.2's data model names every new asset (OAuth tokens, post content, analytics snapshots, click logs) and its sensitivity; §2.11 names the specific external dependencies (Meta, TikTok, X, LinkedIn, YouTube APIs) and their individual risk profiles |
| **Protect** | The bulk of §2.7–§2.10: encryption at rest, RLS, least-privilege OAuth scopes, defense-in-depth authorization, rate limiting, secrets management |
| **Detect** | Append-only `social_account_actions` audit log; per-target `last_error`; per-account analytics sync errors; `publish_sweep` worker heartbeat. **Not built:** user failure notifications and token-expiry detection (nothing sets an account `expired` or `error`) |
| **Respond** | Automatic retry with backoff (three attempts) for every error, `failed` status with the reason on the target, disconnect that immediately fails open targets and clears tokens (0168). **Not built:** error classification, reuse-detection response, a per-target Retry control (§2.6, §4.7) |
| **Recover** | Reconnect restores the same account row (§4.1). A failed post is recreated by the user; a single failed target cannot be re-queued (§4.7) |

**Gap, stated plainly:** NIST CSF's Govern function also expects a named incident-response plan and
a supply-chain risk assessment for each new vendor dependency (each platform API counts as one).
Neither exists yet for Publish specifically — this repo already has an incident-response runbook
for the generation/billing surface (referenced in prior compliance work) but it has not been
extended to cover a compromised social-platform token or a platform API compromise. Listed as an
open item below.

## 5.4 ISO/IEC 27001:2022 Annex A — selected controls

Not pursuing certification; used here as a completeness checklist against the internationally
recognized control catalogue. Only controls with a concrete, non-generic Publish design decision are
listed — an Annex A control with no specific answer here is intentionally omitted rather than
padded out.

| Annex A control theme | Control | Publish's answer |
|---|---|---|
| A.5 Organizational | A.5.19–5.23 Supplier/third-party relationships | Each platform API is a named third-party dependency with its own OAuth scope, its own outage-tolerance design (§2.5's graceful degradation), and its own app-review compliance requirement (§2.11 of the ADR) |
| A.5 Organizational | A.5.34 Privacy and protection of PII | OAuth tokens and connected-account handles are the new PII surface here; scoped access, encryption at rest, and an audit trail of who connected/disconnected what |
| A.8 Technological | A.8.9 Configuration management | Secrets via `wrangler secret put` only, never in `wrangler.jsonc` or source (§2.10) |
| A.8 Technological | A.8.10 Information deletion | Disconnect marks the account revoked, **clears both stored tokens** and logs the action. It does not call the platform's revocation endpoint (*not built*), so the grant stays live on the provider side until the user removes it there. Removed uploads are deleted from R2 and only then release their quota (§2.8) |
| A.8 Technological | A.8.12 Data leakage prevention | Tokens never logged, never returned to the client, never included in error responses (§2.7) |
| A.8 Technological | A.8.16 Monitoring activities | Append-only audit log, sync-row errors, target errors and the `publish_sweep` heartbeat (§2.5, §2.6, §5.3 Detect) |
| A.8 Technological | A.8.23 Web filtering | The SSRF-avoidance-by-design decision in §2.8 holds in the build: no outbound fetch of user-supplied URLs to filter, because none exists |
| A.8 Technological | A.8.24 Use of cryptography | `crypto.subtle` AES-GCM for token encryption, HMAC-SHA256 for OAuth state and media-proxy tokens, SigV4 for R2, each under its own dedicated Worker secret. **A rotation runbook is still missing** (§2.11 risk 4) |
| A.8 Technological | A.8.26 Application security requirements | This document plus §2.7–§2.10 of the technical spec were written before implementation and have now been reconciled with it |
| A.8 Technological | A.8.28 Secure coding | Adapters as plain `fetch` clients (no unaudited SDK), parameterized queries, explicit allow-lists on mutable fields (§2.1, §2.9, §2.10) |

## 5.5 NCSC guidance — UK-specific mapping

Veyrnox.ai is a UK Ltd (ADR-0005) storing EU/UK-resident data (ADR-0006), so NCSC guidance is the
most directly applicable national-authority reference, on top of the international frameworks above.

### 14 Cloud Security Principles (selected — this stack is Cloudflare Workers + Supabase, both cloud)

| Principle | Publish's answer |
|---|---|
| 1. Data in transit protection | All platform API calls over HTTPS/TLS (§2.1); no plaintext transport anywhere in the design |
| 2. Asset protection and resilience | Media in the existing R2 bucket (already EU-jurisdictioned per ADR-0021's precedent); device uploads under their own `social-uploads/` prefix; token encryption at rest |
| 5. Operational security | Graceful degradation on platform outages (§2.5); bounded retry with backoff, never an unbounded loop (§2.6) |
| 8. Supply chain security | No vendor SDKs on the SSR bundle; each platform API treated as an explicit, named dependency with its own risk profile (§2.1, §2.11) |
| 9. Secure user management | Owner-only checks at the function level (§2.9); collaborator and reviewer roles are design only |
| 10. Identity and authentication | OAuth hardening per §2.7 (with the gaps stated there); reuses the existing JWT/JWKS identity system rather than inventing a parallel one |
| 11. External interface protection | Write and read rate limiting (§2.10); strict input validation at the API boundary, matching the repo-wide rule already in `CLAUDE.md` |
| 13. Audit information for users | Append-only `social_account_actions` records the trail per brand, consistent with the existing `account_actions` pattern. No user-facing view of it is built |

### OAuth-specific NCSC guidance

The connect flow (§2.7) follows part of the shape NCSC's own OAuth guidance and RFC 9700 converge on:
exact-match redirect URIs, user- and network-bound signed state (expiring, but not single-use), minimal
requested scope, and encrypted-at-rest token storage with no client-side exposure. PKCE is used where
the provider supports it (X only), so "PKCE on every code exchange" is not met.

### 10 Steps to Cyber Security — org-level umbrella

Publish's engineering-level controls above map onto several of NCSC's ten organizational steps
(Architecture and configuration, Identity and access management, Data security, Logging and
monitoring, Vulnerability management, Supply chain security). The steps this pack does **not**
cover, because they're organizational rather than feature-specific, are called out as open items
below — they're the product owner's / engineering lead's responsibility, not something a feature
spec can satisfy on its own.

## 5.6 What this baseline does not yet cover (explicit gaps)

Naming these directly rather than implying full coverage. Status as of 2026-10-08:

1. **No incident-response plan specific to a compromised social-platform token or a platform API
   breach.** Still open: `docs/security/` holds `security-controls.md` and `threat-model.md`, and
   neither covers Publish.
2. **No vulnerability disclosure process** was found for this feature or the site (no `security.txt`
   in the repo). Still open. Publish now holds live posting credentials on staging.
3. **No penetration test or focused security review has happened.** The build has unit tests, database
   acceptance tests (token rotation, claim guards, uploads under concurrency, calendar locking) and
   staging acceptance, but no review aimed at the OAuth flow and media boundary. Pre-GA requirement.
4. **No formal threat model diagram** for Publish. Now that the adapter interface exists, this can be
   produced against real code.
5. **Supply-chain risk for each platform API itself** is not worked through beyond API10-style input
   validation.
6. **Token lifetime handling is incomplete** (new): Instagram, X and LinkedIn tokens are never refreshed
   and Facebook Page tokens have no stored expiry or refresh (Pinterest, Business Profile, Twitch, Bluesky
   and Threads now renew), no account is ever marked `expired` or `error`, and there is no notification when a post fails.
7. **No token-encryption key rotation path** and no documented runbook (new).
8. **Disconnect does not revoke the grant at the platform** (new); it clears the stored tokens only.
9. **OAuth state is not single-use** and reuse detection for rotated refresh tokens is not built (new,
   §2.7).
10. **Production secrets** for the provider apps (now ten OAuth apps plus Bluesky's password flow; the
    tester handover says staging holds YouTube and the shared secrets only) and the three social secrets: whether they are
    provisioned in production is *unverified*. Production Publish is closed.

## 5.7 Pre-implementation checklist (derived from this document)

- [ ] Extend the existing incident-response runbook to cover a compromised social-platform token.
- [ ] Confirm or create a vulnerability disclosure process before any platform holds a live user
      token. (A live YouTube token is held on staging; no process was found.)
- [ ] Schedule a focused security review of the OAuth flow and media/upload boundary, before GA (not as
      a nice-to-have — §2.11 risk 8).
- [x] Token-encryption Worker secret exists as its own dedicated secret (a working staging
      deployment decrypts stored tokens; production provisioning *unverified*). [ ] Written rotation
      runbook still missing.
- [x] Each platform's OAuth scope request is the minimum for what ships; the two new scope families are
      behind their own switches. Re-check at each phase boundary.
- [ ] Decide token refresh for Instagram, X and LinkedIn (and Facebook Page tokens), and failure notifications.
- [ ] Real-account acceptance and provider app review for Facebook, Threads, Pinterest, Bluesky, Twitch and Business Profile before widening `PUBLISH_EXTENDED_NETWORKS_ENABLED` beyond staging.
- [ ] Revoke the grant at the platform on disconnect.
