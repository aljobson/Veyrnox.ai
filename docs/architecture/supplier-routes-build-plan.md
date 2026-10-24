# Supplier routes: phased build plan

Companion to [ADR-0256](../adr/0256-supplier-routes.md), proposed 2026-10-23.
Nothing here is built. Each phase is one or more PRs that ship behind
`SUPPLIER_ROUTES_ENABLED` (default `"false"`) and can stop the whole effort
without harm: phase 0 changes nothing a customer sees, and each later phase can
be switched off by the flag.

## What exists today (checked 2026-10-23)

| Piece | Where | Relevance |
|---|---|---|
| One offer = one supplier | `model_catalog.provider`, `provider_endpoint`, `provider_cost_per_unit` | The route table replaces this as the source of truth for dispatch |
| Supplier adapters | `packages/adapters/{fal,kie,grsai,byteplus,openrouter}.js`, registry in `packages/provider-sdk/registry.js` | Each already has `key`, `check`, `submit`; routing picks which one |
| Capability record per endpoint | `lib/modelCapabilities.js`, `capabilityFor(provider_endpoint)` | Parity evidence: pins must match between routes |
| Submit, refuse, hold | `app/api/v1/generations/route.js` (steps 1 to 5) | Failover hooks in at step 4 and in the completion path |
| `FAILOVER` job state | `packages/db/schema/0001_initial.sql`, `lib/jobState.js` | Exists, mapped to "queued", never entered |
| Ambiguous-submit rule | 0329, `unknownSubmitResponse` | Failover must respect it |
| Supplier spend limits | `provider_spend_provider_policy`, `providerSpend.js` | Reserved per attempt |
| Completion paths | webhooks (fal, kie, openrouter), sweeps (grsai, byteplus), `lib/providerCompletion.js` | Bind to attempts, not only to `jobs.provider_job_id` |
| Price check | `fal-catalog-watch` (fal only) | Extended to every supplier |
| Margin rule | trigger `model_catalog_margin_floor` (0366) | Generalised to the dearest active route |

## Candidate routes from the surveys (re-verify before use)

Costs are the recorded or surveyed figures for one clip or image; they are
inputs for the owner's order decision, not facts to build on.

| Offer | Today's route | Other suppliers seen | Note |
|---|---|---|---|
| Kling 3.0 I2V (5 s, 1080p) | fal $0.56 and kie $0.45, two offers | WaveSpeed about $0.42, Atlas $0.36 to $0.48, Crun $0.40 to $0.45 | Merge the two offers; the customer price needs a decision |
| Veo 3.1 Fast / Lite (8 s) | kie $0.30 / $0.15 | fal (higher), Crun $0.13 / $0.07 | The Crun saving is large and unexplained |
| Seedance 2.0 Fast (5 s, 720p) | OpenRouter $0.454 | BytePlus list $0.60 (promo $0.45), kie $0.62, Crun $0.29 | BytePlus rules apply to any reseller of it |
| Wan 2.5 (5 s) | kie $0.30 | fal $0.25 in the 2026-09-12 table | A possible cheaper primary; verify |
| Nano Banana | kie $0.02 | GrsAI $0.027 (Pro), fal $0.06 | kie primary, GrsAI second |
| Hailuo 02 / 2.3 (6 s) | kie $0.15 | fal $0.27, MiniMax direct $0.28, Crun $0.13 | Hailuo 2.3 Standard has the same kie cost |
| Kling 2.6 (5 s) | kie $0.275 | fal $0.35 | |

## Phases

Estimates are focused engineering days for one person, not calendar time, and
exclude waiting for owner decisions and paid probes.

### Phase 0: tables and shadow mode (3 to 5 days). No behaviour change.

- Migration: `model_routes` and `job_attempts`, RLS forced, service-role only,
  explicit revokes (CLAUDE.md), idempotent. Backfill one priority-1 `active`
  route per active offer from the current catalog row (`provenance` set by hand
  for the five suppliers). No customer reads either table.
