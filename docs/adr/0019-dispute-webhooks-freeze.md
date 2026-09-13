# ADR-0019 — Dispute webhooks Freeze the account

- **Status**: Accepted (2026-09-13)
- **Date**: 2026-09-13
- **Deciders**: Product owner
- **Amends**: [ADR-0018 — Credit Pack Top-ups before Subscriptions](0018-credit-pack-top-ups.md), decision 8
- **Related**: `CONTEXT.md` (Chargeback, Frozen, Operator), #91, #96, #97

## Context

ADR-0018 decision 8 assumed LemonSqueezy sends no dispute or chargeback
webhooks. It therefore inferred a Chargeback from a Top-up Refund that arrives
after the user spent credits since that Top-up.

While we were configuring the test-mode store (#91), the LemonSqueezy webhook settings offered
two events that the public event-type documentation does not list:
`dispute_created` and `dispute_resolved`. Our webhook now subscribes to both.
Their payload shape is undocumented.

Inference alone has two gaps. A dispute can sit open for weeks before any
refund, and the account keeps spending the whole time. And if LemonSqueezy
never refunds (for example, the dispute is won), we never find out at all.

## Decision

1. **`dispute_created` Freezes the account.** The webhook verifies the
   signature, dedupes in `webhook_events` (`dispute_created:<dispute or order
   id>`), and takes only the order id from the payload. It then re-fetches that
   order from the LemonSqueezy API and finds our Top-up by order id. It Freezes
   the owning user (actor `system`, reason naming the dispute) and never trusts
   a user named in the payload. If no Top-up matches, it logs and returns 200.
2. **`dispute_resolved` never unfreezes.** It is recorded in the
   account-action log for the Operator to see. Only an Operator unfreezes,
   through the audited function (unchanged from ADR-0018).
3. **Inference stays as a backstop.** A Top-up Refund after spending still
   Freezes, as in ADR-0018, in case a dispute webhook is missed (LemonSqueezy
   retries only 3 times) or a dispute is settled as a refund without a dispute
   event.
4. **Freezing is idempotent.** Freezing an already Frozen account appends a log
   entry but changes nothing else.

## Considered options

- **Keep inference only (ADR-0018 as written).** Misses won disputes and leaves
  the account spending until a refund lands.
- **Auto-unfreeze on `dispute_resolved`.** Undocumented payload, and we can't
  tell a won dispute from a lost one reliably. An Operator decides instead.

## Consequences

- #97 gains a `dispute_created` path. #96 is unchanged.
- Before building #97, capture a real `dispute_created` body, from test mode if
  LemonSqueezy can simulate one, or else from support. Pin the order-id field
  from it with a unit test fixture. If a payload has no usable order id, the
  handler can't safely identify the user. It logs the event with
  `console.error` for Operator review and does not freeze; the refund
  backstop still applies.
- The `CONTEXT.md` Chargeback definition changes: reported by the Merchant of
  Record, or inferred.
