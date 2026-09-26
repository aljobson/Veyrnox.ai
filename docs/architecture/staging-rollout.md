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

## Auth completion and project activation — 2026-09-25

Turnstile's existing AI auth widget initially allowed only `veyrnox.ai`. Added the exact staging Worker hostname while retaining production's entry; after propagation the staging widget displayed Success. Apple remains disabled in staging.

Staging Google Auth had a client ID but no OAuth secret, and its default Site URL was localhost with an empty redirect allowlist. Located the matching `veyrnox-web` Google client, whose callback list already included both AI Supabase projects. Added a second client secret and saved it directly to AI staging Supabase; the existing secret remains enabled and production configuration was not changed. Secrets were not printed or committed. Set the staging Site URL and exact `/auth/callback` redirect allowlist. Google authorization then returned a 302 to accounts.google.com, and the user completed sign-in in preview.

A real Google-issued session reached the protected workspace API and received the expected feature-disabled response, proving the Worker accepted its JWT before activation. This follow-up changes only the named staging project's API flag; production stays false. Authenticated mutation evidence is recorded below after verification. No generation/provider call or purchase is part of this smoke test.

Activation exposed a Worker transport failure: the tenant client's `redirect: 'error'` made workspace requests return 503 even though the same JWT could read Supabase directly. Changed to `manual`, matching the existing R2 adapter's Worker compatibility fix. Redirect responses remain unfollowed and map to safe 503 errors; a regression test checks this behavior.

Deployed staging version `b6371fbd-6ad2-43f0-8d89-260446c0fbb5` with tenant APIs enabled. Real browser-session acceptance passed: workspace list 200; another tenant's project list empty; cross-tenant create 404; create 201; identical replay 200 with the same ID; changed replay 409; read/update 200; stale update 409; ownership injection 400; soft delete 200; deleted read and replay 404. Responses included request IDs and private/no-store caching. Anonymous workspace access remained 401.

Smoke fixture `19439bd9-2366-4492-a171-23cf62030713` ended soft-deleted at version 3, with exactly PROJECT_CREATED, PROJECT_UPDATED, PROJECT_DELETED audit events. An earlier run exceeded the browser tool's response timeout but completed; SQL verified its fixture `f56fff2e-68ab-491b-89e6-c91d68204ae5` also soft-deleted with the same three audit events. No smoke projects remain active.

Validation: 663 tests (662 pass, one existing skip), strict security types, client boundary check (71 modules), staging Next/OpenNext build and deployment passed. Build lint reports seven existing warnings. Next product work is the workspace/project UI and canonical versioned project document (M01); production promotion remains gated separately.

## Cinema Stream staging preparation — 2026-09-26

Goal: make AI staging (`yrqzwqywxfesmbvhzjgj`, Worker `veyrnox-ai-staging`) able to host isolated live Stream upload tests (ADR-0052/0053/0054) without touching production. Only the AI staging database was mutated; no Worker flag, secret, cron or Cloudflare resource was changed in this step.

### Database

Staging had never received the feature migrations that production applied through the protected workflow: it jumped from 0120/0122 to 0135/0136/0140. Every Cinema table, and all three Stream migrations, were absent. The full gap was closed by applying, in order, `0121, 0123, 0124, 0125, 0126, 0127, 0128, 0129, 0130, 0131, 0132, 0133, 0134, 0137, 0138, 0139` from the committed files, unchanged. Each catalog UPDATE migration's exact ROW_COUNT assertion passed, so staging's catalog and credit-pack rows matched the state those migrations expect.

Verified afterwards: the staging migration ledger lists every committed file from 0121 through 0140; all seven `cinema_*` tables have ENABLE and FORCE RLS; the thirteen Cinema/Stream RPCs (`reserve/attach/read/observe_cinema_upload`, `claim/finish_cinema_upload_checks`, `request/claim/finish_cinema_upload_removal`, `cinema_upload_owner`, `save_cinema_draft`, `create_cinema_profile`, `review_cinema_creator`) exist as SECURITY DEFINER; and `cinema_uploads_state_check` includes `deleting`/`deleted`, proving 0139 replaced 0137's constraint.

Note for anyone reading the Supabase project list: the org holds four projects. The committed `wrangler.jsonc` binds production to `xdxdzmsztyzbnzeforxx` (`veyrnox-ai-production-eu`) and staging to `yrqzwqywxfesmbvhzjgj` (`veyrnox.ai staging`). The two other similarly named projects belong to the separate wallet product and were not touched.

### Remaining prerequisites (owner-local; not possible from a cloud session)

These need the Cloudflare dashboard (Apple sign-in) and an authenticated `wrangler` login, which a hosted session does not hold. Secret values are never pasted into chat, logs or this document.

1. **Token.** At `dash.cloudflare.com/profile/api-tokens` create a custom token: Account → Stream → Edit, scoped to account `fb18d9f7052afbea5a5e0eae69948af2` only. No Workers or zone permissions. Verify before storing: `GET https://api.cloudflare.com/client/v4/accounts/fb18d9f7052afbea5a5e0eae69948af2/stream?limit=1` with `Authorization: Bearer <token>` must return `success: true` (the existing Wrangler OAuth login returns 403, error 10000).
2. **Inspect the existing webhook first.** `GET …/stream/webhook` with the new token. Stream allows one subscription per account; if a `notificationUrl` exists that is not ours, stop and decide before overwriting.
3. **Point the webhook at staging.** `PUT …/stream/webhook` with body `{"notificationUrl":"https://veyrnox-ai-staging.al-jobson.workers.dev/api/webhook/cinema-stream"}`. The response's `result.secret` is the value for `CINEMA_STREAM_WEBHOOK_SECRET`. Because the subscription is account-wide, production `veyrnox-ai` receives no Stream callbacks while staging owns it; that is acceptable only while production Cinema flags stay `false`.
4. **Secrets on the staging Worker only** (`--env staging`): `CINEMA_STREAM_API_TOKEN`, `CINEMA_STREAM_ACCOUNT_ID` (`fb18d9f7052afbea5a5e0eae69948af2`), `CINEMA_STREAM_WEBHOOK_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` from the **staging** project's API settings. `packages/db/supabase-client.js` sends the key as both `apikey` and `Authorization: Bearer`; the legacy `service_role` JWT is the proven format. A modern `sb_secret_…` key must be confirmed with one authenticated `/rest/v1/rpc/reconcile_status` call against staging before relying on it.
5. **Then** (a separate change, after 1–4 are verified): set `CINEMA_ENABLED`, `SOCIAL_CINEMA_PROFILES_ENABLED`, `CREATOR_APPLICATIONS_ENABLED`, `CREATOR_CONTENT_ENABLED`, `CREATOR_UPLOADS_ENABLED`, `CINEMA_UPLOAD_RECOVERY_ENABLED`, `CINEMA_UPLOAD_REMOVAL_ENABLED` to `"true"` in `env.staging.vars` and give staging the `*/5 * * * *` cron so recovery and removal run. Staging vars do not inherit production's, so today these are unset on staging and every Cinema route answers 503. Production keeps all of them `false`.
6. Bootstrap one test viewer → creator (application + aal2 administrator review), then run the ADR-0052/0053/0054 live checks: upload, pause/resume, processing, signed webhook, missed-callback recovery, removal, replacement, and that removal invalidates an already-copied tus URL.
