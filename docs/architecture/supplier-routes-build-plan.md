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

### Phase 1: dispatch through routes, one route per offer (4 to 6 days)

- Dispatch reads the route; `recordSubmittedJob` writes attempt 1; webhooks and
  sweeps bind through `job_attempts` with a fallback to `jobs.provider_job_id`
  for jobs created earlier.
- Behaviour is identical because every offer has one route. Staging soak with
  the flag on, then production.
- **Done when:** the existing acceptance scripts pass unchanged, and a week on
  staging shows no job whose attempt and job disagree.

### Phase 2: submit-phase failover (6 to 9 days)

- The `job_route_failover` RPC (compare-and-set on attempt number), the failure
  classifier per adapter (definite, retryable, user-side, ambiguous), and the
  hop logic with time and attempt bounds.
- Failure-injection harness: fake suppliers that answer with each failure class,
  used by acceptance tests for every adapter.
- First pairs: Nano Banana (kie, GrsAI), Kling 3.0 (fal, kie), Hailuo (kie, fal).
  Each pair needs a parity record: capability pins compared and one paid probe
  per route.
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

1. Answer the five open decisions in the ADR.
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
