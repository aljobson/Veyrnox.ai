# ADR-0009 — fal 429 retry policy

- **Status**: Proposed (2026-09-11)
- **Date**: 2026-09-11
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0000 — Product strategy](0000-product-strategy.md), `docs/PHASE-1.md`

## Context

The Phase-1 fal.ai adapter (`packages/adapters/fal.js`) issues a synchronous submit + poll flow behind `/api/v1/generations`. fal returns `429 Too Many Requests` with a `Retry-After` header when we exceed either per-account rate limits or model-level throttling. Today the adapter forwards 429 to the caller unchanged.

Three concerns steer the decision:

1. **Ledger integrity.** The Phase-1 architecture debits the ledger *before* the fal submit and refunds on failure. If we retry inside the adapter and one of the retries claims a partial cost on fal's side (e.g. fal charged for a submit that later 429'd on poll), the ledger and the fal invoice can diverge. Any retry policy must define what "definitively did not consume credit" looks like.
2. **Concurrency and locks.** The ledger update path holds a per-user row lock for the duration of the request. If the adapter sleeps 5+ seconds waiting on `Retry-After`, we hold that lock across a network round trip *and* a wall-clock delay. That's a bad shape at higher concurrency.
3. **Signal vs noise.** A 429 under our own quota is transient. A 429 that fal returns because they're throttling *us* as an account (as opposed to per-request) is closer to a ban signal — retrying makes it worse. The adapter cannot tell these apart from the response alone.

## Options considered

### A. No retry — surface to caller

The adapter forwards 429 (with `Retry-After`) directly. The web client, or any programmatic caller, retries at its own cadence.

- **Pros**: adapter is stateless and trivial. No lock-holding concern. Backpressure is naturally applied by the client. Ledger has one attempt to reason about.
- **Cons**: pushes the retry ergonomics onto every caller. The web UI must implement a "please wait N seconds" state or the user sees a raw error.
- **Ledger risk**: minimal — one submit, one outcome, one debit-or-refund.
- **Effort**: zero adapter changes; small UI change (~1 day) for the retry banner.

### B. Single retry after `Retry-After`, capped at 3s, inside the adapter

Adapter reads `Retry-After`, sleeps up to `min(retryAfter, 3s)`, retries once. If the second attempt also 429s, forward it.

- **Pros**: fixes the common case (short, model-level burst throttling) without user-visible failure. Cap of 3s bounds the lock window.
- **Cons**: the sleep still holds the per-user ledger lock unless we refactor so the lock is released before the sleep and reacquired after — which reopens the double-debit window. Doable, but a real refactor, not a one-liner.
- **Ledger risk**: needs a rule: "if the *first* submit returned a fal request id and then 429'd, treat that request id as canonical and don't create a second." Otherwise a retry could bill twice on fal's side. This is a real corner that Phase-1's flow does not yet document.
- **Effort**: ~2–3 days including the lock refactor + fal-side idempotency handling. Adds test surface.

### C. Exponential backoff up to N retries

Adapter retries with exponential backoff (e.g. 500ms, 1s, 2s, 4s), capped at some N.

- **Pros**: handles the "many small bursts" pattern common in provider APIs.
- **Cons**: worst option for lock-holding. Also the most likely to worsen an account-level throttle — if fal is telling us "back off" and we hammer them with 4 retries, we look adjacent to a bad actor. Cost per retry is at best user-visible latency and at worst a ban.
- **Ledger risk**: same as (B), only bigger and repeated.
- **Effort**: similar to (B), plus tuning knobs nobody will ever tune.

## Trade-offs

| Driver / Option | A. No retry | B. Single retry ≤ 3s | C. Exponential up to N |
|---|---|---|---|
| Adapter complexity | Trivial | Medium (lock refactor + idempotency) | High |
| Lock-hold worst case | ~request RTT | ~request RTT + 3s | ~request RTT + Σ backoff |
| User-visible latency | Whatever the client retry looks like | Up to +3s on the good case | Up to +7s on the good case |
| Double-debit surface | None | Needs explicit rule | Same rule, N times harder to reason about |
| Account-throttle worsening | None | Small | Real |
| Fits Phase-1 as documented | Yes | Requires ledger-flow amendment | Requires ledger-flow amendment |

## Recommendation

**Option A — no retry in the adapter; surface 429 with `Retry-After` to the caller.**

One-line reason: Phase-1's ledger flow assumes a single fal attempt per debit; adapter-side retries push us into a lock/idempotency refactor for a class of error the client can handle better with a visible "retry in Ns" affordance.

Two implementation notes for whoever executes:

- The adapter should still surface `Retry-After` in the JSON body (not just the header) so the web UI has one shape to render — many browsers strip response headers on non-2xx paths.
- The web client should distinguish 429 (transient, show retry banner) from 5xx (unexpected, log + toast). One React hook, ~50 lines.

Revisit if telemetry shows the p95 fal 429 rate above ~2% — at that point (B) starts to pay for its complexity.

## Decision

_To be completed by Al._

## Consequences (if A is accepted)

- Client SDK (or the web UI) becomes the retry authority. Document this in `docs/PHASE-1.md` so future adapters (Replicate, MuAPI-fallback in the Hybrid milestone) inherit the same rule.
- The ledger flow keeps its current "one submit = one debit" invariant. No idempotency-key work needed against fal today.
- If we later add a background/async generation path (Inngest, Cloudflare Queues), the story changes — that worker can retry safely because it doesn't hold a user-facing lock. This ADR only covers the synchronous adapter path.
- A single 429 counts as a failed generation in metrics; refund via the existing refund-on-failure path. No new ledger states.

## Open questions

- Does fal offer an idempotency-key header on submit? If yes, (B) becomes materially safer and cheaper. Confirm with fal docs.
- What is the current 429 rate in production? Without that number, we're choosing between three policies against a null baseline. A one-week production log grep would settle it.
- Should the web UI auto-retry on the user's behalf after showing the banner, or wait for a click? Small UX call, but it changes whether (A) *feels* like (B) to the end user.
