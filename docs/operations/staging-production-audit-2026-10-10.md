# Staging and production release audit — 2026-10-10

Scope: initial main `37b617af82309b12304695bbe726490deb371761`, integrated editor release `6f288e2a7348703cc17b9a08600ea6e001da5d78` (#852), deployed Workers, the two AI Supabase projects, migration coverage, runtime flags, recovery/reconciliation snapshots, repository checks, and feature rollout requirements. The original dirty checkout is preserved in place. Wallet and studio experiment databases are outside this audit.

> Historical baseline below; see [the follow-up rollout](#follow-up-rollout--10-october-2026-1645-utc) for current fixed/live status and remaining gates.

## Production baseline

- Production `https://veyrnox.ai` is serving Worker `dce70208-7779-4476-a825-9485dbcb5278` from successful main deployment run [38059492472](https://github.com/aljobson/Veyrnox.ai/actions/runs/38059492472). The deploy and preservation checks actually ran.
- All five public smoke checks pass. All five reconciliation drift counts are zero; recovery counts are zero and no unhealthy tasks are reported. These are current snapshots, not proof of a 24-hour observation window.
- All numbered source migrations through 0260 have production receipts. All public tables have RLS enabled. The security advisor's intentional service-table and definer-function notices remain; this is not a claim that every advisor finding has been eliminated.
- Forty-one production secret names and thirty-seven staging secret names were captured privately for deployment preservation checks. No secret value is recorded here.
- Initial exact-main checks: 2,718 unit/API tests, 2,717 passed and one skipped; lint zero errors/74 warnings; security typecheck and the client/server credential boundary passed. The dependency check passed its policy with the documented braces advisory exception; it is not a zero-vulnerability result.

## Staging repairs

The starting ledger lacked receipts for 24 source migrations. Actual state must be inspected before replay: some changes had previously been applied manually.

This audit applied the exact repository SQL for nineteen existing migrations:
`0201, 0202, 0203, 0216, 0219, 0220, 0221, 0227, 0232, 0233, 0234, 0235, 0236, 0241, 0248, 0253, 0254, 0255, 0256`.
A rollback-only rehearsal passed before each group was persisted. Four more, `0257–0260`, acquired receipts from another deployment during the audit and were skipped.

These close concrete gaps in chat deletion/settlement, referral clawbacks, model recording/costs, YouTube visibility, Cinema Library uploads, violation idempotency, tenant write caps, document timelines and restricted catalog metadata. Recovery and reconciliation remained healthy after application. The five-argument violation function is absent, its six-argument replacement exists, authenticated document saves remain granted, anonymous saves remain denied, and the document write caps remain present.

One original receipt remains missing: `0222_free_allowance_starting_values.sql`. Both rows already match its complete intended values:
`chat-mistral-small` = 3/account/day, 100/global/day, cost 0.0020, one Credit;
`nano-banana-kie` = 3/account/day, 40/global/day, cost 0.0200, two Credits.
The exact file requires old zero values and fails its row-count guard on this state. The transaction was rolled back; neither values nor assertions were weakened and no fictitious receipt was created.

The stricter new coverage check also identifies historical staging receipts with no source trace:
`0035_stripe_credit_packs`, `0036_purchase_supply_consent`, `0037_proportional_refund_clawback`, `0039_sales_channel`, `0040_pricing_floors`, `0041_dispute_opened_freeze`, `revert_pr108_stripe_objects_0035_0041`, `drop_wallet_residue_staging`, and `staging_publish_append_only_no_truncate`.
These need explicit historical reconciliation before declaring complete schema parity. They were not silently allowlisted.

The source configuration now preserves three existing live staging overrides: `EDITOR_TIMELINE_ENABLED`, `AGENT_VIDEO_ENABLED` and `MONTAGE_LIVENESS_ENABLED` are true. They were already true remotely; ordinary deployments previously reverted them to false. Production flags retain the values on current main, including the browser editor opened by #852 during this audit.

## New database finding and fix

The 0255 timeline helper returns SQL NULL when required version/fps fields are missing. Since the save function uses `IF ... OR NOT helper(...)`, NULL can evade rejection. A missing project-document `schema_version` has the same problem. Worker validation does not protect direct authenticated PostgREST calls.

Migration `0261_project_document_required_fields.sql` makes the timeline helper return a definite boolean, checks collection/sequence types before JSON operations, and explicitly rejects a missing document version. Null timelines remain supported. Locks, replay, tenant checks, grants and all 0254 caps are carried forward unchanged.

The regression failed on the old function and passed with the fix. A fresh local database replayed all 241 migrations; seven timeline checks, nine project-document checks, four write-cap checks and the default-privilege check passed. Rejected documents added no history or audit rows. The fix is applied to staging; live queries return false for missing version/fps and a wrong sequence type, and true for a null timeline. Production application must use the protected main workflow and owner review.

## Feature promotion matrix

Runtime flags and current source determine the live column; old roadmap/runbook prose often describes an earlier release.

| Feature | Production now | Remaining release work |
|---|---|---|
| Image, video, audio generation and Library | Live | Keep provider costs and recovery checks current; audit did not buy a generation |
| LLM Chat, stop/close, capped web search | Live | Preserve current pricing and key spend caps; staging settlement/delete gaps repaired |
| Chat Personas | Live | Staging server flag remains off; staging schema/RPCs now reconciled |
| Free daily allowances | Live | Staging values are present but receipt 0222 is missing and staging flag is off |
| Referrals | Live | Staging clawback now installed; staging flag remains off |
| Video agent | Live | Staging flag overrides now preserved in source; new fal transport remains separate |
| Publish: YouTube and LinkedIn | Live | Retain narrow released-network list; no public test post was sent by this audit |
| Publish analytics and calendar | Live | Provider-specific metrics still depend on existing access/scopes |
| Posting insights | Off | 0191 is applied; still needs current end-to-end acceptance of cached insights and a separately verified flag flip. The inspected staging account has no connected network |
| Publish device uploads | Off | Moderation/CSAM requirement D1 and upload acceptance; do not expose merely because storage SQL exists |
| Extended publishing networks | Off | Real-account connection/post/reconnect checks and applicable platform app approval; Bluesky connect failure remains open |
| TikTok analytics / Instagram insights scopes | Off | Provider permissions/app review and real reads |
| Projects, document history and project media | Off | New required-fields fix, protected production apply, clean reconciliation window and browser acceptance; media moderation/payment review remains a separate gate |
| Browser timeline editor | Live after #852 | Free browser composition/export is open. Cloud project saving remains separately gated; the new document fix and projects observation/acceptance still apply. #852 records owner approval and Reticle export evidence |
| Browser Video Enhance | Preview only | ADR-0065 remains proposed; engine/codec/runtime and policy qualifications must be settled before public navigation |
| Clip Editor captions | Server flag on, browser preview gate | Real captions/billing evidence and explicit preview removal before claiming a public launch |
| Slow-motion step | Off | Placeholder price and fal invoice/cost/audio acceptance |
| Qwen voice design / Topaz video upscale | Inactive models | Provider output, billing/margin and product acceptance before catalog activation |
| Credit subscriptions | Off | Controlled payment/renewal/refund/webhook/recovery acceptance, production configuration and observation requirements |
| Social Cinema: creators, drafts, uploads, publishing/viewing | Server flags on, browser preview gate | Current end-to-end creator/viewer/moderation acceptance before public launch claims |
| Cinema unlocks, creator monetisation and Pass | Off | Payment/credit lifecycle acceptance and required observation window; latest free-play safety migration only landed today |
| Cinema voting, comments, PPV, premieres, recommendations | Off | Implementation/product acceptance where incomplete; a flag alone is insufficient |
| Reserved immutable source uploads | Off | 0129 applied; production CORS now ready. Real browser File success, wrong-length rejection and second PUT 412 still required, then wait 15 minutes for old URLs to expire |
| Durable fal admission/dispatch/queue transport | Off | Health review started 10 Oct 11:43:05 UTC; its 24h window cannot finish before 11 Oct 11:43:05 UTC. Shared fal-account capacity across staging/production/montage and actual production tenant/key attribution must also be resolved |
| Admin AAL2, request limits and recovery health | Live | Preserve parity and fail closed on unreadable evidence |

Protected production database approval is required by [apply-migrations.yml](../../.github/workflows/apply-migrations.yml) and ADR-0023. Feature-dependent migrations must be applied and the reconciliation job clean for 24h under CLAUDE.md's Delivery rules, unless the owner explicitly records an exception. The newest migrations were applied on 10 October; current zero counts cannot establish this interval. Any new project-validation migration starts its relevant observation period when production applies it.

## Deployment and final verification

Staging Worker `3037ebad-bb33-49f7-9854-7281e46147e1` was deployed from the locked staging build. All five public smoke checks passed, all thirty-seven secret names and every existing plain variable were preserved, all source staging vars matched, and the HTML CSP contained only the staging Supabase identity. Recovery/reconciliation remained healthy. A subsequent editor release on main is integrated before the final merge.

Final local suite: 2,721 tests, 2,720 passed and one skipped. Lint retained zero errors/74 warnings, typecheck and credential boundary passed, as did migration numbering and dependency policy. The locked Next 16.3.8/OpenNext staging build passed.

## Repeatable checks and verification limits

```sh
node scripts/check-migration-coverage.mjs production
node scripts/check-migration-coverage.mjs staging
node scripts/check-staging-database-health.mjs
node scripts/check-reconcile.mjs
node scripts/check-recovery-health.mjs
node scripts/check-site-health.mjs
```

Coverage uses an explicit environment identity and ignores ambient Supabase variables. Missing receipts and unaccounted receipts fail the check; an unreadable ledger is an error, never a pass. It shares the protected apply planner's rename, replay-batch and Applied-name accounting rules.

Deployed staging and production do not contain the Reticle SDK. The existing Reticle setup is uncommitted in the original checkout and development-only; a remote lease returned `SDK_never_dialled` and was released. No Reticle pass is claimed. The new fix was verified directly against PostgreSQL; the staging browser was inspected without creating provider jobs, payment transactions or public posts. Deployment smoke checks do not replace feature acceptance.


## Follow-up rollout — 10 October 2026, 16:45 UTC

This section supersedes the earlier pending-fix and staging-history findings above; the earlier sections retain the inspected baseline. Scope now includes implementing the unfinished roadmap, as explicitly requested by the owner, as well as promoting completed features.

### Completed fixes and deployments

- **0261 applied in production** at 15:32:27 UTC via the approved workflow: required project-document fields cannot evade validation through SQL NULL.
- **#854 squash-merged**: [protected run 38066700872](https://github.com/aljobson/Veyrnox.ai/actions/runs/38066700872) applied 0262 at 16:20:19 UTC and 0263 at 16:20:23 UTC. 0262 explicitly reconciles staging's already-correct 0222 values with replay-safe catalog guards. 0263 prevents an incomplete Stripe snapshot from removing established Cinema Pass access or opening a second checkout. Production function text and service-only ACLs were checked.
- The nine historical staging receipts are now accounted by exact captured SQL, timestamps and SHA-256 values in `docs/archive/staging-migrations-2026-10-10/`. No historical receipt was fabricated or deleted, and no obsolete payment/wallet branch was replayed. Staging coverage is green with the explicit 0222 → 0262 forward repair; the original 0222 receipt remains absent by design.
- **#795, #805 and #755 squash-merged** after green checks: controlled staging fal transport tests, health-window review and capacity-reservation design. These do not enable fal transport or authorize more provider spend. [Production deploy 38066937777](https://github.com/aljobson/Veyrnox.ai/actions/runs/38066937777) succeeded at merged main `ead0883c`.
- Staging was rebuilt at `ead0883c` and deployed as Worker **348e103a-1b44-4bb2-b0c8-20c13473c652**. All 37 secret names and 57 plain variables were preserved; locked Next/OpenNext build and ten Video Enhance asset checks passed. The actual staging URL passed all five site-health checks; recovery and migration coverage were healthy.
- **#856 squash-merged**, main `09957c52`: migration 0264 adds hourly allowance/referral monitoring. [Owner-approved protected run 38068581693](https://github.com/aljobson/Veyrnox.ai/actions/runs/38068581693) applied it in production at **16:43:15 UTC**; [production deploy 38068581936](https://github.com/aljobson/Veyrnox.ai/actions/runs/38068581936) succeeded. Staging applied it at 16:36:21 UTC. Both environments report all **seven** drift counts zero. Public reads still expose cached counts only; direct table access and refresh remain unavailable to anon. Production ledger accounts for all 224 actual receipts, and every source migration is covered. Recovery and signup safeguards pass.

The 0264 test replays all **244** source migrations into fresh PostgreSQL, then seeds actual allowance overuse and an unmatched referral grant. The real hourly CLI exits 1 for each, 0 for measured zeroes and 2 for invalid evidence; repeat application, stale/future snapshots, ACL/RLS and cached-read isolation pass. Full suite: 2,740 tests, 2,739 passed, one skipped. CI database acceptance and build checks passed. Reticle was skipped for these database/monitoring/docs changes because they have no UI surface. Existing UI evidence is not replaced by a database test.

The concurrent cloud-saving preparation (#857) was reviewed and reached main while this follow-up ran. Its production flags remain off. That UI evidence is the author's recorded verification, not a new Reticle run by this database/monitoring audit.

### Remaining gates and unfinished scope

The audit has **not made every feature public**. Runtime flags and preview gates still govern the unreleased paths. Completed source does not establish provider qualification, payment acceptance or a full clean interval.

| Area | What remains |
|---|---|
| Projects | #857 is merged at `44304136`: documents/history use the server gate, media admission has separate `PROJECT_MEDIA_UPLOADS_ENABLED`. The PR records local Reticle save/reload and gate-off verdicts plus a real staging document/history drill. Production stays off pending a clean window after 0261, no earlier than 11 Oct 15:32:27 UTC / 16:32:27 BST; media retains D1 independently |
| Paid Cinema Pass | Current sandbox buy/play/ceiling/cancel/refund drill; rights/consent/refund sign-off; written Stripe acceptance; invoice-backed Stream cost; approved production catalogue. 0263's relevant 24-hour interval cannot finish before 11 Oct 16:20:23 UTC / 17:20:23 BST |
| Uploads across Transform, Publish, Projects and Cinema | Provider enrollment, documented image/video matching, trusted pre-storage byte admission, reporting/preservation policy and actual benign acceptance. See the prepared [integration/enrollment review](upload-scanning-enrollment-2026-10-10.md). Provider accounts and real scan adapter remain unimplemented |
| Credit subscriptions | C4's remaining Stripe sandbox lifecycle/recovery/alert evidence and provider/Finance/Legal acceptance, then C4a plan changes and C5 public pricing/account UI. The existing C4 backend is built and default-off; the UI remains unfinished |
| Publish | Build accepted Publish Plan entitlement/billing (B3); complete actual platform review/account acceptance for extended networks; cached posting-insights walk; upload gates |
| Cinema voting/comments/PPV/premieres/recommendations | Build and verify the reserved features against reviewed product rules. Existing 6-Credit Unlocks and Pass are distinct from the reserved PPV flag; do not invent new prices, payout terms or voting eligibility |
| Captions, Slowmo, Topaz/Qwen, deep research | Remaining provider/output/worst-case cost qualification and reviewed launch settings; current preview/default-off states remain |
| Durable fal transport | Correct production account/key attribution, shared-account producer/capacity enforcement, reviewed budget/canary and retained expanded health evidence. Existing paid sample budgets are exhausted |

The first retained seven-count staging observation is [run 38068792515](https://github.com/aljobson/Veyrnox.ai/actions/runs/38068792515), measured at **16:43:18.231 UTC**. Older five-count artifacts cannot establish the newly measured allowance/referral history. An expanded 24-hour evidence review cannot finish before **11 Oct 16:43:18 UTC / 17:43:18 BST** and still requires complete run inventory, subsequent clean samples, gaps and queue metrics. No elapsed-time waiver was requested or assumed.

### Owner actions

The approved 0261–0264 database work is complete; there is no remaining approval for those runs. Future migration PRs will request approval for their exact protected run after review and tests.

The next enrollment packet needs the operating entity/registration details, authorized business applicant, technical contact and reporting owner. IWF Image Intercept is the recommended candidate inquiry, pending eligibility and actual video/API terms; no application or external message has been sent. The proposal identifies additional contract, reporting-policy and bounded budget decisions before activation.

Paid launches also need the existing written Stripe/product/legal acceptance and invoice-backed provider costs. Real payment/provider canaries and public test posts will be prepared with exact content, destination and spend bounds before requesting authorization. Ordinary source fixes and accepted roadmap implementation continue within the owner's build-and-rollout scope.
