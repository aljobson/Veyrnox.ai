# ADR-0049 — Gated Cinema creator applications

Status: Proposed, 25 September 2026. Extends ADR-0048 and the mandatory Cinema security overlay.

## Decision

Reuse opt-in Cinema profiles and the existing verified JWT/RPC boundary. Migration 0133 adds one private creator application per existing profile and append-only review records. A viewer applies with a 20–1,000 character statement. Creation/replay locks the existing identity and membership; identical key/payload returns the current application; changed payload conflicts. Applications cannot change role, status, ownership or financial state. Rejected applications are terminal in this slice; support/reapplication policy is future work.

Only an active `cinema_memberships.role=administrator` may list/review. Existing `users.is_admin`, creator or moderator roles confer no permission. The administrator scope here grants only review of creator applications, not finance or general role management. No role is bootstrapped or granted automatically by this migration. Before preview activation, an owner-approved operational migration must assign the intended Cinema approver explicitly; no ad-hoc production SQL or self-service grant endpoint.

Review requires AAL2 and a TOTP authentication event within 300 seconds (5 seconds future skew). `middleware.js` derives a new internal freshness header only from signature-verified, claim-validated Supabase `amr` entries and strips inbound copies. JWT `iat` or a token-refresh event is insufficient. The database rechecks freshness against its own clock. The UI permits a new TOTP challenge even for an existing AAL2 session. Other MFA methods fail closed in this initial TOTP-only flow.

Privileged HTTP routes additionally verify a Cloudflare Access assertion against configured team/audience with no internal or unconfigured bypass. Middleware identity and the authoritative Cinema role remain independently required. Existing edge admin screening and the durable account quota apply; the shared bucket allows 120 account requests per minute, while one application per identity bounds creation. The first 50 active pending applications are returned, oldest first; reviewing and refreshing advances the queue.

Review rejects self-review, inactive accounts, previously decided applications and incompatible target roles. A decision and creator-role promotion are atomic and lock the application/membership. An identical reviewer/key/payload replay is a no-op; a competing reviewer cannot decide twice. Approval grants creator only; it does not enable upload, publication, monetisation or payouts. Audit rows retain request ID, actor/application opaque IDs, decision, reason and time. Table access and truncation are revoked from all browser/service roles; triggers prevent UPDATE/DELETE. Application/profile data cascades with account deletion; audit references deliberately survive without storing contact/profile data. Retention and restricted review-reason policy still need launch approval (G10).

Migration 0133 also closes the backend portion of G01: restricted, suspended and banned Cinema accounts cannot read/create/replay a profile or read/create an application. This policy applies to Cinema surfaces only; existing billing Frozen behavior, account recovery, deletion and generation services remain unchanged.

## API and rollout

- GET/POST `/api/v1/creators/apply`: own application.
- GET/POST `/api/v1/admin/cinema/creators`: private approval queue and decisions.
- UI: profile preview offers the application; `/app/admin/cinema` hosts review and fresh MFA.
- Server gates: `CINEMA_ENABLED`, `SOCIAL_CINEMA_PROFILES_ENABLED`, `CREATOR_APPLICATIONS_ENABLED`, all exact `true`; all remain false in production. Existing local preview gate still controls the profile UI. Flags are availability controls, never permissions.

The new APIs validate field allowlists, content type, UUIDs, lengths, body bounds and idempotency keys. Responses are no-store with a generated request ID; redacted events record route/action/status/code. No statement, reason, credential, provider payload or token is logged. Unknown backend failures return a stable generic error.

Apply only through the reviewed main-branch migration workflow, after checking numbering/main again. Activation requires the 24-hour reconciliation gate, explicit approver provisioning, real signed-in/Access/TOTP preview evidence and applicable security gap closure. G05 CI scanner coverage and G08/G09/G10 operational verification remain open; merging disabled code is not permission to launch. Roll back by keeping gates disabled; do not delete applications or audit history or rewrite applied migrations.

## Evidence required

Unit tests cover freshness, header ownership, strict API inputs, flags, rate denial, Access denial, role errors, request correlation and unknown-error redaction. The isolated database script replays migration twice and checks ownership, roles, general-admin denial, inactive accounts, stale/future MFA, self-review, changed-key replay, concurrent review, permissions, immutable audit and unchanged credit balances. CI runs it after the original foundation regression script.

Browser preview must verify application submit/reload/retry, account switch/sign-out, admin MFA refresh, approve/reject/race refresh and 360px layout. Local unauthenticated rendering is not a substitute for the authenticated launch evidence.

## PR security record

New boundaries: applicant to reviewer and reviewer to creator-role mutation. Private data: application text and audit reason. Money: none. External calls: existing Supabase RPC and Access JWKS only. New runtime dependencies: none. Required controls: strict validation, scoped server permission, ownership, fresh TOTP, verified Access, durable quota, atomic idempotency and immutable audit. Threats: T01/T02/T03/T09/T11. ASVS evidence is partial and versioned in the Cinema mapping; no compliance claim.
