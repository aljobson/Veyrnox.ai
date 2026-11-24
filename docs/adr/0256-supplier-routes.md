# ADR-0256 — Supplier routes: one offer, an ordered list of suppliers

- **Status**: Accepted (2026-10-24), phases 0 to 2 built and applied; failover is inert until a route has a parity record. Phased plan: [supplier-routes-build-plan.md](../architecture/supplier-routes-build-plan.md).
- **Date**: 2026-10-23
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0014 — Floor pricing](0014-floor-pricing.md),
  [ADR-0020 — kie.ai and OpenRouter](0020-kie-and-openrouter-providers.md),
  [ADR-0027 — Capability registry](0027-model-capability-registry.md),
  [ADR-0037 — 50% contribution margin](0037-higgsfield-credit-parity.md) (amendment 2: the per-row floor),
  [ADR-0058 — BytePlus ModelArk](0058-byteplus-modelark-provider.md),
  [ADR-0066 — Submit error classifier](0066-jev-provider-submit-error-classifier.md),
  [ADR-0075 — fal submit outcomes](0075-fal-submit-outcomes.md),
  [ADR-0076 — fal durable dispatch](0076-fal-durable-dispatch.md),
  [ADR-0243 — Job cancel](0243-job-cancel.md);
  migrations 0327 and 0329 (supplier spend limits), 0366 (catalog margin trigger).

## Context

Today one `model_catalog` row is one offer on one supplier: it carries the
customer price (`credits_5s`), the supplier (`provider`), the supplier's
endpoint (`provider_endpoint`) and one recorded cost. The consequences, seen on
2026-10-22:

- **The same model is sold twice, and the supplier is in the name.** Kling 3.0
  is `kling-3.0-i2v` (fal, $0.56) and `kling-3.0-i2v-kie` (kie, $0.45), at
  different prices. Public ids end in `-kie` and `-grsai`; `/api/catalog`, the
  model pages and the generation API all show them.
- **No failover.** A supplier refusal refunds the job (`refundRejectedSubmit`);
  an ambiguous submit holds the debit (`unknownSubmitResponse`). The job state
  `FAILOVER` exists since migration 0001 ("Primary failed, retry on fallback")
  and the UI maps it to "queued", but nothing moves a job into it.
- **Cost differences are real and unused.** For one model, suppliers differ by
  10% to 55% (Veo 3.1 Fast: kie $0.30, a reseller $0.13; Seedance 2.0 Fast:
  OpenRouter $0.45, a reseller $0.29). Only fal has a weekly price check.
- **Every new supplier is a new set of rows.** BytePlus, Crun and the others
  considered would each add duplicate offers rather than a second source for an
  existing one.

The owner's requirement (2026-10-23): API connections to all wholesalers; the
primary for each offer is the cheapest for the platform; the second and third
exist for resilience.

## Decision

1. **Offer and route are separate.** `model_catalog` stays the customer-facing
   offer: id, name, modality, price, gating, active. A new `model_routes` table
   holds the ways to serve it: offer id, supplier, endpoint, recorded cost,
   priority (1 to 3), state (`active`, `standby`, `disabled`), provenance
   (`official`, `licensed_reseller`, `unverified`), the id of its parity record
   (decision 2) and its health. For compatibility, `model_catalog.provider` and
   `provider_endpoint` keep naming the priority-1 route until phase 6.

2. **A route may serve an offer only with a parity record.** Parity means the
   same model and version, the same output resolution and duration options, the
   same audio behaviour and no watermark. It is shown by identical capability
   pins (ADR-0027) for the route's endpoint and one paid probe, recorded with
   date and person. A different model or a lower tier is never a fallback: a
   customer who paid for Kling 3.0 Pro 1080p gets that or a refund.

3. **Order is by cost, and the owner approves it.** Priority 1 is the cheapest
   verified active route. In v1 a price watcher proposes the order and the
   owner approves a change; automatic reordering is a later flag with a 10%
   hysteresis and a 24-hour minimum dwell. At most three routes per offer.

4. **The price holds for the dearest route that may serve the offer.** The
   per-row floor (0366) generalises to `max(cost of every active route) <=
   credits * 0.01796`. A route above that cost can be activated only with an
   explicit, recorded margin waiver and a daily spend cap, so resilience can be
   bought on purpose and never by accident. Default: strict.

