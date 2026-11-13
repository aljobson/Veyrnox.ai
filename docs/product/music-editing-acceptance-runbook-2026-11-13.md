# Music editing set: staging acceptance runbook (2026-11-13)

Status: draft for owner approval. Nothing here has been run. Written from a read-only audit of the repo at `main` plus PR #2126; the staging database and Worker were **not** read.

Covers the seven features that are built but dark: **Extend, Add section, Replace section, Cover, Stems, Target stems, Track add.** Each is behind its own `MUSIC_RUNTIME_FLAGS` key (all `false`) and its catalog rows are staged `active = false` (migrations 0479, 0480, 0481, 0482, 0487, 0488, 0489), each saying the row stays inactive until one billed live run proves the output and the cost.

## Rules for every step

- **Label.** Every command below is tagged `NO KEY` (reads only), `STAGING FAL` (spends from the staging fal key, capped) or `OWNER` (needs your explicit go). Nothing in this runbook uses the production fal key. If a step would need it, stop.
- **Staging only.** Supabase `veyrnox.ai staging` (`yrqzwqywxfesmbvhzjgj`) and Worker `veyrnox-ai-staging`. Not the wallet project, not production (`xdxdzmsztyzbnzeforxx`).
- **Spend cap: $2.00 in provider charges for the whole run.** One successful pass of everything is about $0.60 (pair modes run two candidates). The rest is room for retries. Stop at the cap.
- **At most two attempts per feature.** A second failure is a finding, not a reason to loop.
- **No migration to production, no production flag, no catalog change on production from this runbook.** That is section 6, and it needs a separate PR and your approval.

## Cost and credits per feature (from the migrations)

| # | Feature | Model id(s) | Endpoint | Candidates | Credits | Provider cost |
|---|---|---|---|---|---|---|
| 1 | Extend (30 s tail) | `ace-step-extend` | `fal-ai/ace-step/audio-outpaint` | 2 | 2 | $0.012 |
| 2 | Add section | `ace-step-add-section` | `fal-ai/ace-step/audio-outpaint` | 2 | 2 | $0.012 |
| 3 | Replace section | `ace-step-replace-section` | `fal-ai/ace-step/audio-inpaint` | 2 | 2 | $0.024 |
| 4 | Cover | `stable-audio-3-cover` | `fal-ai/stable-audio-3/small/music/audio-to-audio` | 2 | 4 | $0.0496 |
| 5 | Stems (vocals + instrumental) | `mureka-stems-v3` | `mureka/api/song/stem` | 1 archive | 13 | $0.20 |
| 6 | Target stems | `sam-audio-target-stem` | `fal-ai/sam-audio/separate` | target + residual | 4 / 7 / 10 / 13 by length | $0.05 per started 30 s, up to $0.20 |
| 7 | Track add | `mureka-audio-upload` then `mureka-track-add-v8` | `mureka/api/files/upload`, `mureka/v8/generate/track` | 1 part | 1 + 6 | $0.01 + $0.09 |

Test credits needed for one pass: about 43. Grant 100 to allow for retries. Every row's recorded cost per credit is under the ADR-0037 cap (about $0.018), but the costs are recorded, not observed; section 3 records the real figure.

## 1. Preflight (NO KEY, reads only)

Do all of these before activating anything. Stop on the first surprise and tell me.

1. **Migrations on staging.** In the staging SQL editor (check the project name top left reads `veyrnox.ai staging`):
   ```sql
   SELECT id, provider_endpoint, credits_5s, active
     FROM public.model_catalog
    WHERE id IN ('ace-step-extend','ace-step-add-section','ace-step-replace-section',
                 'stable-audio-3-cover','mureka-stems-v3','sam-audio-target-stem',
                 'mureka-audio-upload','mureka-track-add-v8')
    ORDER BY id;
   ```
   Expect eight rows, all `active = false`, endpoints and credits as in the table. Fewer rows means the migrations are not on staging: apply 0479 to 0489 in order first (same procedure as `referrals-staging-runbook-2026-10-05.md`, which also explains the staging number drift trap).
