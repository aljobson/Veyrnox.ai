# Kling 3.0 staging verification — 2026-09-28

Target: Worker `veyrnox-ai-staging`, Supabase `yrqzwqywxfesmbvhzjgj`.
Production activation is not part of this verification.

## Preparation

- PRs #360 and #362 were squash-merged. Migration `0152_kie_kling3_i2v_staged`
  was applied to staging and its candidate row verified inactive at 28 credits
  per five seconds.
- Installed `KIE_API_KEY` and `KIE_WEBHOOK_HMAC_KEY` on staging from the owner's
  local credential file. Values were not printed or committed.
- Created private EU bucket `veyrnox-ai-staging-media`. Public r2.dev access is
  disabled. CORS permits only the staging Worker origin, GET/HEAD/PUT,
  Content-Type/Range/If-None-Match, with ETag exposed and a 3600-second cache.
- The owner confirmed creation of an account token with Object Read & Write
  scoped only to this bucket. Its S3 credentials were saved outside the repo
  with mode 0600 and installed on staging together with account, bucket and
  EU-jurisdiction settings.
- Real strict signed PUT and signed GET passed with HTTP 200 and byte-identical
  content. The disposable test object was deleted with HTTP 204.
- An unsigned POST to staging's KIE webhook returned 401 `invalid_signature`.
  This proves the route passes its configuration guard, not that a provider
  callback has been verified.
- Staging's deployed application included unmerged audit fixes through
  `ac360b2`. The local verification branch combines these with main `1a9c7db`
  and retains staging's Access audience and rate-limiter binding.
- The combined tree passed 813 tests: 812 passed, one existing skip.
- Issued 28 staging test credits through idempotent `ledger_grant`, key
  `codex-kling-staging-20260928-01`. Balance moved from 10 to 38. No production
  ledger was changed.

## Live generation

Passed using a real signed-in staging browser session and an original synthetic
landscape fixture. Worker version `4d5b7ba9-4b15-43ba-96cc-2ddcd1255e6c`
was built from verification commit `147a08a` and deployed only to staging.
The first Worker bundle failed because this worktree's node_modules symlink
resolved native sharp outside the worktree. A local `npm ci` from the unchanged
lockfile fixed the build; no dependency versions or application code changed.

- Temporarily enabled only `kling-3.0-i2v-kie` in staging with an exact-row-count
  assertion. The browser loaded its live 28-credit price and five-second input.
- Uploaded the fixture through the app's signed R2 upload flow and recorded its
  rights attestation. Submitted one generation, then immediately restored the
  candidate to inactive with another exact-row-count assertion.
- Job: `2b29292b-4b57-47e1-9230-9ba93f819da0`.
- KIE task: `c384774833e4d8d6f2a2da7334671e21`.
- Submitted at 09:12:28 UTC; stored at 09:14:54 UTC. Authenticated KIE recordInfo
  reported success, `costTime: 142`, and `creditsConsumed: 90` (nominal $0.45
  at the retained $0.005/credit quote; effective pack purchase cost is separate).
- Exactly one debit of 28 credits, including 10 Free Credits under the normal
  free-first rule. Ending balance: 10. The test grant did not preserve the
  original free/paid balance split.
- KIE webhook event is processed. Asset `b6d217ad-d295-4fa7-bdc8-120986cd47ab`
  is a 3,583,649-byte video/mp4 in staging R2; job state is STORED.
- Provider output inspection: H.264, 1920x1080, 5.041667 seconds, no audio stream.
  The browser library displayed DONE and AI GENERATED, and its video element
  reported readyState 4, paused false, matching dimensions/duration, and no error.
- A signed callback replay returned HTTP 200 with `duplicate: true`. Afterwards
  there was still exactly one asset and one job ledger entry.
- `reconcile_balances()` and `reconcile_free_credits()` both returned zero
  mismatches. The candidate was verified inactive after the test.

## Live submission failure and refund

The owner authorized the next acceptance check. An original 8x8 PNG fixture
was uploaded through the signed-in staging browser and submitted at the normal
five-second price. The candidate was temporarily enabled with an exact-row-count
assertion and disabled again immediately after the attempt.

- Issued 28 staging test credits with idempotency key
  `codex-kling-refund-20260928-01`, bringing the pre-test balance to 38.
- Job `69032683-9097-43b4-bd37-af46f65e2af9`, created at 09:23:52 UTC,
  reached REFUNDED with error code `provider_submit_failed` and no provider
  task ID. The exact upstream rejection message was not captured; the fixture
  was intended to trigger a size rejection, but that cause is not asserted.
- Ledger has one -28 `debit:generation` and one +28 `refund:submit_failed`.
  Both have free_delta zero. Balance returned to 38; no asset was created.
- Repeated `ledger_refund` with the same job, owner, amount and reason. It
  returned the existing refund entry with `idempotent: true`; there remains
  exactly one refund, with no additional balance change.
- Balance and Free Credit reconciliation both returned zero mismatches.
  Candidate active=false was verified after the test.
- This proves the live submit-failure refund path and refund RPC idempotency.
  It does not exercise a later provider failure callback, since this attempt
  did not create a provider task. No additional paid generation was retried.

## Remaining limits

This is one successful five-second end-to-end run, not a reliability or visual
quality benchmark. Submission failure/refund was verified live as above;
asynchronous provider-failure callbacks retain route-level test coverage only.
Supplier purchase cost was verified below; the protected production activation
workflow remains a separate launch step.
Production database and model activation were not changed.

## Production activation proposal (0154)

Migration `0154_kie_kling3_i2v_activation.sql` enables only this candidate after
checking its provider, endpoint, modality, price, cost, billing unit and gating
flag. It changes neither the fal option nor presets, fallbacks or Credit Packs.
Replay is safe; a missing or repriced candidate raises an exception.

On 2026-09-28, the owner accepted the tested output quality for launch alongside
fal. The signed-in KIE billing transaction history was checked directly: its
2026-09-13 purchase shows $5 for 1,000 credits, confirming $0.005 per supplier
credit and $0.45 for the measured 90-credit five-second output. The displayed
balance was 612 supplier credits. This establishes the listed purchase rate;
card currency conversion or separately charged taxes were not shown. The
synthetic landscape smoke test does not establish comparative parity with fal. The later-failure callback has automated coverage, not a live failure
sample; the live failure above covers submission rejection only.

Before approval, verify production has the merged adapter/capability code,
KIE API/HMAC credentials, working production R2 storage, and migration 0152's
inactive row. Staging credentials and its test bucket are not production setup.
Recheck migration numbering against origin/main and open PRs before merging.

After the checks, squash-merge and review the protected `apply-migrations`
workflow's complete pending plan before approving its production-database job.
After application, verify the active row, 28/56-credit quotes, first-frame-only
controls, a stored output and reconciliation. Do not apply production SQL from
an agent session. If rollback is needed, prepare a new forward migration that
sets only this candidate inactive with an exact one-row assertion; apply it
through the same owner-approved workflow. Existing submitted jobs can finish.
