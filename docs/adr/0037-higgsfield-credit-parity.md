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

## Amendment 1 — 2026-10-22: flatten the pack price curve (migration 0365)

The entry pack cost $0.100 a credit against $0.043 at the top pack, which left
the small packs far above the margin target and made the entry price per item
about 2.3 times the top-pack price. The 50% target is set by the worst-costed
credit ($0.01796) after the 8% + $0.30 fee, and it is tightest at $129/3000.
Each smaller pack carries a fixed-fee share, so its own floor is a little
higher than $0.043 a credit, but well under today's rates.

| Pack | Before | After | Worst-case margin before to after |
|---|---|---|---|
| Entry | `web-100` $10 / 100 ($0.100) | `web-160` $10 / 160 ($0.0625) | 71% to 60% |
| Small | `web-270` $19 / 270 ($0.070) | `web-330` $19 / 330 ($0.058) | 65% to 59% |
| Mid | `web-1200` $59 / 1200 ($0.049) | `web-1300` $59 / 1300 ($0.045) | 55% to 52% |
| Top | `web-3000` $129 / 3000 ($0.043) | unchanged | 50% |

Worst case means every credit is spent at the cost cap. With recorded catalog
costs, image-heavy spending stays at 70% or more on every pack and video-heavy
spending at 55% or more. The extra sales needed to keep the same worst-case
profit are about 18% on the entry pack, 10% on the small pack and 6% on the mid
pack. Figures use recorded catalog costs, not an invoice audit.

Decision: option B of the three considered (at the floor, B, gentle). At the
floor leaves no buffer for a supplier price rise; gentle gives away less than the
gap warrants. Rules kept from 0121: new ids carry the new credit counts, the old
packs are deactivated by exact shape (never deleted or rewritten), and pending
top-ups keep their snapshot. The migration adds a per-pack margin guard
(`price*420 - 30000 >= credits*1796`, in cents) and asserts the active set, and
`tests/creditPackCurve.test.mjs` checks the same inequality plus the database
floors. Model credit prices are unchanged.

Not changed here: the subscription plan rows (`starter-monthly` $19/270 and the
rest) still equal the old pack rates, so a pack is now better value per credit
than the matching plan. The plans are closed in production; re-price them before
opening, which also means telling Stripe, whose approval named the current prices.
Mobile store packs keep their own price points.

Rollout: owner-approved `apply-migrations` run, a Stripe test-mode purchase on
staging first; the public pack list follows within the five-minute cache.
Rollback: a forward migration reactivating `web-100`, `web-270` and `web-1200`
and deactivating `web-160`, `web-330` and `web-1300`. Research and the other
options: `docs/pricing/matching-buzzy-prices-2026-10-22.md`.

## Amendment 2 — 2026-10-22: whole-credit floor for fourteen rows, and a standing per-row rule (migration 0366)

Two margin rules had drifted apart. 0121 set the cap from this ADR: $0.01796 of
provider cost per credit (the $129/3000 pack, 8% + $0.30 fee, half of gross
kept). The weekly fal watcher (`scripts/lib/fal-price-check.mjs`) and most
older rows still used ADR-0014's reference of $0.033, which asks for $0.0165.
The difference left fourteen rows one to six credits above their floor:

| Row | Cost | Credits before to after | Price at $0.043 |
|---|---|---|---|
| `elevenlabs-tts-turbo` | $0.0500 | 4 to 3 | $0.172 to $0.129 |
| `elevenlabs-dialogue`, `minimax-speech-2.6-hd` | $0.1000 | 7 to 6 | $0.301 to $0.258 |
| `nano-banana-pro-edit`, `veo-3.1-lite-kie` | $0.1500 | 10 to 9 | $0.430 to $0.387 |
| `latentsync` | $0.2000 | 13 to 12 | $0.559 to $0.516 |
| `kling-2.6-pro-kie` | $0.2750 | 17 to 16 | $0.731 to $0.688 |
| `veo-3.1-fast-kie`, `wan-2.5-kie` | $0.3000 | 19 to 17 | $0.817 to $0.731 |
| `kling-3.0-i2v-kie` | $0.4500 | 28 to 26 | $1.204 to $1.118 |
| `seedance-2.0-fast` | $0.4536 | 28 to 26 | $1.204 to $1.118 |
| `kling-3.0-i2v` | $0.5600 | 34 to 32 | $1.462 to $1.376 |
| `kling-avatar-v2` | $0.5620 | 35 to 32 | $1.505 to $1.376 |
| `veo-3.1-kie` | $1.2500 | 76 to 70 | $3.268 to $3.010 |

