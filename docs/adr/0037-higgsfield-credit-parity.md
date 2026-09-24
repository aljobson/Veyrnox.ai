# ADR-0037 — Match credit-pack value subject to a 50% contribution margin

Status: Prepared for review, updated 2026-09-24. Not deployed.

The owner requested matching both Higgsfield prices and generation credits,
then clarified that every area must have a 50% margin. The margin requirement
now takes priority wherever exact generation-credit parity conflicts with it.

## Decision

0118 prepares one-off $19/270, $59/1200 and $129/3000 credit packs, matching
Higgsfield's monthly credit value. Keep the $10/100 entry pack and retire the
$25/300 and $75/1000 packs. Paid credits never expire; no subscriptions,
annual discounts, unlimited benefits or free-generation pools are introduced.

Keep Nano Banana and FLUX.2 Pro at 2 credits each. Reduce nominal 6s/768p
Hailuo 02 from 10 to 9 credits. The original draft's 1/1/6 charges are
superseded because they do not leave 50% after estimated payment fees.
All other model charges and providers stay unchanged. No staged route is activated.

See [50% margin analysis](../pricing/50-percent-margin.md) for candidate Sana
models, remaining cost-verification work and the full formula. With an assumed
8% + $0.30 payment fee per purchase, the $129 pack leaves $0.01796 per credit
for provider cost while retaining 50% of revenue. Nano Banana, FLUX and Hailuo
at 2/2/9 credits have estimated contribution margins of 68.5%, 56.9% and 53.0%.

These are contribution margins, not net profits. The actual Stripe fee schedule,
FX, tax-related fee base, overhead and retry/refund costs need verification.
The older ADR-0014 provider-only margin floor at a historical $0.033 reference
is superseded for this proposal by the explicit provider-plus-payment calculation.
ADR-0018's sticker floor becomes $0.043. Its legacy net-floor CHECK remains an
additional constraint; its LemonSqueezy formula is not a verified Stripe fee.

The dated competitor benchmark and production catalog snapshot remain audit
inputs. `parity-audit-2026-09-24.md` describes exact matching as a counterfactual,
not the revised rollout. `packages/catalog/index.ts` is a stale spreadsheet
transcription and must not certify this change.

## Rollout

Migration 0118 is atomic, replayable and aborts on provider/cost/unit drift,
missing rows or conflicting pack IDs. It changes no top-up snapshot, job,
ledger or balance. Pending Stripe checkouts retain their original prices.
UI Hailuo fallback/preset charges follow the migration; signup copy no longer
hardcodes a generation count. Apply via the owner-reviewed production workflow
(ADR-0023), coordinate fallback deployment, then verify the public pack/model
APIs and signed-in debit/refund behavior. Keep draft pending that rollout and
actual fee/cost validation. No production changes have been made.

Rollback is a new guarded migration restoring Hailuo to 10, retiring the new
packs and reactivating the old ones. Do not delete historical packs or rewrite
purchased balances. The old $0.075 sticker CHECK cannot be restored while
cheaper rows exist, even if those rows are inactive.


## Sana added alongside FLUX (owner request, 2026-09-24)

0119 stages `sana-1.5-4.8b` as a separate fal image model at 1 credit and
$0.01 recorded cost. FLUX.2 Pro retains its identity, endpoint and 2-credit
charge. The live model picker uses the catalog, so no replacement or alias
is required. The new option is not added to the offline fallback while inactive.

The live fal OpenAPI schema was fetched and verified. Its default image size
is 3840x2160, which would exceed the margin budget. The capability record pins
one 1024x768 PNG, 18 steps, guidance 5, default style, safety enabled and
async output. Prompt, negative prompt and seed are the only user inputs.
Client size/count/step/safety overrides and reference images are refused.
It uses the existing fal queue, signed webhook, storage and refund paths.

The expected contribution margin is 68.5% at the largest proposed pack under
the documented fee assumptions. This is a distinct budget option, not a claim
that its image quality is equivalent to FLUX. Endpoint documentation:
https://fal.ai/models/fal-ai/sana/v1.5/4.8b/api .

No FAL_KEY is available in this checkout or process environment, so a paid
live generation and charged-cost verification could not be run. 0119 stays
inactive pending a deployed submit -> signed webhook -> R2 -> STORED test,
charge confirmation, output inspection and failure/refund verification.
Activation requires a separate guarded migration; do not enable by editing
an applied staging migration. The user's request authorises adding Sana;
no further product choice is needed.
