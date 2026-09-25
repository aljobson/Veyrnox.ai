# AI staging rollout — 2026-09-25

User authorized continuation after the local foundation implementation. Only AI staging Supabase `yrqzwqywxfesmbvhzjgj` was mutated. AI production and the two unrelated product databases remain unchanged.

## Database

Applied committed migration 0135 (tenant foundation), then 0136 (Auth deletion compatibility). Main advanced to `590ebb2` with Cinema migration 0134, so the tenant migration and ADR were renumbered before remote application and main was integrated.

Verified both migration ledger entries, ENABLE/FORCE RLS on all seven new public tables, and a rolled-back staging SQL smoke test: authenticated role with subject claims creates only in its workspace, replays the same creation, receives an atomic audit, and cannot see another tenant's workspace. The SQL test is not a real signed-JWT HTTP test.

Existing staging feature migration gaps were not filled opportunistically. The tenant migrations depend on the existing identity tables and can operate independently. New staging has no provider/payment/backend credentials and is not a full generation environment.

Security advisors show no new warning/error; the private replay table produces an intentional informational no-policy finding, because browser roles have no table grants and only checked private mutation functions access it. Existing warnings remain for three intentionally anonymous metadata RPCs and disabled leaked-password protection. See [RLS informational guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Worker

Target: `veyrnox-ai-staging`, on the verified `al-jobson.workers.dev` account subdomain. APP_ENV and all Supabase identity settings select AI staging. PUBLIC_HOST is explicitly staging. No cron, provider/payment/R2/service-role credentials or production bindings are supplied. TENANT_PROJECTS_ENABLED remains false until signed-JWT end-to-end validation. Deployment evidence is appended below once complete.

## Validation after integrating main

- Unit/API: 641 tests, 640 pass, one pre-existing skip.
- Local full migration replay, tenant integration (14 checks including Auth deletion), and Cinema draft integration (including concurrent mutations and deletion): pass.
- Lint: zero errors, seven existing warnings; strict foundation types and migration numbering: pass.
- Client import/credential boundary check: pass, 68 modules.
- Full staging Next/OpenNext Worker build and explicit staging Wrangler dry-run: pass.

The current Supabase CLI credential returns 403 `api_gateway_keys_read` when asked for staging API keys. No permission bypass or key copying was attempted. Authenticated HTTP smoke tests need an existing staging test session. Provider/generation/refund verification needs separately configured staging-only credentials and the relevant existing migrations; no provider charges were incurred.

## Next gate

Sign in with an AI staging test account, validate deployed JWT handling, then enable staging tenant APIs and test create/read/update/replay/cross-tenant denial/soft deletion. Keep production flags off. Production migrations must follow ADR-0023's main-branch protected workflow and owner review, after staging acceptance.

## Deployment evidence

Worker deployed successfully at `https://veyrnox-ai-staging.al-jobson.workers.dev`, version `a72fa253-930b-4351-8292-d585b0bd1526`. `/app` returned 200 and its CSP contained AI staging Supabase, not production. `/api/v1/workspaces` returned 401 for missing credentials, forged internal identity headers, and malformed bearer tokens; every rejection included a request ID and private/no-store caching. No authenticated success is claimed.
