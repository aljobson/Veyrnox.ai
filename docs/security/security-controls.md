# Security controls and release gates

S1/S3: resource lookup under user JWT/RLS; private download ownership checks; tenant membership revocation tests. S2: adapters server-only; no provider keys in public configuration. S4: existing jobs identify users; project attribution is a subsequent transactional migration. S5: existing credit lock/rate limit and replay handling remain authoritative. S6/S7: bounded JSON and strict schemas; provider handles validated; media inspection still pending. S8: voice cloning unavailable. S9: publication unavailable until separate moderation workflow. S10: transactional project audits; extend to legacy admin operations before claiming complete coverage.

Use a fresh server request UUID and strip all inbound `x-veyrnox-*` context. Trust AAL only from a verified JWT; roles come from live database membership, never user_metadata. Bearer-only authentication is retained. Reject disallowed browser origins; never allow wildcard authenticated CORS.

New APIs return `{error:{code,message,requestId}}`. Existing endpoints keep string errors for compatibility. Responses containing identity or signed URLs use `Cache-Control: private, no-store`, `nosniff` and request IDs. Unexpected errors expose only a generic code. Structured logs contain allowlisted identifiers/status; never serialize exceptions, prompts, tokens, signed URLs or upstream bodies.

Project mutation and audit must commit in one database transaction. Audit rows are append-only and contain actor/resource/request identifiers, action and outcome, not project documents. Browser roles cannot insert audit rows or mutate membership. Project document updates use optimistic version checks. Idempotency conflicts return 409 rather than silently accepting a changed request.

## Verification

Run install, lint, strict foundation typecheck, unit/API tests, PostgreSQL RLS/integration tests (after full migration replay), legacy ledger/catalog tests, security checks and production build. Local RLS tests run real PostgreSQL in an isolated cluster; CI uses a PostgreSQL service. No integration suite may target production. Test invalid/expired/tampered tokens, cross-issuer keys, forged internal headers, cross-tenant reads/writes, role escalation, removed membership, replay/conflict, bounded bodies and audit rollback.

## Operational acceptance (required before rollout)

Reuse the verified AI staging and production Supabase projects; provision/check separate R2 buckets and provider credentials per environment; disable R2 public endpoints; apply reviewed migrations on staging; check database advisors and grants; validate auth/JWKS and signed downloads on staging; exercise generation/refund; configure log retention/export and alerts; verify protected deployment pipeline and rollback. Source tests cannot prove these settings. Production migration/deployment is not performed by this phase.
