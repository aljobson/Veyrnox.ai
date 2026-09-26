# Cinema Operator actions

Migration `0150_cinema_operator_actions.sql` adds two POST routes and append-only
request/receipt records. Deploy and apply it through the normal production
migration workflow before enabling the routes. Existing launch prerequisites
still apply; this increment does not change any feature switch.

## Access and requests

Both routes require a signed-in financial Operator (`users.is_admin`), a verified
Cloudflare Access assertion, and TOTP satisfied within five minutes. The database
rechecks the Operator role, Auth-user existence, account Freeze and Cinema account
status on every RPC, including retries. A Cinema `administrator` reviewer role
alone is insufficient. Ensure Access covers these API paths as well as the
existing administrator pages.

Send `Content-Type: application/json` and a UUID `Idempotency-Key` header. Unknown
body fields and query parameters are rejected. Actor identity comes from the
middleware; do not supply an actor, amount or Stripe identifier. Rate limiting
uses the existing account request limiter. Responses are `no-store` and contain
a `request_id` for diagnostics.

| Route | JSON body | Feature gate |
|---|---|---|
| `/api/v1/admin/cinema/unlocks/reverse` | `{"content_id":"<uuid>","reason":"Rights complaint upheld"}` | Cinema + profiles + unlocks |
| `/api/v1/admin/cinema/pass/refund` | `{"pass_id":"<uuid>","reason":"Duplicate Pass charge"}` | Cinema + subscriptions |

Reasons must contain 3–500 characters after trimming.

## Unlock Reversals

The content row must already be out of `PUBLISHED`; otherwise the route returns
409 `content_still_published`. Use the existing suspension/withdrawal flow to
remove a whole title. This repair route calls `reverse_cinema_unlocks` for the
specified row, retains the 30-day window and existing Free/Pack Credit treatment,
and reports `unlocks_reversed` and `credits_returned`. A series' episodes are
separate content rows. Retrying the same key/body returns the original counts;
changing the body under that key returns 409 `idempotency_conflict`.

## Flagged Pass refunds and recovery

Use the flagged Pass ID from the duplicate-subscription event. The route stores
the initiating Operator and reason before contacting Stripe. Only one operation
can be started per Pass. Keep the original key and body for retries; a different
key or Operator cannot start another operation (`refund_already_requested`).

The server cancels the duplicate subscription if necessary, then reads its final
state and initial paid USD invoice. It verifies the bound customer, subscription,
PaymentIntent and charge, and refunds the full charged amount including tax. It
never changes the live sibling Pass or the credit ledger.

- **200, `refunded: true`:** Stripe reports success and the database receipt exists.
  The route can replay this result without contacting Stripe again.
- **202, `pending: true`, `refunded: false`:** Stripe has accepted a refund but has
  not reported success. Retry the same request with fresh MFA to reconcile it.
- **502 or 503:** The provider or database could not finish. Retry the same key and
  body with fresh MFA. A successful Stripe refund is recovered using the operation
  metadata even after a lost HTTP response, failed receipt write, or expiration of
  Stripe's idempotency cache.
- **409, `refund_review_required` or `refund_failed`:** Investigate in Stripe before
  taking further action. The route does not create a replacement refund. Examples
  include a disputed charge, renewal invoice, split payment, previous manual or
  partial refund, failed refund, or inconsistent identity/amount/provider data.

Request rows live in `cinema_operator_actions`; successful receipts live in
`cinema_operator_refund_receipts`. They are append-only and have no direct Data API
table grants. An abandoned operation remains an auditable Operator item. There is
no background refund retry job or Operator UI in this increment. If the original
Operator cannot resume, use a separately reviewed operational recovery rather
than bypassing the unique-per-Pass guard.

## Verification

`tests/cinemaOperatorApi.test.mjs` covers HTTP authorization, validation, rate
limits, result projection and pending/failed receipt behavior.
`tests/cinemaOperatorRefund.test.mjs` uses fake Stripe responses to cover payment
binding, cancellation, refund statuses, recovery and ambiguous payment rejection.
`scripts/test-cinema-operator-actions.mjs` runs against disposable Postgres after
the publication tests in `ledger-tests.yml`; it checks real RPC authorization,
idempotency, concurrent retries, webhook races, append-only audits, privileges
and credit reconciliation. Its migration double-apply proof is rolled back.

Stripe contract references: [refund creation](https://docs.stripe.com/api/refunds/create)
and [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
Live Stripe/Managed Payments acceptance remains a launch prerequisite.
