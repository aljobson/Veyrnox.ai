# 5. Security Baseline — Veyrnox Publish

**Purpose:** map Veyrnox Publish's design (specified in [02-technical-spec.md](02-technical-spec.md))
against the named external security frameworks — OWASP, NIST, ISO/IEC 27001, and the UK NCSC — so
engineering review can check specific, named controls rather than a vague "we thought about
security." This is the audit-facing companion to §2.7–§2.11 of the technical spec.

## How to read this document

- Every row states a **concrete Veyrnox Publish design decision** and points at the exact section
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
| API1 | Broken Object Level Authorization | Every `:id`-scoped route re-derives `brand_id` from the caller's own membership server-side, independent of RLS; mismatched ids return `not_found`, never a `forbidden` that confirms existence | §2.9 |
| API2 | Broken Authentication | Reuses the existing repo-wide JWT gate (ES256 + JWKS via Web Crypto, §2.3) — no new authentication mechanism invented for this feature | §2.3, §2.9 |
| API3 | Broken Object Property Level Authorization | `PATCH` endpoints use an explicit field allow-list; a request body can never smuggle `publish_status`, another `account_id`, or cross-brand fields into an update | §2.9 |
| API4 | Unrestricted Resource Consumption | Postgres-backed sliding-window rate limiting on `/posts`, `/connect`, and every publish-adjacent write; media size/type caps at the upload boundary; bounded retry/backoff (max 3 attempts) on every adapter call | §2.6, §2.10 |
| API5 | Broken Function Level Authorization | Disconnect / approve / cancel actions check the caller's role within the brand (owner / collaborator / reviewer), not just JWT validity | §2.9 |
| API6 | Unrestricted Access to Sensitive Business Flows | Scheduling and publish endpoints share the generation-endpoint rate-limit pattern specifically to blunt automated abuse of a compromised token (mass spam-posting) | §2.10 |
| API7 | Server-Side Request Forgery | v1 has **no code path that fetches a caller-supplied URL server-side** — media is R2-library or direct browser upload only; every adapter calls a fixed, hardcoded platform API base URL, never one derived from request input; the future Drive/Dropbox import (Phase 3) is explicitly gated on a dedicated allowlisted fetch service before it can ship | §2.8 |
| API8 | Security Misconfiguration | Secrets via `wrangler secret put` only; RLS `FORCE`d on every table; CSP left unchanged by design (§2.10); same PR-review discipline as the rest of the repo | §2.10 |
| API9 | Improper Inventory Management | Every route is listed once, versioned under `/api/v1/social/*`, in §2.3; no undocumented/shadow endpoints; a decommissioned endpoint is deleted, not merely unlinked |  §2.3 |
| API10 | Unsafe Consumption of APIs | Data pulled back from platform APIs (captions, handles, analytics labels) is treated as untrusted external input: escaped at every render site, size/type-validated before storage, never interpolated into SQL | §2.11 risk 5 |

## 5.2 OWASP Top 10 (2021) — general web-app mapping

Most of this is already covered by the repo-wide mapping in `CLAUDE.md`'s own "OWASP Top 10" section;
this table only calls out what's *specific* to Publish on top of that baseline.

| # | Risk | Publish-specific control |
|---|---|---|
| A01 Broken Access Control | §5.1 API1/API3/API5 above — this is the dominant risk category for a feature that's mostly CRUD + third-party token access |
| A02 Cryptographic Failures | OAuth access/refresh tokens encrypted at rest via `crypto.subtle` AES-GCM under a dedicated Worker secret, never a repo-shared key (§2.10, §2.11 risk 4) |
| A03 Injection | No new SQL construction pattern introduced — same parameterized-query / RPC discipline as the rest of the repo |
| A04 Insecure Design | The SSRF-avoidance decision in §2.8 is exactly this: a design choice that removes a risk class rather than a filter that mitigates it after the fact |
| A05 Security Misconfiguration | CSP explicitly designed to require **no change** (§2.10) — every platform call is server-side |
| A06 Vulnerable and Outdated Components | Adapters are hand-written `fetch` clients, not vendor SDKs, specifically to avoid an unaudited dependency landing on the SSR bundle (§2.1, §2.10) — this also minimizes the transitive-dependency surface this risk category targets |
| A07 Identification and Authentication Failures | OAuth hardening in §2.7 (PKCE, exact redirect match, state CSRF binding, refresh-token rotation and reuse detection) |
| A08 Software and Data Integrity Failures | Idempotency keys on every state-changing write (§2.2, §2.10); append-only audit log means a post's history can't be silently rewritten |
| A09 Security Logging and Monitoring Failures | `social_account_actions` (append-only) plus a documented "analytics fetch failed" / "token refresh failed" logging path so one platform's outage is visible, not swallowed (§2.5, §2.6) |
| A10 Server-Side Request Forgery | Same as API7 above (§2.8) — listed twice deliberately since OWASP itself lists it in both the general Top 10 and the API Top 10 |