2. **Worker has the code.** Staging is not deployed from `main` automatically. Confirm the staging Worker's deployed commit includes the music editing routes, then grep a live chunk for a string from the dialogs (`MusicExtendDialog` copy) before trusting it. A failed build can leave the old bundle live.
3. **Secrets on staging.** `FAL_KEY` and `FAL_WEBHOOK_USER_ID` set (see `fal-webhook-user-id-and-staging-secrets` notes). The `fal-dispatch-staging` workflow's prerequisite check (`scripts/check-fal-dispatch-staging.mjs`) passes.
4. **Test account.** A staging account with an **active paid subscription**: every one of these actions refuses with `PLAN_UNAVAILABLE` otherwise.
   ```sql
   SELECT user_id, status, current_period_end FROM public.credit_subscriptions
    WHERE status = 'active' AND current_period_end > now();
   ```
   If none, create one through the Stripe **test-mode** checkout on staging, not by inserting a row.
5. **Credits.** Grant 100 test credits through `ledger_grant` with a reason naming this run (never a raw insert). `OWNER`.
6. **Source audio.** One song on that account with a verified owned audio asset, 20 to 60 seconds long, with the rights attestation done. Use a track you generated or recorded. Do **not** use a licensed-library track or any third-party recording as the source.
7. **Baseline reconciliation.** Run `SELECT * FROM reconcile_balances();`, `reconcile_free_credits()` and `reconcile_subscription_credits()`. All three must return zero rows before you start, or you cannot tell what this run changed.

## 2. Activate on staging (OWNER)

Staging only, and not committed. For each feature, in its turn:

1. Activate the catalog row(s) in the staging SQL editor, asserting exactly one row changed:
   ```sql
   DO $$ DECLARE n INT; BEGIN
     UPDATE public.model_catalog SET active = true, updated_at = now()
      WHERE id = 'ace-step-extend' AND active = false;
     GET DIAGNOSTICS n = ROW_COUNT;
     IF n <> 1 THEN RAISE EXCEPTION 'expected 1 row, got %', n; END IF;
   END $$;
   ```
   Track add activates two rows (`mureka-audio-upload` and `mureka-track-add-v8`); expect 2.
2. Turn that feature's flag on **for staging only**: edit the `MUSIC_RUNTIME_FLAGS` JSON in the `env.staging` block of `wrangler.jsonc` locally (`extend`, `addSection`, `replace`, `cover`, `stems`, `targetStems`, `trackAdd`), deploy to staging, then re-check the bundle. Do not commit this edit, and do not set the flag from the Cloudflare dashboard (a dashboard edit is overwritten by the next deploy and has deployed the newest upload before).
3. Confirm the feature's dialog appears on a song detail page in the staging app.

## 3. Run each feature (STAGING FAL)

Order, cheapest first: Extend, Add section, Replace, Cover, Target stems, Stems, Track add. **Do the next one only if the previous one passed or you decided to skip it.**

Common steps for every feature:

1. Open the song, start the action, read the quote. **Check:** credits shown equal the table, balance after is correct, the quote expires.
2. Confirm once. **Check:** one debit of exactly the quoted amount; the job id and fal request id are recorded in section 4.
3. **Idempotency:** replay the same confirmation request (same idempotency key, for example by repeating the request from the network log). **Check:** no second debit, no second provider job.
4. Wait for completion (the webhook or the sweep). **Check:** job reaches a terminal success state; the output asset exists in owned storage, plays, and has the expected type and duration; a signed read works; the webhook was processed once.
5. **Cost:** read the billed amount for that request id on fal's usage page. Record it. If it differs from the catalog cost by more than 20 percent, stop: the credit price may be wrong.
6. **Refund path (once per feature family, not per feature):** start one more run and cancel it, or send a deliberately invalid request that passes admission. **Check:** a compensating ledger row, balance restored, no output.
7. **Gates:** an account without a paid plan gets `PLAN_UNAVAILABLE`; a song without a rights attestation is refused; an over-limit source (longer than the cap) is refused before any debit.
8. Run the reconciliation queries from preflight step 7. **All three must return zero rows.**

