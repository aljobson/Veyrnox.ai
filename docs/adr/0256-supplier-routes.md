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