Each new value is `ceil(cost / 0.01796)`. Worst-case margin at the top pack is
50% to 53% on these rows and higher at the smaller packs. Costs were checked on
2026-10-22: the fal rows against the weekly watcher's 2026-10-19 run ("20 of 20
match fal's billing"), the kie rows against kie's public rate card, and
Seedance 2.0 Fast against OpenRouter's $4.20 per million video tokens (a 5 s
720p clip is 1280 x 720 x 24 x 5 / 1024 = 108,000 tokens, $0.4536).

Changes:

- 0366 reprices the fourteen rows by exact identity (provider, endpoint,
  recorded cost, unit), accepting the old or new price, with a row-count check
  after each UPDATE.
- 0366 adds a trigger on `model_catalog`: an active row cannot be written with a
  cost above `credits * 0.01796` (clip-edit's per-second cost counts for five).
  Every active row is checked once when it runs.
- The watcher's reference rate becomes $0.03592 (twice $0.01796), so
  "margin >= 50%" there is exactly the database rule. Its printed margins move
  with it; `tests/falPriceCheck.test.mjs` and `tests/falBasePrice.test.mjs` are
  updated, and `tests/catalogPriceFloor.test.mjs` pins the agreement.
- Hailuo 02 and every row already at its whole-credit floor are unchanged.

There is now no buffer on these rows: a supplier price rise breaches the floor,
and the watcher (fal) or the trigger (any cost edit) will say so. kie and
OpenRouter rows have no weekly price watcher yet.

Not done here: the landing film bakes in six of these prices (Wan 2.5, Kling
2.6, Seedance 2.0 Fast, Veo 3.1 Fast, Veo 3.1 Lite, ElevenLabs TTS Turbo), and
`tests/landingFilm.test.mjs` ties them to the bundled fallback list in
`app/veyrnox/_lib/tokens.js`. Those six fallback rows keep their old price until
the film is rendered again; the other eight are updated. Also not done: the
finer credit unit that would let cheap images and audio go lower (plan only), and
Demucs (6 credits, floor 5) and the composite rows (Auto Short, Video Agent).
Rollback: a forward migration setting the old credits back; the trigger stays.

## Amendment 2026-10-24: plan credits at the 50% worst-case limit (0381)

A Lite monthly plan ($10) is added and every monthly plan's credits are set to the most that keeps 50%
in the worst case on both monthly and yearly billing: Lite 209, Starter 398 (was 270), Plus 1,171 (was
1,200), Ultra 2,412 (was 3,000). The limit is credits <= (0.42 x price - 0.30) / 0.01796 monthly, and the
same with the yearly price / 12 and a fixed fee of 0.30 / 12 for a yearly plan (planned yearly discounts
10%, 10%, 15%, 20%). Every plan stays under the 7.5 cent best-Pack rule of 0378. No subscription is live.
Yearly billing itself (an interval column value, monthly credit grants over a paid year, and the
Stripe recurring interval) is a later migration.

Correction (0383): Ultra's yearly limit is 2,411.99 credits a month, so 2,411 is the most that keeps 50%.
0383 sets both Ultra plans to 2,411 and adds the yearly plans, which grant credits one month at a time
through an hourly sweep (grant_due_yearly_cycles).