5. **Dispatch and failover are an attempt log, not a retry loop.** Each job
   gets rows in `job_attempts` (job, attempt number, route, supplier job id,
   outcome, cost snapshot, spend reservation). The job is debited once. Failover
   moves `SUBMITTED` to `FAILOVER` to `SUBMITTED` on the next route through one
   compare-and-set RPC keyed by attempt number.
   - **Failover happens on:** a definite supplier-side failure with nothing
     accepted (connection refused, 5xx without a task id, 429 or capacity
     refusal, supplier out of credit, auth failure), and a supplier-reported
     failure with no output that the adapter classifies as retryable.
   - **Failover never happens on:** a moderation or input refusal (a supplier's
     "no" is never routed around), an ambiguous submit (the debit is held and
     the first attempt reconciled before anything is sent again, as 0329
     requires), a user cancel, or any attempt that produced output.
   - **Bounds:** at most the number of routes, a time budget (default 90 s for
     submit-phase hops, 15 minutes for post-acceptance), and one extra wholesale
     reservation per hop.
   - **If every route fails,** the job ends as today: `job_failed`, then the
     refund.

6. **Late answers from abandoned attempts are recorded, not applied.**
   Webhooks and sweeps bind by supplier and supplier job id to `job_attempts`.
   A result for an attempt the job has moved past is logged as cost leakage and
   ignored. This leakage is a tracked metric.

7. **Health is per route.** A circuit breaker (rolling failure rate and
   consecutive failures) opens a route; a cooldown and one probe close it. The
   existing supplier admission switches (`provider_spend_provider_policy`)
   still gate a whole supplier. Route states appear in the recovery health
   snapshot.

8. **Spend and cost are measured per attempt.** Each attempt reserves against
   the serving supplier's hourly and daily limits, and a closed budget skips
   that route. Refunds still never reopen wholesale budget. A job's recorded
   cost is the serving route's cost. Every supplier gets a price check
   (fal's exists; kie's public rate card, OpenRouter's models list and each new
   supplier's pricing endpoint are added) that writes observations and opens an
   alert on drift.

9. **Public ids carry no supplier name.** Offers get supplier-free ids, the old
   ids stay as aliases the generation API and model pages accept, and
   `/api/catalog` stops listing suppliers. Offers that are the same model on two
   suppliers today are merged one pair at a time, each with an owner decision on
   the customer price.

10. **Every supplier is a compliance event.** Before a route is active: the
    supplier's terms are read for resale and platform use (BytePlus section 4.2
    is the model), the data region and processor are added to the privacy page,
    the output host is added to the R2 copy allowlist after one live output,
    the callback is signed or the route is poll-only, and the secret is set. A
    supplier whose own upstream is unverified is `unverified`
    provenance and is limited to the last position, or excluded, by an owner
    setting per offer.

11. **A flag controls all of it.** `SUPPLIER_ROUTES_ENABLED` defaults to
    `"false"`. Off, dispatch uses the offer's own provider exactly as today and
    ignores the route tables. A shadow mode logs the route that would have been
    chosen without using it.

## What is not decided here

- Automatic price changes when route costs move (prices stay a manual,
  ADR-recorded decision).
- Routes for composite jobs (Auto Short, montage, Video Agent) whose steps
  already use `job_steps`, and for chat models.
- Letting a customer choose the supplier.
- Any specific new supplier. Each is its own PR and compliance review. Crun in
  particular (a five-month-old UK company with a single China-resident owner and
  no stated upstream) is at most a last-position route for offers whose
  provenance setting allows `unverified`, after written answers on resale rights.

## Consequences

- The money path gets a second state-machine step. The invariants to prove in
  tests: one debit per job; at most one refund; a job with more than one attempt
  has at most one attempt that produced the stored output; an abandoned attempt
  never credits or debits anything.
- The cost of a mistake rises: a wrongly verified route sells the wrong product.
  Parity records and the paid probe are the control, and they cost money (about
  $0.50 to $2 per route).
- Wholesale spend can exceed one attempt's worth when a first attempt was
  accepted and then abandoned. It is measured and bounded by the hop limit and
  the supplier budgets.
