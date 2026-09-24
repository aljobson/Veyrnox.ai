# ADR-0037 — Match credit-pack value subject to a 50% contribution margin

Status: Credit-pack parity deployed 2026-09-24. Sana activation prepared for owner review.

The owner requested matching both Higgsfield prices and generation credits,
then clarified that every area must have a 50% margin. The margin requirement
now takes priority wherever exact generation-credit parity conflicts with it.

## Decision

0121 prepares one-off $19/270, $59/1200 and $129/3000 credit packs, matching
Higgsfield's monthly credit value. Keep the $10/100 entry pack and retire the
$25/300 and $75/1000 packs. Paid credits never expire; no subscriptions,
annual discounts, unlimited benefits or free-generation pools are introduced.

Keep Nano Banana and FLUX.2 Pro at 2 credits each. Reduce nominal 6s/768p
Hailuo 02 from 10 to 9 credits. The original draft's 1/1/6 charges are
superseded because they do not leave 50% after estimated payment fees.
Other catalog changes are tracked separately; GrsAI Nano Banana Pro activated via 0124. Sana activation is described below.

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

Migration 0121 is atomic, replayable and aborts on provider/cost/unit drift,
missing rows or conflicting pack IDs. It changes no top-up snapshot, job,
ledger or balance. Pending Stripe checkouts retain their original prices.
UI Hailuo fallback/preset charges follow the migration; signup copy no longer
hardcodes a generation count. Apply via the owner-reviewed production workflow
(ADR-0023), coordinate fallback deployment, then verify the public pack/model
APIs and signed-in debit/refund behavior. 0121 and the inactive 0122 were applied through the production workflow on
2026-09-24; public pack and model prices were verified after cache expiry.

Rollback is a new guarded migration restoring Hailuo to 10, retiring the new
packs and reactivating the old ones. Do not delete historical packs or rewrite
purchased balances. The old $0.075 sticker CHECK cannot be restored while
cheaper rows exist, even if those rows are inactive.


## Sana added alongside FLUX (owner request, 2026-09-24)

0122 stages `sana-1.5-4.8b` as a separate fal image model at 1 credit and
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

## Sana live provider verification — 2026-09-24

The owner supplied FAL_KEY locally. One paid request used the exact capability
payload (1024x768, one PNG, 18 steps, guidance 5, safety enabled, seed 42).
Request `01a0d3c2-1bcd-75f3-b53b-b7d2ca2d886b` completed successfully;
fal reported 3.863 seconds of inference. The output was downloaded without a
redirect from v3b.fal.media: PNG, 710119 bytes, decoded header 1024x768.
Safety result was false for NSFW. Visual inspection shows a coherent blue mug
on a wood surface; the finish looks glossy despite a matte prompt. This is a
single output inspection, not a comparative quality benchmark.

This direct provider test did not debit a Veyrnox account, send a production
webhook, or write R2. Existing automated gateway/capability/webhook/refund tests
remain separate evidence. No duplicate generation was purchased.

The billing-events API returned HTTP 403 with this key. The owner subsequently
signed into the fal dashboard. Its Sana-filtered usage row showed one billed
megapixel at $0.01/MP, total $0.01, for the single earlier generation. This is
aggregate endpoint billing evidence, not a request-level invoice. The 68.5%
contribution estimate still assumes the payment fees above.

## Sana activation evidence — 2026-09-24

An isolated deployed Worker, staging Supabase and test-only R2 bucket ran the
production generation and fal webhook handlers. Its wrapper allowed only the
dedicated signed-in test account and one Sana idempotency key. The fal account
ID was independently retrieved with the existing API key using the official
`GET https://rest.alpha.fal.ai/users/current` endpoint. Missing JWT and unsigned
webhook requests were rejected with 401 before the paid test.

Job `181f83a3-08dd-4218-b092-b62df4e59195`, fal request
`01a0d474-94f7-79c1-9b2d-c2db0d6755e9`, reached STORED through the real signed
callback at 17:26:51 UTC. The authenticated asset endpoint returned a signed
URL for the isolated R2 bucket. Download verification: PNG, 1024x768,
918415 bytes, SHA-256
`0f97d6ea1e9962ba05cd79bd20ec8fa360f00bc18b90baa7601accefe98be393`.
Visual inspection found a coherent blue mug; the matte instruction was not
fully followed. This is not a comparative quality benchmark.

There was exactly one -1 generation ledger entry; balance 46 -> 45. Replaying
the same request returned the same job without a second provider submission or
debit. All four reconciliation counters were zero. Other staging users' ledger
and balance fingerprints were unchanged.

A separate synthetic submit rejection exercised production
`refundRejectedSubmit` against staging Postgres: job
`710df345-af97-425e-ac29-7a15ecb47467`, balance 46 -> 45 -> 46, exactly one debit
and refund, state REFUNDED, repeated refund no-op. This was a simulated failure
with no provider request, not a live fal failure. The 39 targeted automated
checks additionally covered signature/tenant rejection, callback binding,
completion/replay and submit/refund behavior. The temporary Worker was closed
and staging Sana returned to inactive after validation.

0126 activates only the verified Sana row at 1 credit and $0.01 recorded cost,
asserting its identity, unit, endpoint, gating and price before updating.
Local Postgres verified successful activation, idempotent replay and rejection
of cost drift. FLUX remains at 2 credits. The pricing/picker fallback gains Sana;
Nano Banana copy no longer claims it is the cheapest image option.

Production remains inactive until the owner-approved migration workflow applies
0126. After merging, approve that run, verify the public catalog and pricing page,
and check production reconciliation. Rollback requires a new guarded migration
setting only Sana inactive and removing it from the fallback list. Do not rewrite
0122 or 0126 or modify balances. No credentials are committed.
