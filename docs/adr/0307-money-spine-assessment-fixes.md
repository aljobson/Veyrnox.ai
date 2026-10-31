# ADR-0307: Money-spine fixes from the 2026-10-31 security assessment

Status: accepted (2026-10-31)
Relates: ADR-0306 (chat cancellation accounting + NULL-safe sweep — findings
F-12/F-13), ADR-0067 (chat turns), ADR-0074 (video agent), ADR-0019/0057
(dispute freeze, Cinema), ADR-0256/0380 (supplier routes, Crun primary).
Migrations 0411–0415.

## Context

The 2026-10-31 assessment (`.gstack/security-reports/2026-10-31/`, confirmed by
an independent Codex review) found a cluster of "operator cost" money-spine
defects: the business pays a provider, no user credit is stolen. ADR-0306
shipped the two that were safe as a blind one-shot (F-12, F-13). The remaining
five are concurrency- and accounting-sensitive and are built here, each with a
behavioural test on a throwaway Postgres (the full migration replay where the
real ledger is needed), per the money-spine rule. No migration was applied to
production or any real Supabase project.

Migration numbers follow ADR-0306's 0409/0410 (PR for F-12/F-13). They are
provisional and re-checked against `main` and open PRs at apply time.

## Decisions

### F-02 — a capped web search could be replayed, and a Frozen account reached it (0411, `lib/chatTurn.js`)

