# ADR 0051: Add tenant foundations without replacing the running application

Status: proposed for staged rollout. Date: 2026-09-25.

The architecture brief requires tenant-aware projects, recoverable changes, audits, environment isolation and replaceable AI providers. Current main already has billing, several providers, upload inspection, Auto Short/Clip Editor and Social Cinema foundations. The initial checkout was stale; this implementation is based on ca9a75a, preserving those features.

## Decision

Add organisations, membership, default workspaces, project metadata and append-only project audits in migration 0135. Existing `public.users` is the profile/shadow identity; no parallel profile or credit-provisioning path. Backfill only existing identified auth users. A trigger on the existing shadow-user insert provisions personal tenancy for future confirmed signups. It does not create auth users or grant credits.

Tenant reads use user JWTs and RLS through a public-key PostgREST client. Project creation/update/delete use public SECURITY INVOKER wrappers over private SECURITY DEFINER functions with empty search paths, live membership checks, restricted EXECUTE grants, rate limits and atomic audits. No browser role can mutate ownership, memberships, versions or audit rows directly. This intentionally differs from the legacy service-role-only ledger, which remains untouched.

Workspace/project roles may override inherited creative roles; owners/admins retain control, and billing-only membership does not expose creative content. Organisation membership is always required, so project grants cannot outlive its removal. Project deletion is soft; ownership transfer and membership management APIs are not introduced.

Creation idempotency is scoped to actor + operation + key and compared against normalized payload; changed payloads conflict. Metadata mutations require the current version, preventing duplicate effects/stale overwrites. They return 409 on replay of an old version; only creation promises the original replay response. Canonical timeline history is a subsequent phase.

Extract the existing provider dispatch registry intact. Do not change model pricing, chargeback/frozen-account controls, consent, webhook verification, expensive-call behavior or refund semantics. This avoids replacing newer live ledger definitions with an old baseline.

Build identity is selected by explicit APP_ENV. Default builds target local development. Staging and production select only their verified AI project IDs; unrelated product project IDs are invalid. Keep the existing default production Wrangler deployment target to preserve CI/migration tooling. Add a named staging target with no cron and no inherited production feature flags. Production CI explicitly builds APP_ENV=production; staging requires its actual PUBLIC_HOST. A production deploy must use a fresh production build, never reuse a development/staging bundle. The CSP admits the selected Supabase origin rather than broadening its allowlist.

## Rollout and rollback

TENANT_PROJECTS_ENABLED defaults false in both remote environments. Apply 0135 to the existing AI staging project through the reviewed migration process, run advisor/grant and real JWT API smoke checks, then enable the staging flag. Roll production forward only through the existing protected migration/deploy workflow. The initial implementation was local only. The authorized follow-up applied 0135 and 0136 to AI staging; see the staging rollout report. Production remains unchanged.

The feature flag gates Next APIs; RLS and mutation authorization remain mandatory and effective if authenticated users call Supabase directly. Do not treat a UI/API flag as a database security boundary.

Rollback application code/disable the flag first; retain new project/audit records. Do not drop tables after real data exists. Existing media/job/credit behavior is independent. Tenant-aware job/asset attribution, canonical project documents, quarantine/moderation services and durable Worker decomposition remain backlog items; this change does not certify the full product as production-ready.

## Auth deletion compatibility (0136)

Main's Cinema draft integration includes deleting an Auth identity while retaining financial records. Migration 0135 initially blocked that deletion through tenant foreign keys. Migration 0136 retains historical subject UUIDs on organisation/project ownership and immutable audits without a live Auth foreign key; membership and creation replay rows cascade on Auth deletion. Live membership is still required for every tenant lookup, so a retained token cannot access tenant data after identity deletion. This preserves projects and audits without rewriting history or changing the existing financial record lifecycle. A regression check covers retained-token isolation, retained project/audit rows and deletion; Cinema draft deletion checks also pass.
