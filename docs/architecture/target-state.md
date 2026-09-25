# Target state

Retain Next.js/OpenNext and the atomic ledger. Build tenant-aware services incrementally, without duplicating the money spine or moving directories for appearance. This foundation is the first implementation phase of the brief, not the completed editor/render/social product.

Browser → authenticated edge API → policy/project/assets/generation service boundaries → Supabase relational state and private R2. The existing Next route layer remains the edge during migration. Extract internal Workers with Service Bindings when durable generation and upload inspection are implemented; do not expose internal HTTP endpoints.

Identity is the verified Supabase subject. Organisation → workspace → project is the resource hierarchy. Organisation membership is mandatory even for explicit project grants; deleting membership revokes access immediately. Project roles can restrict inherited workspace roles; organisation owners/admins retain administrative access. Viewers/reviewers cannot write, billing roles cannot read creative data. Tenant IDs from clients are selectors, never identity proof.

New project requests use the user's bearer token with the publishable key so Postgres RLS remains effective. Reads use RLS; mutations run narrowly scoped private functions that recheck live membership and write the project, idempotency record and audit in a single transaction. Reviewed lifecycle/bootstrap/mutation functions use SECURITY DEFINER with an empty search path, explicit identity checks, restricted grants and server-derived ownership. Existing service-only ledger RPCs remain isolated pending a transactional project-aware generation migration.

Private R2 masters remain private. New object keys must contain opaque organisation/project/asset/version UUIDs. Uploads enter quarantine, then inspection and moderation before use. Publication creates a separate moderated derivative; it never makes the private master or project public. Preserve the current signed-download ownership check and 15-minute maximum until project media is introduced.

Providers implement a server-only normalized submission contract. The model catalog selects the provider; UI components never import adapters or hold credentials. Unknown providers fail before debit. Transport-ambiguous submissions require reconciliation, never blind retries/failover. Future routing adds policy/governance, region, health and cost signals.

Generation target: authorize project → moderate → reserve credits → choose provider → durable submit/wait → fetch/inspect → R2 → output moderation → register asset → settle. References only in queues; no tokens, secrets or raw media. Rendering uses isolated bounded compute outside request Workers. Voice cloning stays unavailable until AAL2, consent, revocation and ownership verification exist.

Configuration selects explicit development/staging/production resources. Build-time browser identity settings must match runtime issuer configuration. Missing required settings fail closed. Provisioning separate projects/buckets/keys and production rollout are operational steps, not effects of a source-code edit.

## Specification gap map (baseline)

| Brief sections | Status | Work |
| --- | --- | --- |
| 1–5, 15–18, 88–99, 131–134 | PARTIAL | Existing multiple providers; isolate the dispatch registry and document service boundaries, retain provider independence. |
| 6–12, 83, 104 | PARTIAL | Existing auth and MFA hooks; add tenancy/RLS tests; strict session revocation remains incomplete. |
| 13–14, 32–33 | PARTIAL | Existing Clip Editor; canonical project document, autosave, timeline history and conflict UI remain. |
| 19–21, 53–62, 100–101, 124 | NEEDS-REFACTOR | Request context, errors, input limits, environment configuration; later internal binding extraction. |
| 22–28, 56–57, 63–66, 76–77, 102–103, 119, 122 | PARTIAL | Private job assets exist; tenant object keys, quarantine/inspection, provenance and deletion workflows remain. |
| 29–31, 45–49, 106–108, 114–118, 123 | PARTIAL | Atomic billing and rate limiting exist; add fingerprint conflict detection, later durable orchestration and reserve/settle. |
| 34–39 | PARTIAL | Existing audio and render orchestration; sandbox controls, voice identity permission/verification remain. |
| 40–44, 85, 120–121 | MISSING | Moderation, constrained AI tools, review/appeals and security administration. |
| 50–52, 67–71, 78–87, 109–111 | PARTIAL | Signed callbacks and secret isolation exist; audit records, security checks and threat/control documentation required. |
| 72–75, 105 | PARTIAL | Existing cinema profile/application foundations and auth Turnstile; publication/social/earnings remain. |
| 112–113, 125–130 | PARTIAL | This assessment/backlog begins required sequence; acceptance must distinguish local checks from deployed validation. |
