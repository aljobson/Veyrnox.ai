# Handover to Codex: BytePlus ModelArk track, 26 September 2026

Written by the Claude Code session that shipped PRs 340, 341, 342, 345, 347, 348 and 350.
Everything below is on `main` as of commit 87e2504. Read `CLAUDE.md` first; it is the rule
book and nothing here overrides it. Then read this file, then ADR-0058.

## Why this track exists

The owner asked why syntx.ai sells video far below us. The answer, in
`docs/pricing/syntx-competitor-analysis-2026-09-26.md`, is subscription breakage plus
grey sourcing plus thinner margins, not a cheaper wholesale API. The follow-up survey
(`docs/pricing/wholesale-survey-2026-09-26.md`) found one real lever we were missing:
ByteDance's own platform, BytePlus ModelArk, sells the Seedance family at roughly 40%
under everyone else once its prepaid resource packs are used, with no commitment.
ADR-0058 adopts it. The adapter is built and staged inactive. Four compliance controls
that BytePlus's terms require of us are built. What remains is account setup and
activation, which are owner tasks, and the open items listed at the end.

## What shipped today, in order

| PR | Commit | What |
|---|---|---|
| 340 | f49ca5b | syntx.ai competitor analysis and Veyrnox / Higgsfield / syntx comparison |
| 341 | 9593f57 | Wholesale price survey: cheapest verified source per video and audio model, floor credits |
| 342 | 8846a04 | BytePlus cost levers, account constraints, resale terms (full-site crawl) |
| 345 | 61bb6e4 | ADR-0057, later renumbered to ADR-0058 in 347 |
| 347 | d473b2e | BytePlus adapter, sweep, registry entry, capability records, migration 0145, verify script, tests |
| 348 | b4afab0 | Platform Customer controls: violations log and RPCs, admin route, rights attestation, runbook, controls map, migration 0146 |
| 350 | f80dfd4 | Admin violations UI with user lookup, migration 0148 |

Docs: `docs/pricing/*2026-09-26*`, `docs/adr/0058-byteplus-modelark-provider.md`,
`docs/compliance/platform-customer-controls.md`, `docs/agents/incident-response.md`.

## Where the code lives

