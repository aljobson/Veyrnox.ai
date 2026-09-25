# Cinema security test plan and API inventory

Assessment only, 25 September 2026. No production testing, payment, upload or identity mutation is authorized by this document itself. Use isolated preview resources, synthetic accounts and test provider keys. Each feature includes functional, abuse, security and failure tests in the same PR. Never weaken protections to make a test pass.

## Current Cinema API inventory

| Method and route | Identity / permission | Data and controls | Status |
| --- | --- | --- | --- |
| GET `/api/v1/social-cinema/profile` | Verified Supabase subject, own profile | No target ID; durable account quota; no-store; service-only read | Implemented, registration feature disabled; G01 applies |
| POST `/api/v1/social-cinema/profile` | Verified Supabase subject, existing provisioned user | UUID replay key; only username/display_name/bio; bounded body; durable quota; fixed viewer role | Implemented, disabled; G01 applies |
| GET `/social-cinema` | Public | Development information only, no private content | Live entry |
| GET `/cinema` | Public | Redirect to development entry | Proposed separately in PR #326 |

No creator, content, Cinema playback, voting, subscription, earnings, payout or Cinema moderation endpoints exist on the assessed main. The source spec's suggested routes are planned, not an inventory of accessible APIs. Existing `/api/webhook/stripe` handles generation credit top-ups, not Cinema subscriptions. Existing `/api/v1/uploads` is generation source upload, not Stream film publishing.

Each future route must add owner, version, schema, role/status/ownership rule, data classification, rate/body limits, cache/origin policy, flag, audit events and deprecation plan here. Remove retired routes deliberately and test rejection; do not leave an old version bypassing new policy.

## Required tests and evidence

| Test group | Required negative/failure coverage | Existing reusable tests / new evidence |
| --- | --- | --- |
| Authentication (T01) | Missing, malformed, expired, tampered, wrong issuer/audience/purpose, future validity, JWKS failure/rotation, spoofed identity headers | `supabaseJwt.test.mjs`, `adminMfaGate.test.mjs`, `authClientRefresh.test.mjs`; add uncovered purpose/time cases and provider E2E |
| Account/session (T01/T02) | Banned/restricted status, sign-out/account switch, recovery replay/enumeration, stale or missing step-up, refresh must not reset auth freshness | `accountSecurity.test.mjs`, `accountCacheIsolation.test.mjs`, `authGateLifecycle.test.mjs`; Cinema status/freshness tests required |
| Authorization (T02/T03/T09) | Viewer→creator, creator A→B list/detail/mutation, user→admin, moderator→finance, self-approval, injected role/owner/status | `socialCinemaProfile.test.mjs`, isolated foundation script; new role matrix, IDOR and admin tests required |
| Input/consumption (T04/T10) | Unknown fields, wrong types, huge/slow/chunked body, malformed path/header, shared and per-user quota bypass, 1,000 replay attempts | Profile/body/rate tests reusable; new durable concurrent creator/vote/playback quotas required |
| Upload (T04) | Non-creator, wrong content owner, grant expiry/replay, excessive size, deceptive MIME, cancelled/resumed upload, forged/delayed webhook, malicious URL/redirect | Existing generation upload tests are only patterns; real isolated Stream integration required |
| Playback (T05) | Draft/removed/age/region restricted, no entitlement, expired/refunded subscription, banned account, URL/cache leakage, stolen playback session | NOT IMPLEMENTED; verify short grant lifetime, revocation policy and account isolation |
| Subscription (T06) | Changed client price, forged signature, duplicate/out-of-order event, wrong environment/currency/product, renewal/cancel/expire/refund/chargeback | Stripe top-up suites are reusable patterns, not Cinema coverage; new integration tests required |
| Cash/payout (T07/T08) | Duplicate earning/payout, deterministic integer allocation/remainder, reversal, settlement hold, stale MFA/relink, unavailable funds, concurrent release | NOT IMPLEMENTED; independent reconciliation and provider test-mode evidence required |
| Social/moderation (T09/T10) | Duplicate/out-of-window votes, banned user, bot view loop, self-referral, report spam, malicious text/AI instructions, moderator privilege bypass | NOT IMPLEMENTED; transactional uniqueness, lifecycle/risk and human-review tests required |
| Privacy/audit (T11) | Other-user cache/read, public evidence leak, secret log, deletion without losing retained accounting, audit edit/delete | Existing profile/R2 patterns; new data inventory, deletion and append-only audit tests required |
| Delivery (T12) | Secret scanner detection, SAST finding blocks, vulnerable dependency blocks, rejected schema drift, action scope, rollback | Existing CI audit/sink/migration gates are partial; scanner fixtures and deployed control evidence required |

All test filenames above are under `tests/` unless identified as scripts. Security evidence must name the commit, command/workflow, result and date; mocked unit tests do not establish provider configuration or runtime access policy.

## CI and manual release gates

Per PR: unattended lint, relevant type checks, unit tests, isolated database replay and integration tests, secret scanning, SAST, dependency audit, migration validation, production build, threat-model and ASVS evidence update. Existing CI does not yet provide every gate (G05). Do not mark missing gates green.

Before launch: scoped DAST and API penetration tests, two-account IDOR/business-logic testing, payment/refund/payout test-mode scenarios, session/recovery tests, mobile tests when a client exists, keyboard/screen-reader checks and load/abuse testing. Exercise creator registration→approval→upload→moderation→publication→subscription→playback→vote→earning→payout with failures and retries. No critical/high unresolved finding without explicit recorded, time-limited owner risk acceptance; other findings need owner and due date.

## Creator onboarding increment (ADR-0049; disabled pending rollout)

GET/POST `/api/v1/creators/apply` accept the verified subject only. POST accepts only `statement` and a UUID Idempotency-Key. Active viewer/profile required for initial creation; reads and replay require active membership. GET/POST `/api/v1/admin/cinema/creators` additionally require verified Access, recent TOTP/AAL2 and an active Cinema administrator; POST allows only `application_id`, `decision`, `reason`. Unknown fields and invalid body/header values are rejected. Both use the durable shared 120/min account quota, no-store responses and generated request IDs. POST limits: statement 20–1,000, review reason 3–500 characters, JSON body bounded by existing request-body limiter. No financial data or uploads accepted.

New automated evidence: `tests/cinemaCreatorApi.test.mjs`, `tests/cinemaStrongAuth.test.mjs`, extended `tests/socialCinemaProfile.test.mjs`, and `scripts/test-cinema-creators.mjs` against isolated Postgres through `ledger-tests.yml`. Preview browser/real MFA/provider evidence remains a required activation gate. No endpoint is deprecated by this increment.

## Private content increment (ADR-0050)

Run `tests/cinemaContentApi.test.mjs` and isolated `scripts/test-cinema-content.mjs`. Cover role/status denial including replay after revocation; foreign parent/read/edit; duplicate position and concurrent revision races; malformed authority/media fields; direct table/function grants; bounded lists; account deletion and unchanged credits. In authenticated preview, exercise series → season → episode, edit/reload, a stale second tab, failed-response retry, account switch/sign-out and 360px keyboard-accessible forms. A signed-out screenshot alone is insufficient for launch.