Feature-specific checks:

| Feature | Source limits | What the output must be |
|---|---|---|
| Extend | source ≤ 120 s | the original plus about 30 s of continuation; the original is untouched |
| Add section | source ≤ 120 s, section ≤ 30 s, start or end position | a new section at the chosen edge; position honoured |
| Replace section | source ≤ 60 s, range ≤ 30 s | only the chosen range changed; audio outside the range unchanged |
| Cover | source ≤ 120 s, prompt ≤ 500 characters | a distinct new version, not the source returned as is; source untouched |
| Target stems | source ≤ 120 s, one instrument from the allowed list | **two** WAV outputs (target and residual) both stored together; test a short clip to confirm the 4-credit tier |
| Stems | source ≤ 120 s | one ZIP archive holding vocals and instrumental audio; check the archive bytes, MIME type and that both stems play |
| Track add | source ≤ 120 s | two billed stages (upload $0.01, then track $0.09); one standalone private part; **no implicit mix** into the song |

If a feature fails twice, set its staging flag back to `false`, leave its catalog row active on staging only, and write the finding down. Do not retry past the cap.

## 4. Evidence to fill in (one row per feature)

| Feature | Date | Job id | fal request id | Credits debited | Quoted = debited? | Billed cost (observed) | Duration of run | Output checked (type, length, plays) | Idempotent replay ok | Refund ok | Reconcile zero | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Extend | | | | | | | | | | | | |
| Add section | | | | | | | | | | | | |
| Replace section | | | | | | | | | | | | |
| Cover | | | | | | | | | | | | |
| Target stems | | | | | | | | | | | | |
| Stems | | | | | | | | | | | | |
| Track add | | | | | | | | | | | | |

Keep this file in the repo only with the ids and numbers, never with signed URLs, keys or a person's audio.

## 5. After the run (OWNER)

1. Revert the local `wrangler.jsonc` edit; confirm `git status` shows no change to it.
2. Decide per feature: **ship** (all pass), **fix first** (a defect), or **drop** (cost or quality not worth it).
3. Leave staging rows as they are; they are test data.

## 6. Production activation (separate PR, per feature that passed)

Do not start until section 4 is filled in and you say go for that feature.

1. A migration numbered next on `main` (check open PRs first; a renumber breaks `migration-ledger`) that sets the row `active = true`, with the DO-block pattern in `packages/db/schema/supabase/README.md` asserting an exact positive row count. If the observed cost changed the price, change `credits_5s` in the same migration and say why in the header.
2. A PR flipping the feature's key in `MUSIC_RUNTIME_FLAGS` (both environments). It is a member of an existing JSON variable, so it does not use a new Worker binding (the binding budget is full).
3. Production applies only through the `apply-migrations` workflow on `main` after you approve the run. Apply the migration first, then deploy the flag.
4. After deploy, run the site health check, then watch for 24 hours: `reconcile_balances()` and the other two return zero rows, no `deploy-failure` issue, no unusual refund rate.
5. Rollback: flip the flag back in a PR, or `wrangler rollback`. A rollback restores the Worker only; the catalog row stays active, which is harmless while the flag is off.
6. Write the ADR this set is missing: what each action does, its price, its limits, what acceptance proved, and the rights rule.

## Not covered here

- Running any of this. No provider call was made in preparing it.
- The database acceptance tests (`npm run test:ledger`) and a browser walk of each dialog; do those before section 2 if you want extra assurance.
- Whether migrations 0479 to 0489 are on **production**. Check with the owner-approved read before section 6.
- Music Create's `cover` mode path from the Create screen versus the song detail page; the audit saw dialogs on song detail only.
