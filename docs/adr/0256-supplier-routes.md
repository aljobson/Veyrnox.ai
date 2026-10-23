# ADR-0256 — Supplier routes: one offer, an ordered list of suppliers

- **Status**: Proposed (2026-10-23). Nothing is built. Phased plan: [supplier-routes-build-plan.md](../architecture/supplier-routes-build-plan.md).
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

## Open decisions for the owner

1. The provenance policy: may an `unverified` route serve as position 3, or
   never?
2. The time budgets: 90 s and 15 minutes are proposals.
3. Whether a margin waiver for a resilience-only route is ever acceptable.
4. Automatic reordering: never, or after a probation period.
5. Merging duplicate offers: which pairs, and at which customer price.
