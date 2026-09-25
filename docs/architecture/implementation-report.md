# Implementation report — 2026-09-25

Implemented the brief’s assessment, prioritized backlog and initial P0 foundation on `codex/platform-foundation`, based on main `ca9a75a`. This is the tenant/security/provider foundation, not completion of the entire editor, rendering, moderation and social roadmap. See [backlog](implementation-backlog.md) and [target state](target-state.md).

## Delivered

- Organisations, memberships, default workspaces and project metadata with forced RLS, live membership authorization and restricted mutation functions.
- Feature-gated workspace/project APIs using the user JWT and publishable key. Creation has payload-aware idempotency; updates and soft deletion use optimistic versions. Project changes atomically write append-only audits and enforce an actor rate limit.
- Request IDs, forged-context removal, bounded inputs, safe errors, allowlisted logging and JWT/JWKS validation, including cross-issuer concurrent-outage protection.
- Explicit development/staging/production identity selection. Development defaults to local configuration; remote identities are restricted to the two verified AI projects.
- Existing five-provider dispatch extracted intact into a server-side registry. Existing credit/refund/consent/provider semantics preserved.
- Architecture assessment, gap map, threat model, control inventory, provider model, environment instructions, ADR and P0–P3 backlog. CI adds lint, strict foundation types, client import boundary checks and real PostgreSQL tenant tests.

## Database scope and rollout

Only read-only project discovery and inspection were performed remotely. No remote SQL mutations, migrations, credentials, flags or deployments were changed. The two databases belonging to the other project were not queried or modified beyond listing project metadata to distinguish them.

The only new migration is `packages/db/schema/supabase/0135_tenant_foundation.sql`. It was replayed and reapplied solely in disposable local PostgreSQL. It provisions tenants from the existing user path without changing credits or the legacy ledger. API flags default off; database authorization also protects direct Supabase access independently of these flags.

Approved targets: AI staging `yrqzwqywxfesmbvhzjgj`; AI production `xdxdzmsztyzbnzeforxx`. Follow [environment setup](environments.md) and [ADR 0051](../adr/0051-tenant-platform-foundation.md) for staged migration and rollout. The actual staging Worker origin, isolated storage/provider credentials and secondary Workers Builds environment still require operational verification.

## Verification

| Check | Result |
| --- | --- |
| Dependency install / lockfile | Installed successfully; lock updated for pinned TypeScript and Node types |
| Unit/API suite | 636 tests: 635 pass, 1 existing skip, 0 fail |
| ESLint | 0 errors; 7 existing image/hook warnings; escaped existing JSX apostrophes without display changes |
| Strict foundation TypeScript | Pass |
| Existing catalog/database source TypeScript | Pass |
| Full SQL replay | All 127 migration files applied to isolated local PostgreSQL |
| Tenant RLS/integration | 13 checks pass; migration reapplication also passes |
| Legacy ledger/catalog acceptance | All 241 tests pass |
| Reconciliation, recovery, social-cinema and creator SQL checks | Pass |
| Client credential/import boundaries | Pass, 66 client modules checked |
| Migration numbering, catalog update guards, hard-wall check | Pass |
| Dependency audit | 0 vulnerabilities |
| Production Next.js build | Pass |
| Production OpenNext Cloudflare Worker build | Pass |
| Whitespace/diff validation | Pass |

The local PostgreSQL database was set to UTC to match CI after an existing credit-expiry test initially differed by one hour across daylight saving time; the complete 241-test suite then passed. OpenNext required its full build command because a standalone Next build lacked its expected standalone manifest. No application workaround was introduced. Tests used local PostgreSQL 18; CI and staging checks remain necessary for deployment-specific validation.

## Remaining work and next step

The new project API currently stores metadata only. Canonical documents/history and UI, tenant-aware generations/assets, quarantine and moderation, durable generation orchestration, internal Worker extraction, complete session revocation and operational observability remain explicit backlog work. Existing media access controls are preserved; this change does not certify all future media/moderation requirements.

Next: review migration 0135, apply it through the protected process to **AI staging only**, run real-JWT RLS/API and existing generation/refund smoke checks, and enable the staging project API flag. Production rollout follows staging validation. Application rollback disables the flag/reverts code; retain project and audit data.

## Changed files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/ledger-tests.yml`
- `app/api/v1/generations/route.js`
- `app/api/v1/projects/[id]/route.js`
- `app/api/v1/projects/route.js`
- `app/api/v1/workspaces/route.js`
- `app/legal/aup/page.js`
- `app/veyrnox/app/create/page.js`
- `app/veyrnox/app/credits/page.js`
- `app/veyrnox/m/job/page.js`
- `docs/adr/0051-tenant-platform-foundation.md`
- `docs/ai/provider-model.md`
- `docs/architecture/current-state.md`
- `docs/architecture/environments.md`
- `docs/architecture/implementation-backlog.md`
- `docs/architecture/implementation-report.md`
- `docs/architecture/target-state.md`
- `docs/security/security-controls.md`
- `docs/security/threat-model.md`
- `eslint.config.mjs`
- `lib/supabaseJwt.js`
- `middleware.js`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `packages/db/schema/supabase/0135_tenant_foundation.sql`
- `packages/db/tenant-client.js`
- `packages/provider-sdk/registry.js`
- `packages/security/config.js`
- `packages/security/context.js`
- `packages/security/environments.js`
- `packages/security/errors.js`
- `packages/security/input.js`
- `packages/security/log.js`
- `packages/security/route.js`
- `packages/security/tsconfig.json`
- `scripts/check-security.mjs`
- `scripts/test-tenant-foundation.mjs`
- `tests/authCaptcha.test.mjs`
- `tests/foundation.test.mjs`
- `tests/securityHeaders.test.mjs`
- `tests/supabaseJwt.test.mjs`
- `tests/tenantRoutes.test.mjs`
- `wrangler.jsonc`