A capped Web search runs our own paid provider call (Exa/Parallel) before
`ledger_debit`. Two gaps: a replayed idempotency key re-ran the paid search
(the search ran before `ledger_debit`'s replay handling), and the only Frozen
check was inside `ledger_debit`, after the search — so a Frozen or held account
made the operator pay for one search per attempt.

- **0411** adds `account_spend_eligible(user)`, a read-only Frozen/hold check
  mirroring `ledger_debit`/generation admission. `chatTurn` calls it before the
  search, for free and paid turns alike (a free-allowance turn skips the balance
  check, so without this a Frozen free account would still search).
- The replay half reuses the existing atomic claim: `provider_spend_admit_model`
  already reserves the search spend per `(user, idempotency_key)` and returns
  `idempotent=true` on replay. `chatTurn` now skips the live provider call when
  the reservation already exists; `ledger_debit` then reports the replay to the
  caller. No new state. Residual: under a pathological concurrent same-key
  double-send the second request may stream with the OpenRouter plugin fallback
  instead of the capped result — billing-safe (the capped search is billed once),
  quality-degraded only.

### F-04 — the video-agent one-in-flight cap was an unlocked read (0412, `app/api/v1/generations/route.js`)

`checkCapacity` read DEBITED/SUBMITTED agent jobs with no lock, before
`ledger_debit` in a separate round-trip, so two concurrent Approve requests with
distinct plan tickets both passed and both debited.

- **0412** adds `ledger_debit_video_agent`, which takes a transaction-level
  advisory lock on `(user, model)`, refuses when another in-flight agent job
  already exists (mapped to the existing `video_agent_in_progress` 409), then
  delegates the real debit to the unchanged `private.ledger_debit_for_admission`.
  The route uses it for `record.agent`; `checkCapacity` stays as responsive
  feedback only. A replay of the request's own key is not a conflict.
- An advisory lock was chosen over a partial unique index deliberately: a unique
  index would fail to CREATE on any pre-existing in-flight duplicate, `CREATE
  INDEX CONCURRENTLY` cannot run inside the migration runner's transaction, and a
  unique violation would be caught by `ledger_debit`'s handler as a false
  idempotency replay. The lock needs no backfill and leaves `ledger_debit`
  untouched.

### F-06 — a dispute before the Top-up credit left no Freeze (0413, `app/api/webhook/stripe/route.js`)

`charge.dispute.created` can arrive before the `checkout.session.completed` that
credits the charge. `apply_dispute_event` finds the Top-up by PaymentIntent
(set only on credit), so a pre-credit dispute returned `TOP_UP_NOT_FOUND`; the
webhook retried only while the event was "young" (1 h) then marked it processed,
discarding it. A delayed-settlement payment crediting after that window granted
the pack with no Freeze.

- **0413** adds `top_up_pending_disputes` (keyed by PaymentIntent, no users FK)
  and `note_top_up_dispute`. The webhook persists a pre-credit Top-up dispute
  instead of dropping it by age. `credit_top_up` (0097 body unchanged otherwise)
  now, when it credits an order with a persisted dispute, Freezes the account in
  the same transaction as the grant — exactly as an in-order dispute would
  (0098) — and consumes the pending row. This matches the established in-order
  dispute behaviour (Freeze + log; the Operator resolves the money once an
  account is Frozen); it does not invent a clawback the in-order path lacks. The
  ordinary refund path already retries `NOT_CREDITED_YET` until the credit lands,
  so only the dispute half needed this.

### F-14 — ambiguous-submit recovery excluded Crun and failover keys (0414, `packages/db/schema/supabase/`)

`sweep_stuck_jobs` (the DEBITED hold) and `reconcile_provider_submit_unknown`
keyed the "an ambiguous submit may be held by the supplier, do not auto-refund"
decision on a reservation found by the original unsuffixed idempotency key and a
hard-coded supplier set `('grsai','fal','kie','openrouter')`. Crun — now primary
per 0380 — was excluded, so a Crun ambiguous submit was refunded after 15 min
and then rejected by reconciliation; failover attempts reserve under a suffixed
key `<key>:aN` with a different supplier, which the recovery never read.

- **0414** bases both on the job's actual attempt: it holds a
  `provider_outcome_unknown` DEBITED job whenever it has any reservation under
  its own key or any `:aN` failover suffix, for any supplier; and reconciles
  against the last reserved supplier (max `admitted_at`), the attempt whose
  answer was ambiguous. No hard-coded list; Crun and Veyrnox included;
  `starts_with()` matches the suffix literally so an underscore in a key cannot
  act as a LIKE wildcard. It also carries ADR-0306/0409's NULL-safe predicate
  (`IS NOT DISTINCT FROM`), so it is correct whether it lands before or after
  0409.

### F-15 — the Cinema free-viewing ceiling trusted client heartbeats (0415, `packages/db/schema/supabase/`)

`start_cinema_playback` reserved at most 60 s against the monthly free ceiling
but the handler issued a 900 s playback token for a title of up to 600 s; only
voluntary heartbeats recorded more. A client that sent no heartbeat watched the
whole title while 60 s was counted — the ceiling never bound.

- **0415** reserves the full authorized lease up front: when a free play is
  granted it records the title's runtime (bounded by the ceiling seconds
  remaining) as the single `start` Free Play. The ceiling now counts only
  `start` leases, so a heartbeat is analytics and cannot double-count. The 900 s
  token is unchanged and needs no bound — a title is finite, so no token
  authorizes more than the runtime already reserved. The `cinema_free_plays`
  seconds CHECK is widened to 600 for the lease row. A viewer is charged the
  full runtime per play-start even if they stop early (the safe, cost-bounding
  direction); finer rewatch metering is left to a later change and is bounded by
  the same ceiling.

## Consequences

- Each change only ever refuses a debit, holds an ambiguous job, counts a
  ceiling sooner, or adds a Freeze that was previously missed — none withholds a
  refund that previously fired or over-charges a user — so every change keeps the
  previous release working under the Worker-only rollback contract. All new
  functions `REVOKE` from PUBLIC/anon/authenticated and `GRANT` to service_role;
  all `SECURITY DEFINER` functions `SET search_path = ''`; migrations are
  idempotent and contain no catalog UPDATE.
- Verified by focused behavioural tests on a throwaway Postgres: F-04/F-06/F-14
  and F-15 on the full migration replay with the real ledger
  (`scripts/test-video-agent-inflight.mjs`, `test-pre-credit-dispute.mjs`,
  `test-supplier-aware-recovery.mjs`, `test-cinema-free-lease.mjs`, and the
  rewritten `test-cinema-free-plays.mjs`), F-02 by `tests/chatTurn.test.mjs` plus
  a SQL smoke test of 0411. The DB scripts are wired into `ledger-tests.yml`.
  Production migrations are applied only by the `apply-migrations` workflow after
  owner approval.