| Piece | Path | Notes |
|---|---|---|
| Adapter | `packages/adapters/byteplus.js` | `buildRequest`, `submitTask`, `fetchTask`, `interpretTask`. Fixed host `ark.ap-southeast.bytepluses.com`, bearer key, `redirect: 'manual'`, 64 KB response cap. No callback is registered: ModelArk's callback is unsigned. |
| Capability records | `lib/additionalModelCapabilities.js` | Five `byteplus:*` records via `byteplusVideo(model, {audio})`. 5s, 720p, aspect 16:9/9:16/1:1/4:3/3:4, optional first-frame image capped 4096x4096. `assumes.service_tier = 'default'`; do not send `flex` for 2.x (unsupported) and note `flex` halves Seedance 1.x prices if ever wanted. |
| Registry | `packages/provider-sdk/registry.js` | `byteplus` entry; key only when R2 is configured. |
| Sweep | `lib/byteplusSweep.js`, task `byteplus` in `worker.js` | Poll-only completion, modelled on `lib/grsaiSweep.js`. 45-minute timeout, `.mp4`, `expectMp4`, 60 MB cap, five concurrent reads, serial copies. |
| R2 allowlist | `packages/adapters/r2Copy.js` | `byteplus: { hosts: [], suffixes: [] }`, deliberately empty. Fill from a live output host before activation. |
| Catalog rows | migration `0145_byteplus_seedance_staged.sql` | Five rows inactive: seedance-2.0-fast/mini/2.0/2.5/1.0-pro-fast-byteplus at 20/13/27/39/6 credits, costs are pack rates. Also widened the `worker_task_health` task CHECK and carried `refresh_recovery_health` forward from 0139 with a byteplus line. |
| Verify script | `scripts/verify-byteplus-endpoints.mjs` | `node scripts/verify-byteplus-endpoints.mjs` is free (plan). `--submit` spends BytePlus balance, polls, reports output host, redirect behaviour, billed tokens x pack rate vs recorded cost, writes `byteplus-verify-<ts>.json`. |
| Violations log | migration `0146_content_violations_and_rights_attestation.sql` | `account_actions` gains `warning`, `takedown`, `job_id`. `record_content_violation` (admin-checked, takedown deletes the job's `assets` rows and queues R2 keys, third takedown calls `freeze_account` with reason `content:third_takedown`). `list_content_violations`. `attest_upload_rights` and `users.rights_attested_at` / `rights_attestation_version`. |
| Admin API | `app/api/v1/admin/violations/route.js`, `app/api/v1/admin/users/lookup/route.js` | Same three gates as `admin/metrics`: middleware identity, `ADMIN_REQUIRE_AAL2` flag, RPC `is_admin` check (42501 `not_admin`). |
| Admin UI | `app/veyrnox/app/admin/violations/page.js` | Lookup by email, user id or job id; user standing; last 25 jobs; warning and per-job takedown forms with required reason and third-strike notice; append-only record. Linked from `/app/admin`. |
| Lookup RPC | migration `0148_admin_user_lookup.sql` | `admin_lookup_user(p_auth_id, p_email, p_user_id, p_job_id)`. |
| Gateway | `app/api/v1/generations/route.js` | After `job_consent_attested`, also calls `attest_upload_rights` with `RIGHTS_ATTESTATION_VERSION = 'aup-2026-09-26'`. Bump the constant when the AUP wording or the create-page checkbox text changes. |
| Account API | `app/api/v1/account/route.js` | Returns `rights_attested_at` and `rights_attestation_version`; the rate-limit fallback body carries them too. Tests deepEqual the whole body, so any new field must be added in both places and in `tests/appNavAccount.test.mjs` and `tests/accountReadLimit.test.mjs`. |
| Library | `app/veyrnox/app/library/page.js` | "AI generated" chip on every asset card (top right, shifts left when the edit checkbox is shown). |
| Tests | `tests/byteplusAdapter.test.mjs`, `tests/byteplusSweep.test.mjs`, `tests/adminViolations.test.mjs`, `tests/adminUserLookup.test.mjs`, additions in `tests/modelCapabilities.test.mjs` (CATALOG list), `tests/r2Copy.test.mjs`, `tests/uploadConsent.test.mjs` | `npm test` was 748 pass, 0 fail at f80dfd4. |

## Rules that bit today, beyond CLAUDE.md

1. **Concurrent sessions share this repo and its numbers.** ADR-0057 and migration 0142
   were both taken by a Cinema session between branch start and push; the ADR merged as a
   duplicate and had to be renumbered. Before pushing any ADR or migration, run
   `git fetch origin main && git ls-tree --name-only origin/main docs/adr/ | tail -3` and the
   same for `packages/db/schema/supabase/`, and check open PRs with
   `gh pr diff <n> --name-only`. At the time of writing the next free numbers are
   **ADR-0061** and **migration 0151**.
2. **`refresh_recovery_health` is redefined by whichever migration touched it last.** 0131,
   0138, 0139 and 0145 each carry a full body. If you touch it, start from the latest body
   (currently 0145's, which includes the Cinema counts and the byteplus line) or you will
   silently drop someone else's health checks. Check 0149 and 0150 in case they changed it.
3. **`worker_task_health.task` has an inline CHECK.** A new cron task needs the constraint
   dropped by its generated name and re-added, plus the task name in
   `scripts/check-recovery-health.mjs` TASKS. See 0145 for the pattern.
4. **New catalog rows never go live in the migration that creates them.** Stage inactive,
   verify live, then a second migration flips `active` with the evidence in its header
   (0111 then 0124 is the precedent). Catalog `UPDATE`s from 0111 onward must assert
   ROW_COUNT; `scripts/check-catalog-update-guards.mjs` enforces it.
5. **Admin RPCs check `users.is_admin` themselves** and raise `'not_admin'` with errcode
   `42501`; routes map that to 403. Copy `ops_metrics_24h` (0032), not a route-only check.
6. **`freeze_account` has no EXECUTE grant on purpose.** Only owner-owned SECURITY DEFINER
   functions may call it; `record_content_violation` does. Never grant it.
7. **Provider callbacks are only ever a hint.** kie and OpenRouter callbacks trigger an
   authenticated re-read; BytePlus's is unsigned so it is not even registered. Completion
   always comes from a `fetchTask` with our key, then `completeJob` in
   `lib/providerCompletion.js`.
8. **The gateway drops client media URLs unconditionally.** Only a server-signed upload
   (`source_keys`) can be a model source, and it requires `consent: true`. Do not add a path
   that forwards a client URL.
9. **`gh pr merge` from a worktree.** Auto-merge is enabled on the repo now, but
   `set_auto_merge` fails with "clean status" when checks are already green; then
   `gh pr merge --squash` directly. If it prints "main is already used by worktree", the
   merge already happened; verify with `gh pr view --json state`, delete the remote branch
   by hand, never retry.
10. **kie.ai's "no-go" in ADR-0020's status line is stale.** kie is live in production and is
    our cheapest verified source for Veo, Wan, Hailuo and Kling 2.6. Read the ADR's
    2026-09-24 update, not its header.
11. **Local Postgres.** No Docker on the owner's Mac; see the memory note
    `local-postgres-for-acceptance-tests` if you need to replay migrations locally
    (embedded-postgres 18.4 vs CI's 16, `-c timezone=UTC`, short socket dir). CI's
    `acceptance` job replays every migration on a fresh Postgres; a migration that fails
    there is the usual reason a PR goes red.
12. **Lint.** `npm run lint` must have 0 errors. The `react-hooks/exhaustive-deps` warning on
    a `generation.current` cleanup is a known, accepted pattern in the admin pages.

## Activation list for BytePlus (owner tasks first, then engineering)

From ADR-0058 "Before activating any row". Do not skip any.

1. Owner: verified BytePlus **enterprise** account in the UK company's name with corporate
   tax ID (0% VAT, 600 RPM / 10 concurrent instead of 180 / 3). `wrangler secret put
   BYTEPLUS_API_KEY`.
2. Owner: written answer from BytePlus on whether the "not available in the United States"
   clause covers end-user location. Until recorded in ADR-0058, US traffic (`cf-ipcountry`)
   must not route to BytePlus rows; that gateway rule is **not yet built** (see open items).
3. Owner: written confirmation that a consumer app with the four controls in
   `docs/compliance/platform-customer-controls.md` is a permitted "own use" platform under
   their Service Specific Terms 4.2.3.
4. Engineering: privacy page (`app/legal/privacy/page.js`) names BytePlus Pte. Ltd. as a
   processor in Singapore. Prompts and reference images leave the UK and EU.
5. Engineering: `node scripts/verify-byteplus-endpoints.mjs --submit` once per row. Record
   the output host in `packages/adapters/r2Copy.js` (`byteplus` entry) and in the activating
   migration's header. Billed tokens x pack rate must match the recorded cost within 5%.
6. Owner: buy Seedance 2.0 / Fast / Mini / 2.5 resource packs sized for at least 30 days of
   expected use. Minimums $30 to $42, three months, non-refundable.
7. Engineering: the `byteplus_pack_balance` reconcile check (see open items), green for 24 h.
8. Engineering: activation migration that flips the five rows `active`, switches the
   OpenRouter `seedance-2.0-fast` row off, and cites the evidence. Follow 0124's DO-block
   with exact ROW_COUNT asserts.

## Open items, in priority order

1. **US routing guard** (ADR-0058 decision 9). In `app/api/v1/generations/route.js`, before
   the debit, if `modelRow.provider === 'byteplus'` and the request's `cf-ipcountry` header is
   `US`, refuse with 451 (or fall back to a fal/kie twin if one is active). Test it. This
   must exist before activation unless BytePlus answers item 2 favourably in writing.
2. **`byteplus_pack_balance` reconcile check** (ADR-0058 consequence 3). Pack exhaustion
   moves Seedance 2.0 Fast from $0.35 to $0.60 list, which needs 34 credits, not 20. Read the
   remaining pack quota (Billing Center or API), fail when it covers under 48 hours of
   trailing usage, and deactivate the rows when it reaches zero. Wire it into the recovery
   health snapshot like the other counts.
3. **Notify the user on a warning or takedown.** The record exists; the email does not.
   Cloudflare Email Service is the sending path in this repo.
4. **Privacy page processor entry** for BytePlus (activation item 4).
5. **Seedance 1.5 Pro** is the cheapest Seedance anywhere ($0.0875 on kie) but BytePlus has
   retired it upstream. Not adopted; do not add it without checking kie still lists it.
6. **ElevenLabs Music direct** is four times cheaper than fal ($0.15 vs $0.60 per minute) and
   **ElevenLabs TTS on kie** is 40% under fal; both are candidate provider swaps, listed in
   the wholesale survey's "catalog rows where a cheaper verified source exists".
7. **Kling 3.0 via kie** at $0.45 (1080p, no audio) vs our fal cost $0.56: a route swap
   worth 20%, same staged-then-activate pattern as the kie twins in 0105/0106.

## How to verify your work before opening a PR

```bash
npm test                                  # node --test, all of tests/**
npm run lint                              # 0 errors required
npm run test:security                     # client boundary: no server secrets reachable
bash scripts/check-migration-numbers.sh   # duplicate or gapped numbers
node scripts/check-catalog-update-guards.mjs
```

For anything with a UI, run the dev server through the app's preview tooling (or
`npm run dev`) and load the page signed out; it should render the layout and the sign-in
gate with no server errors. Signed-in admin flows need the live Supabase project and an
`is_admin` account and cannot be exercised locally.

Commit message style: `type(scope): summary`, body in sentences, no `Co-Authored-By`.
Open the PR against `main`, then `gh pr merge <n> --auto --squash` (it merges immediately
when checks are already green). Delete the remote branch after the merge.

## What not to do

- Do not chase syntx.ai's Kling 3.0, Seedance 2.0, Suno or Midjourney prices. Those rows
  are below any wholesale we can buy or come from grey channels. Suno has no official API
  at all; every seller of it is unofficial.
- Do not build a developer or partner API on top of BytePlus routes. That is resale under
  their terms and needs written authorisation.
- Do not enable BytePlus's visible watermark, and do not strip provider metadata from
  outputs; the R2 copy is byte for byte and the library labels every asset.
- Do not touch `packages/adapters/kie.js` Veo pricing assumptions; kie's Veo is 61% under
  Google list and has run in production since 2026-09-24 by owner decision.
- Do not mix Veyrnox wallet vocabulary into anything under `app/veyrnox/**` (hard wall CI).
