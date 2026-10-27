# ADR-0000: Phone Credits, Pricing and Developers parity

Status: Implemented in the frozen work order; independent review pending.

The phone displays only store-provided priceString and pricePerMonthString values. It never computes a displayed price or shows a web/USD price, refund amount, or per-credit price. Value badges use ratios of positive store prices in one currency; missing prices or mixed currencies suppress comparisons. Annual plan comparisons use twelve monthly credit grants. Annual plans bill once a year but grant credits monthly, and unused credits expire monthly without rollover.

The subscription response does not identify the purchase channel. Actions are offered for active and past-due rows, and a server 404 no_live_subscription is authoritative evidence that the row cannot be cancelled through the Stripe endpoint. The screen remembers that subscription id until the owner changes and directs the person to the existing store management control. activeProductIds is not used to infer the channel: migration 0393 can flag a duplicate store plan while the returned subscription is a Stripe row.

The owner approved this decision on 2026-10-27: "Yes, let a web (Stripe) subscriber stop renewal or cancel unused credits from inside the phone app, with no web purchase link." The phone uses the existing /api/v1/subscriptions/cancel endpoint with an inline confirmation, no amounts and no web link. Every cancellation outcome independently refreshes the subscription, generation access and balance. Ended rows with end_reason cancelled_cooling_off remain visible for refund recovery.

A check-in bus shares the modal's current status and opens it without an extra GET, including after dismissal or claiming. Its state clears when the account changes. Credits always offers reopening while status exists; Home offers it only before claiming. Pricing includes gated models marked Premium while the creation catalog keeps its existing filtering. Developers presents commands and addresses as selectable text with native Share, and only navigates internally to Models and MCP.

The frozen whitelist excludes BillingProvider.tsx. Its existing refreshGenerationAccess implementation clears server access before rethrowing a failed refresh. The screen swallows that rejection and retains its subscription/balance values, but cannot make the provider retain its prior access value. Preserving that provider value requires a separate authorized provider change. Purchase gates remain unchanged.