- A failure-injection harness (fake suppliers answering with each failure
  class) becomes part of the acceptance tests.
- The privacy page and the legal processor list grow with each supplier.
- Work on the alias scheme touches the API contract, the mobile app, the MCP and
  the developer docs.
- Rollback at any phase is the flag, plus leaving the tables in place.

## Decisions (owner, 2026-10-24)

The owner took the recommended answer to each of the five questions this ADR left open.

1. **Provenance.** An `unverified` route may serve only as the last of at most three routes,
   and only once it has a parity record. Crun is the only such supplier today; its routes stay
   `standby` until its written answers (resale, upstream, credit expiry, refunds) are in hand
   and a paid probe has passed. With those answers it can be reclassified `licensed_reseller`.
   **2026-10-24:** the owner confirmed the written answers are in hand (this session did not read
   them) and migration 0375 reclassifies the four Crun routes. They stay `standby` until a paid
   parity probe passes and the owner approves.
2. **Time budgets.** Keep 90 seconds for a submit-phase hop and 15 minutes after acceptance.
   Phase 2 hops on an immediate, provable refusal and uses no timer; the 90 seconds binds only
   if a later phase adds slow submits, and the 15 minutes belongs to phase 3.
3. **Margin waivers.** Allowed per route, with a recorded note and a daily spend cap, on the
   owner's sign-off. The database refuses a route above the floor without them
   (`route_below_margin_floor`, 0373), so a waiver can never be implicit.
4. **Reordering.** Never automatic. Phase 4 proposes an order from price observations each
   week and the owner approves a change through a guarded RPC.
5. **Duplicate offers.** Merge Kling 3.0 only (the kie and fal rows, 26 and 32 credits), at the
   kie price of 26 credits, and only after fal passes a parity probe as the second route. That
   lowers the fal row's customers' price by six credits. No other pair is merged: the Veo
   offers stay separate and gain Crun as a second route later.


## Amendment 2026-10-24: Veo 3.1 Lite priced at its Crun floor (0380)

Crun became the first route for `veo-3.1-lite-kie` on 2026-10-24. A clip is 15 Crun credits; at the
owner's $50 top-up (10,300 credits, 206 per $1) that is $0.0728, which both the route and the catalog row
now record. Migration 0380 cuts the offer from 9 to 5 credits, the smallest whole-credit price that keeps
50% at that cost (ceil(0.0728 / 0.01796) = 5; $0.215 at the $129/3000 pack, $0.31 at the entry pack).
Four credits would cover only $0.0718. The kie route ($0.15) stays second but is above the floor, so a
failover hop onto it is refused unless a margin waiver is recorded (decision 3); a job Crun refuses
outright refunds. The fallback price list in `tokens.js` and the landing film keep the old price until
the next film render. The cost moves with the top-up tier: at the $500 tier (212 per $1) a clip costs
$0.0708 and 4 credits would hold.


## Amendment 2026-11-03: Higgsfield as a third route

Higgsfield is staged behind kie (priority 1) and Crun (priority 2) for `kling-3.0-i2v-kie`
and `kling-2.6-pro-kie`. Provisional migration 0437 (host confirms at merge) adds priority-3 `standby`, `unverified` routes and a
closed provider spend policy. No catalog, offer price, credits, activation or order changes.
The adapter pins Pro, sound off and (3.0) single shot. Polling runs every minute in groups
of five, copies one MP4 at a time through `completeJob`, and times out pending jobs at 45 minutes.
Only a strict request id is persisted; polling always uses the constant API host's canonical
`/requests/{request_id}/status`, never the returned status or cancel URL. There is no webhook.

ToS s11.5 forbids a pass-through without added value. Written confirmation from Higgsfield
support is outstanding, so this ships dark: `HIGGSFIELD_ENABLED` is absent (absent means off), no
`HIGGSFIELD_API_KEY` (the eventual secret is the account key id and key secret joined by a colon),
and `admission_open=false`. Set the Worker var to `"true"` only when the owner turns it on,
keeping production within the 66-var budget; `wrangler.jsonc` is unchanged. Higgsfield trains on outputs unless its account-level Console
opt-out is on; the owner must switch that opt-out on before enabling. Entity and processing
locations remain UNKNOWN in the sub-processor register. Non-English privacy additions are
explicitly English source pending human translation review; regenerated source hashes are
mechanical change tracking, not human approval of translations.

