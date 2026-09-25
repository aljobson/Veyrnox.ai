# Prioritized implementation backlog

This implements the brief's assessment → backlog → P0 sequence. Each item requires evidence before it is marked complete. Product phases beyond P0 remain explicit work, not implied completed features.

| ID / priority | Description / affected files | Dependencies | Security / test requirements | Acceptance |
| --- | --- | --- | --- | --- |
| F01 P0 | Config and environment isolation: `next.config.mjs`, `wrangler.jsonc`, `packages/security/config.js`, `environments.js` | None | Missing/invalid settings deny; prod cannot be selected implicitly | No hard-coded prod client default; separate named deployments |
| F02 P0 | JWT/context/error hardening: `lib/supabaseJwt.js`, `middleware.js`, `packages/security/*` | F01 | Forged headers, bad claims, key isolation/rotation, origins, body caps | Verified context; safe errors and no-store headers |
| F03 P0 | Tenant schema/RLS: `packages/db/schema/supabase/0135*`, tenant client | F02 | Two tenants, revoked membership, viewer/editor/admin permissions, no escalation | Personal org/workspace provisioning; RLS-enforced projects |
| F04 P0 | Audit and idempotency: foundation SQL, `packages/security/*` | F03 | Append-only audit, transaction rollback, replay/conflicting payload tests | Project changes atomic with audit; fingerprint conflicts rejected |
| F05 P0 | Provider contract: `packages/provider-sdk/*`, generations route | F02 | Invalid provider/handle, no client imports, no raw exception logging | All five existing providers retained through extracted registry; unknown providers fail before debit |
| F06 P0 | Private media boundary: asset routes, security docs | F02 | Existing ownership and TTL tests; no-store responses | Preserve private access, document quarantine migration; no upload bypass |
| F07 P0 | CI/checks: `package.json`, scripts, workflows, tests | F01–F06 | Run full unit/integration/build/audit; enforce RLS and import boundary checks | Repeatable local/CI verification; report real blockers |
| M01 P1 | Canonical versioned project document, autosave UI, history | F03/F04 | Input bounds, stale updates, restore and project UUID consistency | Non-destructive saved projects and conflict UI |
| M02 P1 | Project media, R2 bindings, quarantine/inspection service | F03/F06 | Magic bytes, size/duration, malware, cross-tenant keys/downloads | Only inspected/moderated media usable; original immutable |
| M03 P1 | Project-aware generation, reserve/settle, moderation, durable Queues/Workflows | F03/F05/M02 | Atomic project auth + credit reservation; callback race/ambiguous submit tests | Every new generation project-attributed, moderated, recoverable |
| M04 P1 | Internal Worker extraction using Service Bindings | M03 | No public internal routes; verify identity at boundary | Generation/assets/moderation independently deployable |
| M05 P1 | Editor timeline, trim/crop/text/captions/audio/transitions | M01/M02 | Versioned schema, XSS/input tests, non-destructive originals | Editable timeline persists and restores |
| M06 P1 | TTS/STT/dubbing and voice permissions | F03/M03 | Consent, AAL2, revocation, impersonation testing | Authorized voice only; cloning disabled until verification ready |
| M07 P1 | Isolated render queue and FFmpeg export presets | M05 | Non-root sandbox, arguments not shell, time/resource/network limits | Async 1080p 9:16/16:9/1:1 exports in R2 |
| M08 P1 | Publication, Stream delivery, moderation/reports | M03/M07 | Private master never public, playback auth, separate publication state | Moderated video pages and revocable publishing |
| S01 P2 | Provider governance/health/region router, budgets/entitlements | M03 | Confidential-data routing; concurrency/daily-spend tests | Policy-aware replacement without UI rewrite |
| S02 P2 | Strict session revocation, MFA flows, Turnstile risk, admin audit | F02/F04 | AAL2 bypass/revoked-session tests | Sensitive operations reauthorize against live state |
| S03 P2 | Provenance, retention/deletion workflows, backups/restore | M02/M08 | Ownership-transfer, retained ledger, orphan media tests | Auditable deletion and tested recovery |
| S04 P2 | SAST, secret scanner, SBOM, observability/alerts | F07 | CI permissions, log redaction, dependency review | Protected releases and monitored service budgets |
| A01 P3 | Social/cinema competitions, voting and creator ledger | M08 | Unique votes, bots, reporting, immutable earnings | Moderated social product; independent payout controls |
| A02 P3 | Collaborative DO editing, enterprise SSO/SCIM/passkeys | M05/S02 | Live revocation, presence isolation, tenant policy | Collaboration and enterprise identity without auth divergence |