## 5.3 NIST Cybersecurity Framework 2.0 — program-level mapping

NIST CSF 2.0's six functions give a framework-neutral way to check that security isn't just
"controls in code" but a full lifecycle. Mapped at the level Publish's spec pack can actually claim:

| Function | Publish's design coverage |
|---|---|
| **Govern** | This ADR (0061) itself is the governance artifact — a named decider, a documented recommendation, explicit open questions, and a requirement that credit/billing implications get their own ADR before code lands |
| **Identify** | §2.2's data model names every new asset (OAuth tokens, post content, analytics snapshots, click logs) and its sensitivity; §2.11 names the specific external dependencies (Meta, TikTok, X, LinkedIn, YouTube APIs) and their individual risk profiles |
| **Protect** | The bulk of §2.7–§2.10: encryption at rest, RLS, least-privilege OAuth scopes, defense-in-depth authorization, rate limiting, secrets management |
| **Detect** | Append-only `social_account_actions` audit log; `analytics_fetch_failed` / `token_refresh_failed` logged events; failed-publish notifications surface problems to the user rather than failing silently (§2.5, §2.6, §4.7 of the user-flows doc) |
| **Respond** | Documented failure paths: automatic retry with backoff for transient errors, immediate `failed` status + user notification for permanent errors, reconnect flow for token compromise/expiry (§2.6, §2.7's refresh-token-reuse-detection response, §4.7) |
| **Recover** | Reconnect flow (§4.1 of user-flows) restores a broken account without data loss; failed targets can be retried individually without re-submitting an entire multi-network post (§4.7) |

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
| A.8 Technological | A.8.10 Information deletion | Disconnecting an account revokes the token where the platform supports it and soft-deletes the row, logged; token rotation/reuse detection forces a full re-issue rather than trusting a stale credential (§2.7) |
| A.8 Technological | A.8.12 Data leakage prevention | Tokens never logged, never returned to the client, never included in error responses (§2.7) |
| A.8 Technological | A.8.16 Monitoring activities | Append-only audit log + failed-fetch/failed-refresh event logging (§2.5, §2.6, §5.3 Detect) |
| A.8 Technological | A.8.23 Web filtering | The SSRF-avoidance-by-design decision in §2.8 is the strongest possible form of this control: no outbound fetch of user-supplied URLs to filter, because none exists |
| A.8 Technological | A.8.24 Use of cryptography | `crypto.subtle` AES-GCM for token encryption, dedicated Worker secret, documented rotation runbook requirement (§2.11 risk 4) |
| A.8 Technological | A.8.26 Application security requirements | This entire document plus §2.7–§2.10 of the technical spec, written *before* implementation, not retrofitted |
| A.8 Technological | A.8.28 Secure coding | Adapters as plain `fetch` clients (no unaudited SDK), parameterized queries, explicit allow-lists on mutable fields (§2.1, §2.9, §2.10) |

## 5.5 NCSC guidance — UK-specific mapping

Veyrnox.ai is a UK Ltd (ADR-0005) storing EU/UK-resident data (ADR-0006), so NCSC guidance is the
most directly applicable national-authority reference, on top of the international frameworks above.

### 14 Cloud Security Principles (selected — this stack is Cloudflare Workers + Supabase, both cloud)

| Principle | Publish's answer |
|---|---|
| 1. Data in transit protection | All platform API calls over HTTPS/TLS (§2.1); no plaintext transport anywhere in the design |
| 2. Asset protection and resilience | Media in the existing R2 bucket (already EU-jurisdictioned per ADR-0021's precedent); token encryption at rest |
| 5. Operational security | Graceful degradation on platform outages (§2.5); bounded retry with backoff, never an unbounded loop (§2.6) |
| 8. Supply chain security | No vendor SDKs on the SSR bundle; each platform API treated as an explicit, named dependency with its own risk profile (§2.1, §2.11) |
| 9. Secure user management | Role checks (owner/collaborator/reviewer) at the function level, not just brand-level access (§2.9) |
| 10. Identity and authentication | OAuth hardening per §2.7; reuses the existing JWT/JWKS identity system rather than inventing a parallel one |
| 11. External interface protection | Rate limiting at every entry point (§2.10); strict input validation at the API boundary, matching the repo-wide rule already in `CLAUDE.md` |
| 13. Audit information for users | Append-only `social_account_actions` gives a user-facing "who did what when" trail for their own brand, consistent with the existing `account_actions` pattern |

### OAuth-specific NCSC guidance

The connect flow (§2.7) follows the shape NCSC's own OAuth guidance and RFC 9700 converge on: PKCE
on every code exchange, exact-match redirect URIs, single-use CSRF-bound state, minimal requested
scope, and encrypted-at-rest token storage with no client-side exposure.

### 10 Steps to Cyber Security — org-level umbrella

Publish's engineering-level controls above map onto several of NCSC's ten organizational steps
(Architecture and configuration, Identity and access management, Data security, Logging and
monitoring, Vulnerability management, Supply chain security). The steps this pack does **not**
cover, because they're organizational rather than feature-specific, are called out as open items
below — they're the product owner's / engineering lead's responsibility, not something a feature
spec can satisfy on its own.

## 5.6 What this baseline does not yet cover (explicit gaps)

Naming these directly rather than implying full coverage:

1. **No incident-response plan specific to a compromised social-platform token or a platform API
   breach.** The existing generation/billing incident runbook should be extended, not assumed to
   already cover this.
2. **No vulnerability disclosure process** has been defined for this feature specifically (NCSC and
   ISO 27001 A.5.7/A.8.8 both expect one). If the org doesn't already have a `security.txt` /
   disclosure policy, this feature is a reasonable forcing function to add one, given it's about to
   hold live posting credentials for external platforms.
3. **No penetration test or focused security review has happened** — this is a pre-implementation
   spec. §2.11 risk 6 already flags this as a pre-GA requirement, specifically targeting the OAuth
   flow and the media boundary.
4. **No formal threat model diagram** (e.g. STRIDE) exists yet beyond the architecture diagram in
   §2.1 and the control mapping above — worth producing once the adapter interface is implemented
   and there's real code to model, rather than modeling an interface that may still shift.
5. **Supply-chain risk for each platform API itself** (i.e., what happens if Meta's or TikTok's API
   is compromised or serves malicious data back to Veyrnox) is named as a risk category in §5.3/§5.4
   but not fully worked through — OWASP API10's "unsafe consumption" control is the closest existing
   mitigation, but a dedicated review once real API responses are being handled would sharpen this.

## 5.7 Pre-implementation checklist (derived from this document)

- [ ] Extend the existing incident-response runbook to cover a compromised social-platform token.
- [ ] Confirm or create a vulnerability disclosure process before any platform holds a live user
      token.
- [ ] Schedule a focused security review of the OAuth flow and media/upload boundary once
      implemented, before GA (not as a nice-to-have — §2.11 risk 6).
- [ ] Confirm the token-encryption Worker secret is provisioned as its own dedicated secret with a
      written rotation runbook, before the first `connect` flow ships.
- [ ] Confirm each platform's OAuth scope request is the minimum needed for the features actually
      shipping in that phase, re-checked at each phase boundary (v1 → Phase 2 → Phase 3) rather than
      requested once and left broad.