Costs record the price paid today per 5-second unit, with `cost_unit='per_second'` and
`billing_seconds=5`: 3.0 sound off is 5 × $0.056 = $0.2800; 2.6 is 5 × $0.035 = $0.1750.
The promotion ends 2026-11-10. List prices are $0.5600 and $0.3500 per unit, both above their
offer's margin floor. Resilience must be budgeted at list: a failover hop at list requires
an explicit recorded margin waiver, daily spend cap and owner sign-off (decision 3).

Before activation the owner must obtain the written platform-use answer, enable the training
opt-out, confirm entity/location and provenance, run the separate paid parity probes, record
actual charges and list-rate budgets/waivers, and approve activation and spend admission in a
later migration. The output host is UNKNOWN until a paid probe: **no Higgsfield host is added
to `r2Copy.js`**. Every Higgsfield copy is refused by the existing allowlist until a later,
migration-free PR adds the exact observed host. Outputs expire seven days after completion,
so the enabled sweep must copy them immediately. Only then should the owner provision the
secret and enable the flag. The builder does not run a paid probe.

Known limitation (HF-002): the gateway retains
`canHop: !rawKeys.length && !rawAssets.length && !record.edit`. Every Kling 3.0 image-to-video
request resolves its source from a reference and therefore has `canHop=false`: a kie refusal
refunds without trying Crun or Higgsfield. Until a separate media-aware failover change resolves
and validates the source image for each target supplier before opening its attempt, both third
and second 3.0 routes serve nothing on failover. Kling 2.6 text-only requests can hop.

Activation checklist (inspection notes HF-R2 and HF-R3, 2026-11-03). Do not enable the Higgsfield flag or
open spend admission until each line is true:

1. The exact Higgsfield output host, seen on a paid probe, is in `packages/adapters/r2Copy.js`. Enabling
   before that makes `completeJob` refuse the copy as non-retryable and refund the customer while
   Higgsfield has already billed the generation.
2. The `cost_per_unit` on both routes (0.2800 and 0.1750, the promotion rates to 2026-11-10) is
   re-checked against the then-current price. After the promotion it doubles, and a margin-floor check
   on a hop or activation would otherwise be understated.
3. The Worker var is set to the string `"true"` by the owner, who also checks the 66-variable budget
   (`tests/workerBindingBudget.test.mjs`); `wrangler.jsonc` deliberately carries no entry, so absent
   means off.

## Amendment 2026-11-10: kie as the active second route for Nano Banana Pro (0456)

`nano-banana-pro-grsai` (2 credits) had one route, so when the GrsAI account ran out of credits every job was
refused and refunded. Migration 0456 adds an `active` priority-2 kie route (`market:nano-banana-pro`, $0.0900,
`licensed_reseller`) behind it, and the GrsAI adapter now reports its balance refusal (HTTP 200, code -1, message
"insufficient credits") as `provider_payment_required`, the same code kie's 402 uses, so decision 5 hops it.
Any other GrsAI refusal still stops and refunds. No price, credits, catalog row or route 1 changes.