- A pure `chooseRoute(offer, routes, health)` module with the ordering rules,
  unit-tested; shadow mode logs its choice next to the real dispatch.
- The generalised floor check as a function and a test; the trigger is not
  changed yet.
- ADR accepted; privacy and supplier lists reviewed.
- **Done when:** replay passes on a fresh database, shadow logs show every
  dispatch matches `chooseRoute`, and nothing in production changed.
- **Status (2026-10-23):** migration 0367 (both tables, 36 backfilled routes,
  service-role only), `lib/supplierRoutes.js` (`chooseRoute`, `routeFloor`,
  `shadowMatches`) and `tests/supplierRoutes.test.mjs` are written, and
  `lib/supplierRoutesShadow.js` logs the route `chooseRoute` would pick next to
  the real dispatch when `SUPPLIER_ROUTES_SHADOW` is `"true"` (off by default,
  never awaited, never throws). Not yet done: applying 0367 and turning the
  shadow flag on in staging to read the logs, and the owner review of the
  placeholder provenance values (fal, openrouter, byteplus `official`; kie,
  grsai `licensed_reseller`).

### Phase 1: dispatch through routes, one route per offer (4 to 6 days)

- Dispatch reads the route; `recordSubmittedJob` writes attempt 1; webhooks and
  sweeps bind through `job_attempts` with a fallback to `jobs.provider_job_id`
  for jobs created earlier.
- Behaviour is identical because every offer has one route. Staging soak with
  the flag on, then production.
- **Done when:** the existing acceptance scripts pass unchanged, and a week on
  staging shows no job whose attempt and job disagree.
- **Status (2026-10-24), phase 1a:** `lib/supplierRoutesDispatch.js` and
  migration 0370 (`record_job_attempt`) write attempt 1 behind
  `SUPPLIER_ROUTES_ENABLED` (off by default). The route is only ever the
  offer's own; anything else dispatches as today. Phase 1b: migration 0372
  (`mark_job_attempt_outcome`) closes attempt 1 as `completed` or `failed` from the
  completion paths (fal webhook, shared kie/OpenRouter/GrsAI/BytePlus completion),
  only after their own state RPC returned ok. Binding lookups through
  `job_attempts` wait for phase 2, when `jobs.provider_job_id` can change.

### Phase 2: submit-phase failover (6 to 9 days)

- The `job_route_failover` RPC (compare-and-set on attempt number), the failure
  classifier per adapter (definite, retryable, user-side, ambiguous), and the
  hop logic with time and attempt bounds.
- Failure-injection harness: fake suppliers that answer with each failure class,
  used by acceptance tests for every adapter.
- First pairs: Nano Banana (kie, GrsAI), Kling 3.0 (fal, kie), Hailuo (kie, fal).
  Each pair needs a parity record: capability pins compared and one paid probe
  per route.
- **Status (2026-10-24):** 0373 (`job_route_failover`, `record_attempt_supplier`),
  `lib/supplierRoutesFailover.js` and the generation route's `submitWithFailover` are
  written, flag-gated and inert until an offer has a second `active`, proven route (0369
  left Crun on standby). Only a provable refusal hops: kie 401, 402, 403, 429 and fal 401,
  403, 429 with outcome `rejected`; never an ambiguous answer, a refused prompt, a job
  with media inputs, a Clip Editor job or fal's durable-dispatch images. The ADR's "5xx
  without a task id" is not used: the adapters report every 5xx as ambiguous. A hop
  reserves the new supplier's budget and leaves the first supplier's reservation in
  place (conservative). Not yet done: parity records and paid probes per route, the ADR's
  open decisions, and the adapters for classifying GrsAI refusals (its error text carries
  no status).
- **Done when:** the invariants hold across the failure matrix (one debit, one
  refund at most, one stored output, abandoned attempts inert), and reconcile
  jobs read zero.

### Phase 3: post-acceptance failover and circuit breakers (5 to 8 days)

- A supplier-reported failure with no output moves to the next route within the
  15-minute budget; late answers from abandoned attempts are logged as leakage.
- Circuit breaker per route, cooldown and probe; route health in the recovery
  health snapshot and the operator alerts.