Evidence: paid probe 2026-11-10 (owner's kie key), task `26cba7722184e514a7373068284b82fa`, success after 38 s,
PNG 2048x2048 from `tempfile.aiquickdraw.com` (already on the kie allowlist), image read by Claude Code. The kie
dashboard charge is not yet read. A fal route ($0.1500, probed the same day, 20 s, 1024x1024) was left out.

Margin waiver (decision 3, owner, 2026-11-10): at 2 credits the cap is 2 x $0.01796 = $0.0359 and kie costs $0.0900,
so the route breaches the floor and carries a recorded waiver. Exposure is bounded by
`daily_spend_cap_cents = 500` ($5 of kie spend a UTC day, about 55 hops). Review of #2063 found that column was
stored and never read, so 0456 also redefines `job_route_failover` (0376's body plus two changes): it locks the next
route's row and refuses the hop with `route_daily_cap` when that day's `provider_spend_reservations` for the supplier
and offer, plus this hop, would pass the cap. A refused hop refunds as any other refusal does; a NULL cap behaves as
before. The route earns nothing while it serves; it
exists so a GrsAI outage costs the business a few cents per image instead of a failed generation for the user.
If GrsAI is topped up and stays healthy the route is never used. To remove it, set its `state` to `disabled`.

The same review found that the kie callback could not complete a hopped job: `findJob` required the offer's catalog
provider to equal the callback's supplier, and read the task from the catalog endpoint. It now accepts a job whose
recorded provider is a route of its offer (any route state, so a route switched off after a hop still lets its in-flight
jobs finish) and reads the task from that route's endpoint. A job whose provider is no route of its offer is still not
ours to complete.

## Amendment 2026-11-22: Crun first, fal second, for FLUX.2 Pro and Kling Avatar (0581)

The owner decided Crun is primary and fal secondary, and fal is refusing jobs on an exhausted balance. Five offers were
compared input by input with Crun's published contracts. Two move; prices do not change and fal stays active at priority 2.

| Offer | Result | Crun cost (206 credits per $1) | Floor |
|---|---|---|---|
| `flux-2-pro` (2 credits) | Crun first | 5 credits, $0.0243 | $0.0359 |
| `kling-avatar-v2` (32 credits) | Crun first | 65 credits at the 10 s audio cap, $0.3155 | $0.5747 |
| `nano-banana-pro-edit` (9) | stays on fal | not moved | $0.1616 |
| `seedance-2.0-reference` (85) | stays on fal | not moved | $1.5266 |
| `kling-3.0-i2v` (32) | stays on fal | not moved | $0.5747 |

Why three stay. Nano Banana Pro Edit accepts a seed, which Crun's model has no field for, and its default output is 2K
while the paid proof ran at 1K. Seedance Reference is sold with sound on while the paid proof ran with sound off, Crun's
prompt placeholders are `[Image1]` where ours are `@Image1`, and image-only requests and the 1080p and 4K tiers are
unproved. Kling 3.0 Pro sells a negative prompt, which Crun's model has no field for, and an end frame the proof did not
exercise.

Narrower limits on the two that move, each refused before the debit: Flux prompts over 5,000 characters; Avatar prompts
over 2,500 characters, WebP photos, photos over 10 MB, under 300 px or outside a 0.4 to 2.5 ratio, and audio under 2 s
or over 5 MB.

Avatar's proof charged 32.5 credits for 5.000 s of audio, although Crun's estimate said 65. Crun's public price is 6.5
credits a second at 720p, so the route records the 10 s worst case of 65 credits. A 10 s run is not yet proved.

fal is an automatic fallback for Flux only, and only on a Crun 401, 403 or 429. A job with uploaded media never hops, so
an Avatar job Crun refuses is refunded. Crun's 402 (out of credits) is not in the hop list either and also refunds.
Crun's refusal text is not kept for Avatar, because its request carries signed links to a person's photo and voice.

The Worker with the two new capability records must be live before 0581 is applied. Not established: Crun fetching our
signed R2 links, Flux shapes other than 1:1, and which model produced an output, which rests on Crun's model id.

## Amendment 2026-11-22 (2): Kling 3.0 Pro moves to Crun; Seedance Reference is staged (0582)

The owner asked for Kling and Seedance on Crun. Among active rows, only `kling-3.0-i2v` and `seedance-2.0-reference` were
still fal-first.

`kling-3.0-i2v` (32 credits, floor $0.5747) moves to the already proved `crun:kling/v3` at $0.4369 per 5 s. fal ($0.5600)
stays active second. An image-source job does not hop, so a job Crun refuses is refunded.

- Negative prompt: Crun has no field. Once the offer is on Crun the control disappears from web and mobile, and a customer's
  value is refused before the debit (`inputs_key_not_allowed:negative_prompt`, `lib/crunInputRefusal.js`).
- Templates (owner decision, 2026-11-22: "Yes, run without"): the 1,036 of 1,682 Kling 3.0 templates with their own negative
  prompt run on Crun without it. An older client may still send it. The server accepts that only when the value equals the
  named template's record and the prompt is that template's own, with or without the template page's photo line. The value
  is then dropped, so the job row and the Crun request carry none, and the price is unchanged. A replay of the key returns
  the first job with no second task. These jobs carry an image, so they do not hop and fal receives nothing. 1,166 of the
  1,682 templates can run; the other 516 stay refused for their existing reasons (needs a video or swap source, a bound
  template for another model, or a prompt over Kling's 2,500-character limit).
- End frame: Crun documents a second `img_urls` item, but it is unproved and `crun:kling/v3` is shared with the kie offer.
  The slot is not declared, so an end frame is refused before the debit (`source_slot_invalid`) until a paid proof.
- The dark `templateFaceWording` submit wording now applies on this Crun route too.

`seedance-2.0-reference` stays on fal. The adapter and capability for `crun:bytedance/seedance2-0-r2v` ship staged: `@ImageN`
and `@VideoN` become `[ImageN]` and `[VideoN]`, sound is on, and a reference video is 720p only because 1080p with a 10 s
source costs $3.50 against a $3.45 floor. No route names it and it is not on the route safety list, because the only paid
proof had audio off and used a test pattern. Activation needs a paid audio-on run for image-only and image-plus-video.

The Worker must be live before 0582 is applied.

## Amendment 2026-11-22 (3): Seedance 2.0 Reference moves to Crun for the proved shape (0583)

The owner ran the paid proofs: `bytedance/seedance2-0-r2v`, 720p, 5 s, sound on, a test pattern. Image only (task
`c6be2f4e-aaa4-47e5-994a-209cdb6961b4`) charged 157.93 credits, $0.7667. Image plus a 5 s reference video (task
`193ea5bf-d737-4af4-8fa3-8fe1de3c538c`) charged 191.46 credits, $0.9294. Both returned 720x1280 with an audio track. The
route records 193 credits, $0.9369, the cost with the longest reference video allowed (5.05 s). The floor is $1.5266, and
the price stays 85 credits. fal ($1.5120) is recorded as the active second route; this offer had no route row before 0583.

Only the proved length and tier are sold on Crun. 10 s, 1080p and 4K disappear from the catalog and are refused before
the debit, even though Crun's public rates would fit the floor, because no paid run proves them. Several reference
pictures and other aspect ratios stay available: Crun's public price does not vary with them, but the proofs do not
cover them and the parity record says so.

A job Crun refuses is refunded. Image jobs do not hop, so fal receives nothing. The reference-video shape is proved but
not reachable: its only caller is the template-clip path, which is off and names the fal endpoint. Crun has no mapping
to `reference_rejected_likeness`, so a refused real-person picture shows the generic failure with a refund. The Worker
must be live before 0583 is applied.

## Amendment 2026-11-23 (4): two Crun-only image tools, and the first Crun-first routes of 0584 to 0586

Three offers moved to Crun first on the owner's decision "Crun first wherever Crun serves the same model": Kling 2.6 Pro (0584,
the reverse of 0561: Crun median 386 s against fal 162 s on 2026-11-19, chosen anyway), Veo 3.1 (0585, probe task 586f2742,
$1.0922 against kie $1.25) and Kling O1 reference (0586, feature mode, endpoint `crun:kling/o1-r2v-ref`, 90 credits a 5 s unit
against fal $0.84, probe task 681e4480, 364 s). Checked and left alone because Crun is dearer or over the floor: Nano Banana Pro
(Crun $0.0388, grsai $0.0271, floor $0.0359) and Wan 2.5 ($0.5825 against kie $0.30). Hailuo 02 saves 3% and was not moved.

0599 adds Background Removal Fast (1 credit, `crun:image-background-remove`) and Upscale 2x Clean (2 credits, `crun:image-upscale`).
They are new offers, not routes of `bria-bg-remove` or `topaz-upscale`: Crun's models are different, so decision 2 (parity
before a route) does not apply and there is no second supplier. Each has one active route with a "current dispatch" record, and a
job Crun refuses is refunded. The upscale pins a 1024 px long edge because a 1024x1536 source came back at its own size and was
still charged 3 credits; a 1024 px edge doubling is confirmed with one real run after the Worker deploy. The Worker must be live
before 0599 is applied. Bria and Topaz stay.

## Amendment 2026-11-23: route failure accounting and breaker recovery (0603)

Route failure accounting now records supplier-side failures only, and generic Crun routes recover through the
documented cooldown.

1. **Submit counting is an allow-list.** `countsAgainstRoute` counts only `outcome === 'rejected'`, with no `localLimit`,
   and at least one accounting rule: `scope === 'route'`; `classifySubmitFailure` returning `failover`; an exact code of
   `provider_auth_failed`, `provider_payment_required`, `provider_rate_limited` or `provider_model_unavailable`, with or
   without a scope; a kie envelope matching `^kie \d{3}/(401|402|403|429|455|5\d\d)(:|$)`; or an error starting exactly
   `fal 402:` or `higgsfield 402/`. The independent accounting rules cover scope-free GrsAI and OpenRouter codes,
   kie errors inside HTTP 200, and fal and Higgsfield payment refusals. Sanitised fal `upstream_error` stays uncounted
   because it carries no status.
   Bare `provider_unavailable`, customer-content outcomes, unreadable 4xx, local validation and circuit-gate refusals
   close without counting. `classifySubmitFailure` remains the unchanged hop-safety rule. BytePlus submit failures
   without an `outcome` remain outside submit accounting. Redacted refusals keep their exact result shape, and vendor
   text is neither parsed nor added.
2. **Uncounted submit closure.** `job_route_close_refused(uuid, uuid)` uses the job lock and close-half checks of
   `job_route_failover`, records a failed attempt and never calls `route_breaker_record`. Missing jobs return
   `job_not_found`; non-DEBITED jobs or accepted attempts return `job_not_failable_over_or_accepted`; a different last
   route returns `failed_route_mismatch`. Replay is an `ok: true` no-op. `job_route_failover` remains unchanged for
   genuine supplier failures, including its eligibility, margin and spend checks.
3. **Generic Crun recovery.** The gate holds a generic endpoint only while its breaker timestamp is less than ten
   minutes old. A completed probe resets the count and closes it; a failed probe restarts ten minutes through the
   existing counting path. Probes are not exclusive: the existing account limiter bounds them to 20 per ten seconds.
   Suno retains its indefinite hold until fenced reopen, and `reopen_crun_endpoint_routes` is not widened.
4. **Typed async customer content.** Both completion paths pass the adapter's `errorCode` to `markAttemptOutcome`.
   Failed outcomes with exactly `provider_moderation` (BytePlus, GrsAI), `provider_moderated` (Higgsfield), or the imported
   `REFERENCE_REJECTED_LIKENESS` constant (fal) use `mark_job_attempt_refused(text, text)`. It updates only matching
   supplier/task attempts still `submitted`, sets them to `failed`, and never counts. It returns `{ ok: true, updated: n }`;
   redelivery updates zero. Completed outcomes and every other failure keep using `mark_job_attempt_outcome`.
5. **Route identity survives cooldown.** `resolveRouteSet` ranks once with breaker timestamps ignored only on copies
   of rows matching the offer's supplier and endpoint, and returns the original row if the first route matches the
   offer. An own route at priority 2 therefore remains tracked when a different priority 1 route is cooling, even
   when the own route is also cooling; a healthy different priority 1 route still returns
   no own route. Returned timestamps stay intact. The flag-off, read-error and empty-table cases are unchanged.
   Route identity remains available across cooldown transitions,
   so admitted probes retain attempt tracking. Crun gate refusals close uncounted; supplier results update route health
   through the existing failure and completion paths. Provable supplier refusals may now fail over, but `nextRoute`
   still excludes cooling destinations. `chooseRoute`, `breakerOpen` and the first supplier receiving the job are unchanged.
6. **Two exact endpoint exceptions.** The restated gate admits `crun:bytedance/seedance2-5-r2v:edit` and
   `crun:bytedance/seedance2-5-r2v:extend` alongside its existing grammar. No general second colon is allowed; case
   variants and suffix lookalikes remain `INVALID_INPUTS`. Breakers compare the full endpoint, so edit, extend and the
   plain endpoint trip and recover independently. The two offers remain dark as 0598 left them.
7. **Generic Crun endpoint accounting uses admission-time evidence.** Migration 0603 adds nullable
   `breaker_first_opened_at` without backfilling it. It records the start of the current open period and stays fixed
   when `breaker_opened_at` is refreshed. Readers fall back to `breaker_opened_at` when the new column is NULL.
   `mark_job_attempt_outcome` passes `job_attempts.created_at` to
   `private.route_breaker_record(uuid, boolean, timestamptz)`. The existing two-argument function delegates with
   `now()`, keeping submit-phase accounting and `job_route_failover` unchanged.

   For generic Crun routes sharing an endpoint, a failure always increments its own count and writes only its own
   row. With no stamped route, the fifth consecutive failure opens a period. With a stamped route, a failure
   refreshes the stamp only if the attempt was created at or after the latest endpoint stamp plus nine minutes.
   After one failed probe refreshes the stamp, another failure from the same window raises the count without moving
   the stamp. Earlier attempts leave the stamp unchanged, even at the threshold. An unstamped route joining an open
   period inherits the earliest endpoint start; an already stamped route retains its own original start.
   The endpoint lookup is a plain read.

   Completion clears its own count and both timestamps. It also clears stamped siblings when the attempt was created
   at or after that sibling's period start plus nine minutes, selecting them with `FOR UPDATE SKIP LOCKED`.
   Thus a completed probe can clear a sibling whose stamp was refreshed by a failed probe, while a task admitted
   before the trip cannot clear a sibling. Locked siblings remain for a later completion and their stamps still age
   out at the gate. Neither accounting path waits on another route's row. Own-row behaviour on late completion is
   unchanged from 0376. Suno and other suppliers retain 0376 accounting, ignore attempt time and leave the new column
   NULL; Suno's trip and fenced-reopen functions are unchanged.

   Both nine-minute evidence cutoffs include 60 seconds of admission-time grace; the gate still holds for ten minutes.
   Failure uses the latest endpoint stamp, while sibling completion uses the original period start.
   Failover attempt rows are opened just before submit, so a row created during the last minute of cooldown can reach
   the gate after expiry. The first failure from that window restarts the cooldown; subsequent failures from the same
   window only increment the count, while a completion from that window can still close the endpoint. Crun's submit
   timeout is 15 seconds, and first attempts are recorded just after acceptance, so a pre-trip admission does not
   normally produce a row nine minutes later. The SQL regression suite sets attempt timestamps explicitly and covers
   legacy NULL starts, repeated refreshes, sibling ordering, the grace boundary and committed `SKIP LOCKED` fixtures.
   The committed fixture requires a loopback host and a database name ending in `_check`, and restores both rows in
   `finally`.
8. **Deployment order.** The Worker must be live before 0603 is applied: the old Worker counts circuit-gate refusals,
   which can keep a shared generic Crun endpoint held. Worker-first is the normal order: `main` deploys the Worker on
   push, and an owner-approved workflow applies migrations afterwards. If either new uncounted-close RPC fails for any reason,
   including a missing function (`PGRST202`), the Worker logs the error and makes no counting call. With the Worker
   first, customer-content outcomes are not counted until 0603 lands. An attempt left open in that window, or by a
   failed close RPC, stays open in the attempt log: nothing closes it later. The Your Wins readers select only
   `completed` attempts; `scripts/check-crun-spend.mjs` reads all attempts, shows these rows as `open` and includes
   them only in its all-attempts upper bound. No path that moves money or routes a job acts on these open rows.
   Genuine supplier failures
   keep using the existing counting RPCs throughout.

Known limit: some asynchronous supplier failures carry no reviewed reason code (Crun TaskInfo `provider_task_failed`,
raw kie and fal codes), so they are treated as supplier failures. Vendor text is not parsed and no mapping is added.
Generic Crun routes still recover after ten minutes, and a completed job resets their failure count.

The four public functions are service-role-only. Both private breaker overloads revoke execution from PUBLIC, anon,
authenticated and service_role. All six functions use `SECURITY DEFINER` with an empty search path.
The gate body is copied from 0591 with only the cooldown predicate and endpoint clause changed. Prices, catalog rows,
routes, flags, refunds, ledger and Suno controls are unchanged. Veo image input remains dark pending separate work.