- **Done when:** a staged supplier outage (the harness, then a real key
  disabled on staging) fails over with no customer-visible error and a correct
  ledger.

### Phase 4: cost-ordered primaries (4 to 6 days)

- Price observations per supplier (kie rate card, OpenRouter models list, fal's
  existing check, each new supplier's endpoint) and a weekly report that
  proposes an order; the owner approves a reorder through a guarded RPC with a
  row-count check.
- The floor trigger becomes `max(cost of active routes)`; routes dearer than the
  floor need the recorded margin waiver and a spend cap.
- **Status (2026-10-24), phase 4a:** migration 0374 adds `model_route_reorder`: the owner's
  approved full order of an offer's active routes renumbers them, points the catalog row's
  supplier, endpoint and cost at the new first route (the catalog is still what dispatch
  reads) and logs the change in the append-only `model_route_order_changes`. It refuses an
  incomplete order, a route without a parity record or with an open breaker, an `unverified`
  route anywhere but last, and any first route the catalog's margin and free-allowance checks
  reject. It cannot know whether code exists for the new first route: the script in 4b must
  check `providerFor` and `capabilityFor` first, or the offer answers 501 until reordered back.
  Not yet done (4b): price observations per supplier and the weekly proposal script.
- **Done when:** the report runs for all suppliers and a reorder is applied once
  end to end on staging.

### Phase 5: new suppliers, one per PR (3 to 5 days each, plus review)

For each: adapter (`key`, `check`, `submit`), poll or signed callback, capability
pins, output host on the R2 allowlist after one live output, secret, privacy
processor entry, written answers on resale and platform use, provenance setting,
and its price check. Suggested order by value and risk: a licensed or official
reseller first, then WaveSpeed or Atlas, then Crun last and at most in the last
position. Crun's four conditions: written resale answer, upstream attestation or
a test that identifies the output host, credit expiry stated, support hours and
an SLA in writing.

### Phase 6: public ids, aliases and merged offers (5 to 8 days)

- Supplier-free ids with aliases accepted by the generation API, jobs, the
  model pages and `/api/catalog`; the old ids keep working and redirect.
- Merge duplicate offers pair by pair after the owner picks each price.
- Update the developer docs, MCP, mobile fallback lists and Vey's knowledge.
- **Done when:** no public surface prints a supplier name, and API callers using
  the old ids see no change.

## Test plan

| Layer | What |
|---|---|
| Unit | `chooseRoute` ordering, hysteresis, health skipping, provenance policy, the generalised floor |
| DB acceptance (real Postgres) | attempt uniqueness, compare-and-set under concurrency, one debit and at most one refund across every failure path, reconcile functions read zero |
| Adapter | each supplier against recorded real responses plus the failure harness |
| Integration | webhook and sweep binding to attempts; replay of an old job id through the compatibility path |
| Staging | flag on, a paid probe per route, an induced outage, a week of soak |
| Production | flag on for one supplier pair first, watch the leakage and failover metrics, widen |

## Cost and effort

- About 30 to 50 focused days for phases 0 to 4 and 6, then 3 to 5 days per
  supplier.
- Paid probes: about $0.50 to $2 per route for parity, and the same again for
  staging soak; likely under $200 for the first six pairs.
- Standing cost: one more thing to watch (leakage, breaker state, price drift),
  covered by the health snapshot and the weekly report.

## Owner actions the plan depends on

1. ~~Answer the five open decisions in the ADR.~~ Done 2026-10-24: see "Decisions" in the ADR.
2. Approve each phase's migration through `apply-migrations`.
3. Fund and key each supplier account, and send the supplier questions (the
   Crun list is ready to draft).
4. Approve each parity record (a paid probe and a short written note).
5. Approve the first order change in phase 4.

## Stopping points

Phases 0 and 1 change nothing visible and can be left in place. Phase 2 gives
resilience for the pairs that exist today with no new supplier. Phases 4 to 5
are where the cost savings arrive, so they are the right place to stop if the
first suppliers do not pass verification.
